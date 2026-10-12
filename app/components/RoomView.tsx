"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Trophy } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { Avatar } from "@/components/Avatar";
import { ChatPanel } from "@/components/ChatPanel";
import { ShareActions } from "@/components/ShareActions";
import { useProfiles } from "@/lib/profiles";
import { fetchRoom, useSocial, type Group, type Room, type Standing } from "@/lib/useSocial";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * One room: who is in it, who is ahead, and the link that brings the rest in.
 *
 * Membership is read from TickSocial and the money from the chain index, so everything on
 * this page can be checked by anyone against the chain. Nothing here is our word for it.
 */
export function RoomView({ id }: { id: number }) {
  const wallet = useTickWallet();
  const { account, walletClient } = wallet;
  const { send } = useSocial(account, walletClient);
  const [room, setRoom] = useState<{ room: Room; group: Group | null; members: string[] } | null>(null);
  const [table, setTable] = useState<Standing[]>([]);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await fetchRoom(id);
      if (!found) return setMissing(true);
      setRoom(found);
      const res = await fetch(`/api/standings?addresses=${found.members.join(",")}`, { cache: "no-store" });
      const body = (await res.json()) as { standings: Standing[] };
      setTable([...body.standings].sort((a, b) => b.net - a.net || b.bets - a.bets));
    } catch (e) {
      // The page keeps whatever it already showed; the next poll tries again.
      console.error(`[room] ${((e as Error).message ?? "").split("\n")[0]}`);
    }
  }, [id]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await load();
    };
    void poll();
    const t = setInterval(poll, 15_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [load]);

  const profiles = useProfiles(table.map((s) => s.address));
  const inRoom = !!account && !!room?.members.includes(account.toLowerCase());
  const me = table.find((s) => account && s.address === account.toLowerCase());

  return (
    <AccountShell active="groups" wallet={wallet}>
      {missing ? (
        <div className="page-empty">No room has that number.</div>
      ) : !room ? (
        <div className="page-empty">Reading the room from the chain…</div>
      ) : (
        <>
          <section className="page-intro">
            <h1>{room.room.name}</h1>
            <p>
              {room.group ? <><Link href={`/groups/${room.group.id}`}>{room.group.name}</Link> · </> : null}
              {room.members.length} playing · room {room.room.id}
            </p>
          </section>

          <div className="room-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}/rooms/${room.room.id}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check weight="bold" /> : <Copy weight="bold" />} {copied ? "Invite copied" : "Copy invite link"}
            </button>
            {account && !inRoom && (
              <button
                type="button"
                className="btn-solid"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void send("joinRoom", [BigInt(room.room.id)]).then(() => {
                    setBusy(false);
                    void load();
                  });
                }}
              >
                {busy ? "Joining…" : "Join this room"}
              </button>
            )}
            {me && <ShareActions address={me.address} net={me.net} compact />}
          </div>

          <div className="social-grid">
          <section className="match-panel">
            <header className="match-panel-head"><h2><Trophy weight="bold" /> Standings</h2></header>
            <ol className="room-board">
              {table.map((s, i) => {
                const p = profiles.get(s.address);
                const you = !!account && s.address === account.toLowerCase();
                return (
                  <li key={s.address} className={you ? "is-you" : ""}>
                    <span className="room-rank">{i + 1}</span>
                    <Avatar avatar={p?.avatar} seed={s.address} name={p?.displayName || p?.username} size={28} />
                    <span className="room-who">
                      <strong>{p?.displayName || (p?.username ? `@${p.username}` : `${s.address.slice(0, 6)}…${s.address.slice(-4)}`)}</strong>
                      <small>{s.bets} calls</small>
                    </span>
                    <span className={`room-net ${s.net >= 0 ? "is-up" : "is-down"}`}>{s.net >= 0 ? "+" : "−"}${Math.abs(s.net).toFixed(2)}</span>
                    <Link className="room-card-link" href={`/w/${s.address}`}>Card</Link>
                  </li>
                );
              })}
            </ol>
          </section>
          <ChatPanel
            kind="room"
            id={room.room.id}
            account={account}
            canPost={inRoom}
            post={async (text) => send("postToRoom", [BigInt(room.room.id), text])}
          />
          </div>
        </>
      )}
    </AccountShell>
  );
}
