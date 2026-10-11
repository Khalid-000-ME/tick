"use client";

import Image from "next/image";
import Link from "next/link";
import { FixtureBanner } from "@/components/CardBanner";

/**
 * A fixture on the board: who is playing, the state of the match, and what each side pays.
 * The card is a door to the match page, where the staking, the odds history, the in-play
 * windows and the result all live, so nothing here is said twice.
 */
export interface SportsEvent {
  id: `0x${string}`;
  espnId: string;
  eventId: `0x${string}`;
  league: string;
  name: string;
  home: { name: string; short: string; abbr: string; score: number | null; logo: string | null };
  away: { name: string; short: string; abbr: string; score: number | null; logo: string | null };
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

export function payout(win: number, lose: number): number {
  if (lose <= 0) return 1;
  if (win <= 0) return 1 + lose;
  return 1 + (lose / win) * 0.98;
}

export function until(s: number): string {
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

/** One short status, in priority order: settled result, live, finished, countdown. */
export function fixtureStatus(e: SportsEvent): { text: string; live: boolean } {
  if (e.settledOutcome === 1) return { text: `${e.home.abbr} won`, live: false };
  if (e.settledOutcome === 2) return { text: `${e.away.abbr} won`, live: false };
  if (e.settledOutcome === 3) return { text: "Refunded", live: false };
  if (e.state === "in") return { text: "Live", live: true };
  if (e.state === "post") return { text: "Final", live: false };
  return { text: `in ${until(e.secondsToKickoff)}`, live: false };
}

export function SportsCard({ event }: { event: SportsEvent }) {
  const href = `/sports/${event.espnId}`;
  const status = fixtureStatus(event);
  const sides = [
    { team: event.home, odds: event.impliedHome, mine: event.poolHome, theirs: event.poolAway, tone: "up" },
    { team: event.away, odds: 100 - event.impliedHome, mine: event.poolAway, theirs: event.poolHome, tone: "down" },
  ] as const;

  return (
    <article className={`board-card sports-card has-banner ${event.open ? "" : "is-closed"}`}>
      <Link href={href} className="card-hit" aria-label={`Open ${event.name}`} />
      <FixtureBanner league={event.league} status={status.text} live={status.live} home={event.home} away={event.away} showScore={event.state !== "pre"} />

      <div className="board-outcomes sports-outcomes">
        {sides.map(({ team, odds, mine, theirs, tone }) => (
          <Link key={team.abbr} href={href} className={`board-outcome sports-pick tone-${tone}`}>
            <span className="board-outcome-name">
              {team.logo && <Image src={team.logo} alt="" width={16} height={16} />}
              <span>{team.short}</span>
              <i style={{ width: `${odds}%` }} />
            </span>
            <span className="board-pays">{payout(mine, theirs).toFixed(2)}x</span>
            <span className="board-odds">{odds.toFixed(0)}%</span>
          </Link>
        ))}
        <div className="board-card-foot">
          <span>${event.volume.toFixed(2)} pool</span>
        </div>
      </div>
    </article>
  );
}
