"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "@phosphor-icons/react";
import type { Group, Room } from "@/lib/useSocial";

/**
 * The Rooms tab of the left pane: the contests you are in, wherever they sit, and the two ways
 * to get another: make one (inside a group or on its own) or join one by its number. A room does
 * not need a group, so this is where a contest with a few friends starts.
 */
export function RoomsPane({
  rooms,
  groups,
  signedIn,
  send,
}: {
  rooms: Room[];
  groups: Group[];
  signedIn: boolean;
  send: (fn: "createRoom" | "joinRoom", args: readonly unknown[]) => Promise<{ ok: boolean; message: string }>;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(fn: "createRoom" | "joinRoom", args: readonly unknown[], reset: () => void) {
    setBusy(true);
    setNote("Working on it…");
    const r = await send(fn, args);
    setBusy(false);
    setNote(r.ok ? null : r.message);
    if (r.ok) reset();
  }

  if (!signedIn) return <div className="gl-scroll"><p className="gl-note">Log in to make a room or join one.</p></div>;

  return (
    <div className="gl-scroll">
      <h2 className="gl-section">Your rooms</h2>
      {rooms.length === 0 ? (
        <p className="gl-note">No rooms yet. Make one below, or join with a number a friend sent you.</p>
      ) : (
        <ul>
          {rooms.map((r) => (
            <li key={r.id}>
              <Link href={`/rooms/${r.id}`} className="gl-row">
                <span className="gl-room-mark" aria-hidden="true">#{r.id}</span>
                <span className="gl-main">
                  <span className="gl-top"><strong>{r.name}</strong></span>
                  <span className="gl-bottom"><span className="gl-preview">{r.members} playing · {r.messages} messages{r.groupId ? ` · in ${groups.find((g) => g.id === r.groupId)?.name ?? "a group"}` : ""}</span></span>
                </span>
                <ArrowRight weight="bold" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="gl-section">Make a room</h2>
      <div className="gl-form">
        <input value={name} maxLength={40} placeholder="Name it" onChange={(e) => setName(e.target.value)} aria-label="Room name" />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Group for this room">
          <option value="">No group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button type="button" className="btn-solid small" disabled={busy || !name.trim()} onClick={() => void run("createRoom", [name.trim(), BigInt(groupId || 0)], () => setName(""))}>
          <Plus weight="bold" /> Make a room
        </button>
      </div>

      <h2 className="gl-section">Join a room</h2>
      <div className="gl-form is-row">
        <input value={joinId} inputMode="numeric" placeholder="Room number" onChange={(e) => setJoinId(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Room number" />
        <button type="button" className="btn-ghost small" disabled={busy || !joinId} onClick={() => void run("joinRoom", [BigInt(joinId)], () => setJoinId(""))}>Join</button>
      </div>
      {note && <p className="gl-note">{note}</p>}
    </div>
  );
}
