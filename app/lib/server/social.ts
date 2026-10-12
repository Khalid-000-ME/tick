import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Groups and rooms: who is playing with whom.
 *
 * A group is a standing community anyone can join. A room is a contest: it can live inside a
 * group or stand on its own behind an invite link, so a room never has to belong to anything
 * to exist. Membership is the only thing stored here; every number a room shows is read back
 * from the chain, so nothing in this file can invent a profit.
 *
 * LIMIT, stated plainly: this is a JSON file on disk. A serverless host has no persistent
 * disk, so rooms made there would vanish between cold starts; for launch this belongs in a
 * shared store (Vercel KV, Upstash, Postgres). The functions below are the whole interface.
 */
export interface Group {
  id: string;
  name: string;
  createdAt: number;
  members: string[];
}

export interface Room {
  code: string;
  name: string;
  /** The group it belongs to, or null for a room that only exists behind its invite link. */
  groupId: string | null;
  createdAt: number;
  createdBy: string;
  members: string[];
}

interface Social {
  groups: Record<string, Group>;
  rooms: Record<string, Room>;
}

const FILE = path.join(process.cwd(), ".data", "social.json");
let loaded: Social | null = null;
let readAt = 0;

async function load(): Promise<Social> {
  // Re-read when the file has changed since this copy was taken: a dev server and a script,
  // or two workers of one server, otherwise drift apart and a room made in one is missing
  // from the other.
  try {
    const { mtimeMs } = await fs.stat(FILE);
    if (!loaded || mtimeMs > readAt) {
      loaded = JSON.parse(await fs.readFile(FILE, "utf8")) as Social;
      readAt = mtimeMs;
    }
  } catch {
    loaded ??= { groups: {}, rooms: {} };
  }
  return loaded;
}

async function save(s: Social) {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(s), "utf8");
    readAt = (await fs.stat(FILE)).mtimeMs;
  } catch {
    /* read-only disk: this instance still has the in-memory copy */
  }
}

export const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "group";

/** Six characters someone can read down a phone line, with no 0/O or 1/I to mishear. */
function code(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("");
}

const clean = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 40);
const lower = (a: string) => a.toLowerCase();

export async function listGroups(): Promise<Group[]> {
  const s = await load();
  return Object.values(s.groups).sort((a, b) => b.members.length - a.members.length || a.createdAt - b.createdAt);
}

export async function getGroup(id: string): Promise<Group | null> {
  return (await load()).groups[id] ?? null;
}

export async function createGroup(name: string, address: string): Promise<Group> {
  const s = await load();
  const base = slug(name);
  let id = base;
  for (let n = 2; s.groups[id]; n++) id = `${base}-${n}`;
  const group: Group = { id, name: clean(name) || "Group", createdAt: Date.now(), members: [lower(address)] };
  s.groups[id] = group;
  await save(s);
  return group;
}

export async function joinGroup(id: string, address: string): Promise<Group | null> {
  const s = await load();
  const g = s.groups[id];
  if (!g) return null;
  if (!g.members.includes(lower(address))) g.members.push(lower(address));
  await save(s);
  return g;
}

export async function getRoom(roomCode: string): Promise<Room | null> {
  return (await load()).rooms[roomCode.toUpperCase()] ?? null;
}

export async function createRoom(name: string, address: string, groupId: string | null): Promise<Room | null> {
  const s = await load();
  if (groupId && !s.groups[groupId]) return null;
  let c = code();
  while (s.rooms[c]) c = code();
  const room: Room = {
    code: c,
    name: clean(name) || "Room",
    groupId,
    createdAt: Date.now(),
    createdBy: lower(address),
    members: [lower(address)],
  };
  s.rooms[c] = room;
  await save(s);
  return room;
}

export async function joinRoom(roomCode: string, address: string): Promise<Room | null> {
  const s = await load();
  const room = s.rooms[roomCode.toUpperCase()];
  if (!room) return null;
  if (!room.members.includes(lower(address))) room.members.push(lower(address));
  await save(s);
  return room;
}

/** Every room this wallet is in, newest first. */
export async function roomsOf(address: string): Promise<Room[]> {
  const s = await load();
  return Object.values(s.rooms).filter((r) => r.members.includes(lower(address))).sort((a, b) => b.createdAt - a.createdAt);
}

/** The rooms inside a group, whoever made them. */
export async function roomsIn(groupId: string): Promise<Room[]> {
  const s = await load();
  return Object.values(s.rooms).filter((r) => r.groupId === groupId).sort((a, b) => b.createdAt - a.createdAt);
}
