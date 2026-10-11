"use client";

import Image from "next/image";
import { useState } from "react";
import { Info, SealCheck } from "@phosphor-icons/react";
import { OddsChart, type OddsPoint } from "@/components/OddsChart";
import { useSportsStake } from "@/lib/useSportsStake";
import type { WalletClient } from "viem";

/**
 * One fixture as a market: both teams, what each side pays, and one tap to take it.
 *
 * The referee notice is not fine print. A price market here settles on a signature Pyth
 * produced, which nobody can forge; a fixture settles on a signature OURS produced over a
 * public scoreboard. That is a weaker promise and the card says so where the money is,
 * rather than in a footer nobody reads.
 */
export interface SportsEvent {
  id: `0x${string}`;
  espnId: string;
  eventId: `0x${string}`;
  league: string;
  name: string;
  home: { name: string; abbr: string; score: number | null; logo: string | null };
  away: { name: string; abbr: string; score: number | null; logo: string | null };
  kickoff: number;
  state: "pre" | "in" | "post";
  completed: boolean;
  outcome: number | null;
  poolHome: number;
  poolAway: number;
  volume: number;
  impliedHome: number;
  settledOutcome: number;
  open: boolean;
  secondsToKickoff: number;
}

const AMOUNTS = [2, 5, 10, 25];

function payout(win: number, lose: number): number {
  if (lose <= 0) return 1;
  if (win <= 0) return 1 + lose;
  return 1 + (lose / win) * 0.98;
}

function until(s: number): string {
  if (s <= 0) return "started";
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

export function SportsCard({
  event,
  series,
  walletClient,
  account,
  onNotice,
}: {
  event: SportsEvent;
  series: OddsPoint[];
  walletClient: WalletClient | null;
  account: `0x${string}` | null;
  onNotice: (message: string) => void;
}) {
  const stake = useSportsStake(walletClient, account);
  const [amount, setAmount] = useState(5);
  const [pending, setPending] = useState<"HOME" | "AWAY" | null>(null);
  const homeOdds = event.impliedHome;

  async function place(side: "HOME" | "AWAY") {
    setPending(null);
    const team = side === "HOME" ? event.home.name : event.away.name;
    const result = await stake.submit(
      { eventId: event.eventId, closesAt: BigInt(event.kickoff) },
      side === "HOME",
      amount,
      team
    );
    onNotice(result.message);
    void result.confirm?.then((done) => onNotice(done.message));
  }

  const settled = event.settledOutcome !== 0;
  const resultLabel =
    event.settledOutcome === 1 ? `${event.home.abbr} won` : event.settledOutcome === 2 ? `${event.away.abbr} won` : "Voided — refunded";

  return (
    <article className="board-card sports-card">
      <header className="board-card-head">
        <span className="board-card-cat">{event.league}</span>
        <span className={`board-clock ${event.secondsToKickoff <= 900 && event.open ? "is-urgent" : ""}`}>
          {settled ? resultLabel : event.open ? `in ${until(event.secondsToKickoff)}` : event.state === "in" ? "live" : "awaiting result"}
        </span>
      </header>

      <h2 className="board-card-title">{event.away.abbr} at {event.home.abbr}</h2>
      <p className="sports-sub">
        {event.name}
        {event.home.score !== null && event.state !== "pre" && (
          <strong> · {event.home.abbr} {event.home.score}–{event.away.score} {event.away.abbr}</strong>
        )}
      </p>

      <div className="board-card-body">
        <div className="board-outcomes">
          <div className="board-outcome-head"><span>Team</span><span>Pays</span><span>Odds</span></div>
          {([["HOME", event.home, homeOdds, event.poolHome, event.poolAway], ["AWAY", event.away, 100 - homeOdds, event.poolAway, event.poolHome]] as const).map(
            ([side, team, odds, mine, theirs]) => (
              <button
                key={side}
                type="button"
                className={`board-outcome sports-pick tone-${side === "HOME" ? "up" : "down"}`}
                disabled={!event.open || stake.busy}
                onClick={() => setPending(side as "HOME" | "AWAY")}
              >
                <span className="board-outcome-name">
                  {team.logo && <Image src={team.logo} alt="" width={16} height={16} />}
                  {team.name}
                  <i style={{ width: `${odds}%` }} />
                </span>
                <span className="board-pays">{payout(mine, theirs).toFixed(2)}x</span>
                <span className="board-odds">{odds.toFixed(0)}%</span>
              </button>
            )
          )}
          <div className="board-card-foot">
            <span>${event.volume.toFixed(2)} pool</span>
            {event.open && (
              <span className="sports-amounts">
                {AMOUNTS.map((v) => (
                  <button key={v} type="button" className={amount === v ? "is-active" : ""} onClick={() => setAmount(v)}>{v}</button>
                ))}
              </span>
            )}
          </div>
          {stake.busy && <p className="sports-step">{stake.step || "Working…"}</p>}
        </div>

        <div className="board-chart">
          <div className="board-legend">
            <span className="tone-up"><i />{event.home.abbr} {homeOdds.toFixed(0)}%</span>
            <span className="tone-down"><i />{event.away.abbr} {(100 - homeOdds).toFixed(0)}%</span>
          </div>
          <OddsChart series={series} above={homeOdds} />
          <p className="sports-referee">
            <SealCheck weight="bold" />
Result attested by a named key from the public scoreboard — a weaker promise than
            the Pyth-settled price markets, in its own contract.
          </p>
        </div>
      </div>

      {pending && (
        <div className="confirm-scrim" role="dialog" aria-modal="true" onClick={() => setPending(null)}>
          <div className={`confirm-card tone-${pending === "HOME" ? "up" : "down"}`} onClick={(e) => e.stopPropagation()}>
            <span className="confirm-eyebrow">{event.league} · kicks off in {until(event.secondsToKickoff)}</span>
            <strong className="confirm-title">
              {amount} USDC on <em>{pending === "HOME" ? event.home.name : event.away.name}</em>
            </strong>
            <p className="confirm-detail">
              Wins about {(amount * payout(pending === "HOME" ? event.poolHome : event.poolAway, pending === "HOME" ? event.poolAway : event.poolHome)).toFixed(2)} USDC. A draw or a
              cancelled fixture refunds everyone.
            </p>
            <p className="confirm-detail is-warn">
              <Info weight="bold" /> This result is attested by Tick&apos;s key from the public scoreboard.
            </p>
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className="confirm-go" onClick={() => void place(pending)} autoFocus>Stake</button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
