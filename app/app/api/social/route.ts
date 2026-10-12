import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { linkedAccountsOf, ownsWallet, verifyAccessToken } from "@/lib/server/privyAuth";
import { byNet, standingOf, standings, type Standing } from "@/lib/server/standings";
import {
  createGroup, createRoom, getGroup, getRoom, joinGroup, joinRoom, listGroups, roomsIn, roomsOf, type Room,
} from "@/lib/server/social";

/**
 * Groups and rooms, read and written.
 *
 * Reading is open: a room's table is public, which is the point of sharing one. Writing
 * (making a group or a room, joining either) needs a signed-in Privy user who owns the
 * wallet being added, so nobody can stuff a room with addresses that are not theirs.
 *
 * Standings always come from the chain index, never from anything stored here.
 */
export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

async function member(request: Request, address: string): Promise<string | null> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const did = await verifyAccessToken(token, appId);
  if (!did) return null;
  const accounts = await linkedAccountsOf(did, appId, secret);
  return accounts && ownsWallet(accounts, address) ? did : null;
}

async function table(room: Room): Promise<{ standings: Standing[]; error?: string }> {
  try {
    const rows = await standings();
    return { standings: room.members.map((m) => standingOf(rows, m)).sort(byNet) };
  } catch {
    // A room is still worth opening when the index is down; it just cannot rank yet.
    return { standings: room.members.map((m) => ({ address: m, bets: 0, staked: 0, returned: 0, net: 0 })), error: "standings unavailable" };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("room");
  const address = url.searchParams.get("address");

  if (code) {
    const room = await getRoom(code);
    if (!room) return refuse("That room does not exist.", 404);
    const group = room.groupId ? await getGroup(room.groupId) : null;
    return NextResponse.json({ ok: true, room, group, ...(await table(room)) });
  }

  const groups = (await listGroups()).map((g) => ({ ...g, memberCount: g.members.length }));
  const mine = address && isAddress(address) ? await roomsOf(address) : [];
  const groupId = url.searchParams.get("group");
  const rooms = groupId ? await roomsIn(groupId) : [];
  return NextResponse.json({ ok: true, groups, mine, rooms });
}

export async function POST(request: Request) {
  let body: { action?: string; address?: string; name?: string; groupId?: string | null; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse("Expected a request body.", 400);
  }
  const { action, address } = body;
  if (!address || !isAddress(address)) return refuse("Expected a wallet address.", 400);
  if (!(await member(request, address))) return refuse("Log in again to do that.", 401);

  switch (action) {
    case "group.create": {
      if (!body.name?.trim()) return refuse("Give the group a name.", 400);
      return NextResponse.json({ ok: true, group: await createGroup(body.name, address) });
    }
    case "group.join": {
      const g = body.groupId ? await joinGroup(body.groupId, address) : null;
      return g ? NextResponse.json({ ok: true, group: g }) : refuse("That group does not exist.", 404);
    }
    case "room.create": {
      if (!body.name?.trim()) return refuse("Give the room a name.", 400);
      const room = await createRoom(body.name, address, body.groupId ?? null);
      return room ? NextResponse.json({ ok: true, room }) : refuse("That group does not exist.", 404);
    }
    case "room.join": {
      const room = body.code ? await joinRoom(body.code, address) : null;
      return room ? NextResponse.json({ ok: true, room }) : refuse("No room has that code.", 404);
    }
    default:
      return refuse("Unknown action.", 400);
  }
}
