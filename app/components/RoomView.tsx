"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Trophy } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { Avatar } from "@/components/Avatar";
import { ShareActions } from "@/components/ShareActions";
import { useProfiles } from "@/lib/profiles";
import { useSocial, type Group, type Room, type Standing } from "@/lib/useSocial";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * One room: who is in it, who is ahead, and the link that brings the rest in.
 *
 * The table is the same arithmetic as the global board, read from the chain index, so a room
 * is a view of real results rather than a scoreboard of its own.
 */
export function RoomView({ code }: { code: string }) {
  const wallet = useTickWallet();
  const { account } = wallet;
  const { act } = useSocial(account);
  const [data, setData] = useState<{ room: Room; group: Group | null; standings: Standing[]; error?: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/social?room=${code}`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      setData((await res.json()) as { room: Room; group: Group | null; standings: Standing[] });
    } catch {
      /* keep what is on screen */
    }
  }, [code]);

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

  const profiles = useProfiles(data?.standings.map((s) => s.address) ?? []);
  const inRoom = !!account && !!data?.room.members.includes(account.toLowerCase());
  const me = data?.standings.find((s) => account && s.address === account.toLowerCase());

  return (
    <AccountShell active="rooms" wallet={wallet}>
      {missing ? (
        <div className="page-empty">No room has that code.</div>
      ) : !data ? (
        <div className="page-empty">Loading the room…</div>
      ) : (
        <>
          <section className="page-intro">
            <h1>{data.room.name}</h1>
            <p>
              {data.group ? <>In {data.group.name} · </> : null}
              {data.room.members.length} playing · code {data.room.code}
            </p>
          </section>

          <div className="room-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}/rooms/${data.room.code}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check weight="bold" /> : <Copy weight="bold" />} {copied ? "Invite copied" : "Copy invite link"}
            </button>
            {account && !inRoom && (
              <button type="button" className="btn-solid" disabled={busy} onClick={() => { setBusy(true); void act("room.join", { code }).then(() => { setBusy(false); void load(); }); }}>
                Join this room
              </button>
            )}
            {me && <ShareActions address={me.address} net={me.net} compact />}
          </div>

          <section className="match-panel">
            <header className="match-panel-head"><h2><Trophy weight="bold" /> Standings</h2></header>
            {data.error && <p className="match-note">Results are unavailable right now, so everyone reads as zero.</p>}
            <ol className="room-board">
              {data.standings.map((s, i) => {
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
        </>
      )}
    </AccountShell>
  );
}
