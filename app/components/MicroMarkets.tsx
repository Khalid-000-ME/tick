"use client";

import { useEffect, useState } from "react";
import { Lightning } from "@phosphor-icons/react";
import { useSportsStake } from "@/lib/useSportsStake";
import type { WalletClient } from "viem";

/**
 * In-play markets: "who scores next in the next N minutes — home, away, or nobody?"
 *
 * The short-duration idea from the price side, applied to a running match. A match result
 * takes ninety minutes; a goal window takes two, so the same thirty-second-to-five-minute
 * cadence works here as long as a match is actually in play.
 *
 * "Nobody scored" refunds rather than paying a side, which is the honest outcome when
 * there was nothing to win — and it is also what the contract's VOID already does, so this
 * needed no new settlement logic. Each card shows the descriptor its market id commits to,
 * including the opening scoreline, so the result can be checked against the scoreboard.
 */
interface MicroMarket {
  id: `0x${string}`;
  eventId: `0x${string}`;
  descriptor: string;
  espnId: string;
  league: string;
  name: string;
  home: { name: string; abbr: string; score: number | null };
  away: { name: string; abbr: string; score: number | null };
  windowS: number;
  windowLabel: string;
  closesAt: number;
  secondsLeft: number;
  openHome: number;
  openAway: number;
  poolHome: number;
  poolAway: number;
  volume: number;
  impliedHome: number;
}

const AMOUNTS = [2, 5, 10];

function payout(win: number, lose: number): number {
  if (lose <= 0) return 1;
  if (win <= 0) return 1 + lose;
  return 1 + (lose / win) * 0.98;
}

export function MicroMarkets({
  walletClient,
  account,
  onNotice,
}: {
  walletClient: WalletClient | null;
  account: `0x${string}` | null;
  onNotice: (message: string) => void;
}) {
  const [markets, setMarkets] = useState<MicroMarket[] | null>(null);
  const [window_, setWindow] = useState(120);
  const [amount, setAmount] = useState(2);
  const stake = useSportsStake(walletClient, account);

  useEffect(() => {
    let off = false;
    async function load() {
      try {
        const res = await fetch("/api/sports/micro");
        const body = (await res.json()) as { markets?: MicroMarket[] };
        if (!off) setMarkets(body.markets ?? []);
      } catch {
        if (!off) setMarkets([]);
      }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, []);

  if (markets === null) return <p className="micro-empty">Checking for matches in play…</p>;
  if (markets.length === 0) {
    return (
      <p className="micro-empty">
        No match is in play right now. In-play windows open automatically the moment one kicks off.
      </p>
    );
  }

  const shown = markets.filter((m) => m.windowS === window_);
  const windows = [...new Set(markets.map((m) => m.windowS))].sort((a, b) => a - b);

  async function place(m: MicroMarket, home: boolean) {
    const team = home ? m.home.name : m.away.name;
    const res = await stake.submit(
      { eventId: m.eventId, closesAt: BigInt(m.closesAt) },
      home,
      amount,
      `${team} to score next`
    );
    onNotice(res.message);
    void res.confirm?.then((d) => onNotice(d.message));
  }

  return (
    <section className="micro-section">
      <header className="micro-head">
        <h2><Lightning weight="fill" /> In play</h2>
        <div className="board-durations">
          {windows.map((w) => (
            <button key={w} type="button" className={window_ === w ? "is-active" : ""} onClick={() => setWindow(w)}>
              {markets.find((m) => m.windowS === w)?.windowLabel}
            </button>
          ))}
        </div>
        <div className="sports-amounts">
          {AMOUNTS.map((v) => (
            <button key={v} type="button" className={amount === v ? "is-active" : ""} onClick={() => setAmount(v)}>{v}</button>
          ))}
        </div>
      </header>

      <div className="board-grid">
        {shown.map((m) => (
          <article key={m.id} className="board-card micro-card">
            <header className="board-card-head">
              <span className="board-card-cat">{m.league} · live</span>
              <span className={`board-clock ${m.secondsLeft <= 15 ? "is-urgent" : ""}`}>{Math.max(0, m.secondsLeft)}s</span>
            </header>
            <h3 className="board-card-title">Who scores in the next {m.windowLabel}?</h3>
            <p className="sports-sub">
              {m.name} · <strong>{m.openHome}–{m.openAway}</strong> at window open
            </p>

            <div className="board-outcomes">
              <button type="button" className="board-outcome sports-pick tone-up" disabled={stake.busy || m.secondsLeft <= 2} onClick={() => void place(m, true)}>
                <span className="board-outcome-name">{m.home.abbr}<i style={{ width: `${m.impliedHome}%` }} /></span>
                <span className="board-pays">{payout(m.poolHome, m.poolAway).toFixed(2)}x</span>
                <span className="board-odds">{m.impliedHome.toFixed(0)}%</span>
              </button>
              <button type="button" className="board-outcome sports-pick tone-down" disabled={stake.busy || m.secondsLeft <= 2} onClick={() => void place(m, false)}>
                <span className="board-outcome-name">{m.away.abbr}<i style={{ width: `${100 - m.impliedHome}%` }} /></span>
                <span className="board-pays">{payout(m.poolAway, m.poolHome).toFixed(2)}x</span>
                <span className="board-odds">{(100 - m.impliedHome).toFixed(0)}%</span>
              </button>
              <div className="board-card-foot">
                <span>${m.volume.toFixed(2)} pool</span>
                <span>nobody scores → refund</span>
              </div>
            </div>
            <code className="micro-descriptor" title="What this market's id commits to">{m.descriptor}</code>
          </article>
        ))}
      </div>
      {stake.busy && <p className="micro-empty">{stake.step || "Working…"}</p>}
    </section>
  );
}
