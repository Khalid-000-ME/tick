"use client";

import { motion } from "motion/react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { useProfiles } from "@/lib/profiles";
import type { RoomRow } from "@/lib/server/standings";

/**
 * The room's live scoreboard.
 *
 * It is a race, so it moves: rows slide to their new place when someone overtakes, a figure pops when
 * it changes, a ring round a face says which side that player has money on right now, and the lead is
 * lit. The numbers come from the chain index, a few seconds behind the chain, and are polled every
 * three seconds, which is faster than a window settles.
 */
const money = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;

export function Scoreboard({
  rows,
  account,
  roundSince,
  updatedAt,
  loading,
}: {
  rows: RoomRow[];
  account: string | null;
  roundSince: number;
  updatedAt: number | null;
  loading: boolean;
}) {
  const profiles = useProfiles(rows.map((r) => r.address));
  const reach = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const started = new Date(roundSince * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const anyCalls = rows.some((r) => r.bets > 0);

  return (
    <section className="sb" aria-label="Live scoreboard">
      <header className="sb-head">
        <h2>Scoreboard</h2>
        <span className="sb-live"><i aria-hidden="true" /> Live</span>
        <small>{updatedAt ? "Round since " + started : ""}</small>
      </header>

      {loading ? (
        <p className="sb-empty">Reading the round…</p>
      ) : (
        <ol className="sb-list">
          {rows.map((r, i) => {
            const p = profiles.get(r.address);
            const name = p?.displayName || (p?.username ? `@${p.username}` : `${r.address.slice(0, 6)}…${r.address.slice(-4)}`);
            const you = !!account && r.address === account.toLowerCase();
            const lead = i === 0 && r.net > 0;
            return (
              <motion.li
                key={r.address}
                layout
                transition={{ type: "spring", stiffness: 520, damping: 42 }}
                className={`sb-row ${lead ? "is-lead" : ""} ${you ? "is-you" : ""}`}
              >
                <i className={`sb-bar ${r.net >= 0 ? "is-up" : "is-down"}`} style={{ width: `${Math.round((Math.abs(r.net) / reach) * 100)}%` }} aria-hidden="true" />
                <span className="sb-rank">{i + 1}</span>
                <span className={`sb-face ${r.pick ? `is-${r.pick.toLowerCase()}` : ""}`}>
                  <Avatar avatar={p?.avatar} seed={r.address} name={p?.displayName || p?.username} size={38} />
                </span>
                <span className="sb-who">
                  <strong>{name}{you ? <em>you</em> : null}</strong>
                  <small>
                    {r.bets === 0 ? "No calls yet" : `${r.bets} ${r.bets === 1 ? "call" : "calls"}`}
                    {r.open > 0 && <b className="sb-open"> · ${r.open.toFixed(2)} live</b>}
                  </small>
                </span>
                {r.pick && (
                  <span className={`sb-pick is-${r.pick.toLowerCase()}`} title={`Has money on ${r.pick === "BOTH" ? "both sides" : r.pick.toLowerCase()} right now`}>
                    {r.pick !== "BELOW" && <ArrowUp weight="bold" />}
                    {r.pick !== "ABOVE" && <ArrowDown weight="bold" />}
                  </span>
                )}
                <b key={r.net.toFixed(2)} className={`sb-net ${r.net > 0 ? "is-up" : r.net < 0 ? "is-down" : ""}`}>{money(r.net)}</b>
              </motion.li>
            );
          })}
        </ol>
      )}
      {!loading && !anyCalls && <p className="sb-empty">Nobody has called it yet. The first stake lights this up.</p>}
    </section>
  );
}
