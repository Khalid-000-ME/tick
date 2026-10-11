"use client";

import { useEffect, useRef, useState } from "react";
import { FEEDS } from "@/lib/pyth";
import { isFrozen } from "@/lib/marketHours";

/**
 * The running strip across the top.
 *
 * One component, four modes, matching the board's tabs:
 *   all / crypto / equity  live Pyth prices for those markets, then the stakes people are
 *                          placing on them. A US equity outside exchange hours is marked
 *                          closed rather than shown as if its frozen price were moving.
 *   sports                 every fixture's score or kickoff with its pool and the crowd's
 *                          lean, then the latest sports stakes from anyone.
 *
 * Everything is real: prices from /api/price/live, price trades from /api/activity, sports
 * from /api/sports/events and /api/sports/activity. With nothing to show the strip holds
 * its height rather than padding itself with invented cells.
 *
 * The marquee repeats its content and translates by exactly one set's width, which is
 * what makes the loop seamless. It pauses on hover and holds still for reduced motion.
 */
export type TickerMode = "all" | "crypto" | "equity" | "sports";

interface Trade { symbol: string; side: "ABOVE" | "BELOW"; amount: number; user: string; at: number | null }
interface Price { symbol: string; price: string; expo: number; publishTime: number }
interface Side { abbr: string; score: number | null }
interface Fixture {
  espnId: string;
  league: string;
  home: Side;
  away: Side;
  state: "pre" | "in" | "post";
  completed: boolean;
  volume: number;
  impliedHome: number;
  secondsToKickoff: number;
}
interface SportsTrade { label: string; team: string; amount: number; user: string; micro: boolean }

/** Rough width of one cell, for sizing the loop. Only affects how often it wraps. */
const CELL_PX = 160;

const fmt = (raw: string, expo: number) => {
  const v = Number(raw) * 10 ** expo;
  // Sub-dollar assets need more than cents, or DOGE at 0.0852 reads as a flat 0.09.
  const d = v < 1 ? 4 : 2;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

const kickoffIn = (s: number) => (s < 3600 ? `in ${Math.max(1, Math.round(s / 60))}m` : `in ${Math.round(s / 3600)}h`);

export function TickerStrip({ mode = "all" }: { mode?: TickerMode }) {
  const [prices, setPrices] = useState<Price[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [sportsTrades, setSportsTrades] = useState<SportsTrade[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Equities with no fresh publish, decided when each price arrives. */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const prev = useRef<Map<string, number>>(new Map());
  const [dir, setDir] = useState<Map<string, "up" | "down">>(new Map());

  useEffect(() => {
    let off = false;
    const timers: ReturnType<typeof setInterval>[] = [];
    const every = (fn: () => Promise<void>, ms: number) => { void fn(); timers.push(setInterval(fn, ms)); };

    if (mode === "sports") {
      every(async () => {
        try {
          const res = await fetch("/api/sports/events");
          const body = (await res.json()) as { events?: Fixture[] };
          if (!off && body.events) { setFixtures(body.events); setLoaded(true); }
        } catch { /* keep what is shown */ }
      }, 5000);
      every(async () => {
        try {
          const res = await fetch("/api/sports/activity");
          const body = (await res.json()) as { trades?: SportsTrade[] };
          if (!off && body.trades) setSportsTrades(body.trades);
        } catch { /* keep what is shown */ }
      }, 6000);
    } else {
      const feeds = FEEDS.filter((f) => mode === "all" || f.kind === mode);
      const symbols = new Set(feeds.map((f) => f.symbol));
      every(async () => {
        try {
          const res = await fetch(`/api/price/live?ids=${feeds.map((f) => f.id).join(",")}`);
          if (!res.ok) return;
          const body = (await res.json()) as { prices?: Price[] };
          if (off || !body.prices) return;
          setDir((old) => {
            const next = new Map(old);
            for (const p of body.prices!) {
              const value = Number(p.price) * 10 ** p.expo;
              const was = prev.current.get(p.symbol);
              if (was !== undefined && value !== was) next.set(p.symbol, value > was ? "up" : "down");
              prev.current.set(p.symbol, value);
            }
            return next;
          });
          setPrices(body.prices);
          setClosed(new Set(body.prices.filter((p) => FEEDS.find((f) => f.symbol === p.symbol)?.kind === "equity" && isFrozen(p.publishTime)).map((p) => p.symbol)));
          setLoaded(true);
        } catch { /* a dropped poll keeps the last prices on screen */ }
      }, 1500);
      every(async () => {
        try {
          const res = await fetch("/api/activity");
          if (!res.ok) return;
          const body = (await res.json()) as { trades?: Trade[] };
          if (!off && body.trades) setTrades(body.trades.filter((t) => symbols.has(t.symbol)));
        } catch { /* same: keep what is already shown */ }
      }, 6000);
    }
    return () => {
      off = true;
      timers.forEach(clearInterval);
    };
  }, [mode]);

  let count = 0;
  let cells: React.ReactNode;
  if (mode === "sports") {
    // What is happening now leads: live games, then the latest stakes, then the next
    // dozen kickoffs, then finals. A long fixture list would otherwise push every stake a
    // minute down the loop.
    const live = fixtures.filter((f) => f.state === "in");
    const next = fixtures.filter((f) => f.state === "pre").sort((a, b) => a.secondsToKickoff - b.secondsToKickoff).slice(0, 12);
    const finals = fixtures.filter((f) => f.state === "post");
    const fixtureCell = (f: Fixture) => (
      <span className={`tick-cell is-fixture is-${f.state}`} key={`f-${f.espnId}`}>
        {f.state === "in" && <i className="tick-live">Live</i>}
        <b>{f.away.abbr}{f.state === "pre" ? " @ " : ` ${f.away.score ?? 0}:${f.home.score ?? 0} `}{f.home.abbr}</b>
        <em>{f.state === "pre" ? kickoffIn(f.secondsToKickoff) : f.state === "post" ? "Final" : f.league}</em>
        {f.volume > 0 ? (
          <small>${f.volume.toFixed(2)} pool · {f.home.abbr} {f.impliedHome.toFixed(0)}%</small>
        ) : f.state !== "in" ? (
          <small>{f.league}</small>
        ) : null}
      </span>
    );
    count = live.length + sportsTrades.length + next.length + finals.length;
    cells = (
      <>
        {live.map(fixtureCell)}
        {sportsTrades.map((t, i) => (
          <span className="tick-cell is-trade" key={`st-${i}`}>
            <i className="side-up">{t.team}</i>
            <b>{t.label}</b>
            <em>{t.amount.toFixed(2)} USDC</em>
            <small>{t.user.slice(0, 6)}…</small>
          </span>
        ))}
        {next.map(fixtureCell)}
        {finals.map(fixtureCell)}
      </>
    );
  } else {
    count = prices.length + trades.length;
    cells = (
      <>
        {prices.map((p) => {
          const shut = closed.has(p.symbol);
          return (
            <span className={`tick-cell ${shut ? "is-closed" : ""}`} key={`p-${p.symbol}`}>
              <b>{p.symbol}</b>
              <em className={!shut && dir.get(p.symbol) ? `is-${dir.get(p.symbol)}` : ""}>${fmt(p.price, p.expo)}</em>
              {shut && <small>closed</small>}
            </span>
          );
        })}
        {trades.map((t, i) => (
          <span className="tick-cell is-trade" key={`t-${i}`}>
            <i className={t.side === "ABOVE" ? "side-up" : "side-down"}>{t.side}</i>
            <b>{t.symbol}</b>
            <em>{t.amount.toFixed(2)} USDC</em>
            <small>{t.user.slice(0, 6)}…</small>
          </span>
        ))}
      </>
    );
  }

  // The strip keeps its height from the first paint. Returning null until data arrives
  // would shift the whole page down by its height the moment it did.
  if (!loaded || count === 0) {
    return <div className="ticker-strip is-waiting" aria-hidden="true" />;
  }

  // A marquee only loops seamlessly while its content is wider than the screen, so the
  // set is repeated until it comfortably outruns a wide viewport, and the track shifts by
  // exactly one set's width (100/reps of the whole track).
  const reps = Math.min(8, Math.max(2, Math.ceil(2400 / Math.max(1, count * CELL_PX))));
  const sets = Array.from({ length: reps });

  return (
    <div className="ticker-strip" aria-label={mode === "sports" ? "Live fixtures and recent sports stakes" : "Live prices and recent stakes"}>
      <div
        className="ticker-track"
        style={{
          ["--shift" as string]: `-${100 / reps}%`,
          ["--dur" as string]: `${Math.max(12, (count * CELL_PX) / 55)}s`,
        }}
      >
        {sets.map((_, i) => (
          <div className="ticker-run" key={i} aria-hidden={i > 0 || undefined}>
            {cells}
          </div>
        ))}
      </div>
    </div>
  );
}
