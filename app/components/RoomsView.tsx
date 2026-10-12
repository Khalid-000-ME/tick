"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, UsersThree } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { useSocial } from "@/lib/useSocial";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * Where the social side lives: the groups you can be part of, and the rooms you compete in.
 *
 * A room does not need a group. It can belong to one, or exist on its own behind its invite
 * code, so sharing a contest with four friends never means founding a community first.
 */
export function RoomsView() {
  const wallet = useTickWallet();
  const { account, status } = wallet;
  const { groups, mine, loading, act } = useSocial(account);
  const [roomName, setRoomName] = useState("");
  const [roomGroup, setRoomGroup] = useState("");
  const [groupName, setGroupName] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signedIn = status === "ready" && !!account;

  async function run(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const r = await act(action, payload);
    setNote(r.ok ? null : (r.error ?? "That did not work."));
    setBusy(false);
    return r;
  }

  return (
    <AccountShell active="rooms" wallet={wallet}>
      <section className="page-intro">
        <h1>Rooms</h1>
        <p>Play the same thirty seconds as everyone else, and settle who was right.</p>
      </section>

      {!signedIn ? (
        <div className="page-empty">Log in to join a room.</div>
      ) : (
        <div className="social-grid">
          <section className="match-panel">
            <header className="match-panel-head"><h2>Your rooms</h2></header>
            {loading ? (
              <p className="match-meta">Loading…</p>
            ) : mine.length === 0 ? (
              <p className="match-meta">No rooms yet. Make one below, or join with a code a friend sent you.</p>
            ) : (
              <ul className="room-list">
                {mine.map((r) => (
                  <li key={r.code}>
                    <Link href={`/rooms/${r.code}`}>
                      <strong>{r.name}</strong>
                      <span>{r.members.length} in · {r.code}</span>
                      <ArrowRight weight="bold" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <div className="social-form">
              <input value={roomName} maxLength={40} placeholder="Name a new room" onChange={(e) => setRoomName(e.target.value)} />
              <select value={roomGroup} onChange={(e) => setRoomGroup(e.target.value)} aria-label="Group for this room">
                <option value="">No group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button type="button" className="btn-solid" disabled={busy || !roomName.trim()} onClick={() => void run("room.create", { name: roomName, groupId: roomGroup || null }).then((r) => r.ok && setRoomName(""))}>
                <Plus weight="bold" /> Make a room
              </button>
            </div>
            <div className="social-form">
              <input value={code} maxLength={6} placeholder="Join with a code" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              <button type="button" className="btn-ghost" disabled={busy || code.length < 4} onClick={() => void run("room.join", { code }).then((r) => r.ok && setCode(""))}>Join</button>
            </div>
            {note && <p className="match-note">{note}</p>}
          </section>

          <section className="match-panel">
            <header className="match-panel-head"><h2>Groups</h2></header>
            <p className="match-meta">A group is a standing crowd. Rooms inside it are the contests.</p>
            <ul className="room-list">
              {groups.map((g) => {
                const inIt = !!account && g.members.includes(account.toLowerCase());
                return (
                  <li key={g.id}>
                    <div className="room-row">
                      <UsersThree weight="bold" />
                      <strong>{g.name}</strong>
                      <span>{g.memberCount ?? g.members.length} in</span>
                      {inIt ? <em>Joined</em> : (
                        <button type="button" className="btn-ghost small" disabled={busy} onClick={() => void run("group.join", { groupId: g.id })}>Join</button>
                      )}
                    </div>
                  </li>
                );
              })}
              {groups.length === 0 && <li><p className="match-meta">No groups yet. Start the first one.</p></li>}
            </ul>
            <div className="social-form">
              <input value={groupName} maxLength={40} placeholder="Start a group" onChange={(e) => setGroupName(e.target.value)} />
              <button type="button" className="btn-solid" disabled={busy || !groupName.trim()} onClick={() => void run("group.create", { name: groupName }).then((r) => r.ok && setGroupName(""))}>
                <Plus weight="bold" /> Start
              </button>
            </div>
          </section>
        </div>
      )}
    </AccountShell>
  );
}
