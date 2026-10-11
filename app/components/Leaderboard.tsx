"use client";

import { useEffect, useState } from "react";
import { Trophy } from "@phosphor-icons/react";
import { explorerAddress } from "@/lib/chain/config";

/**
 * Who is actually ahead, from the event index.
 *
 * Net is claims paid minus everything staked, so the ranking is settled money rather than
 * volume or activity. Unclaimed wins count as spent until they are collected, which
 * understates a trader who has not claimed — the honest reading of the chain.
 */
interface Trader {
  address: string;
  bets: number;
  staked: number;
  returned: number;
  net: number;
}

const MEDAL = ["is-gold", "is-silver", "is-bronze"];

export function Leaderboard({ you }: { you?: string | null }) {
  const [data, setData] = useState<{ traders: Trader[]; totals: { traders: number; bets: number; staked: number } } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let off = false;
    async function load() {
      try {
        const r = await fetch("/api/leaderboard");
        if (!r.ok) throw new Error();
        const b = await r.json();
        if (!off) { setData(b); setError(false); }
      } catch {
        if (!off) setError(true);
      }
    }
    void load();
    const t = setInterval(load, 20_000);
    return () => { off = true; clearInterval(t); };
  }, []);

  if (error) return <div className="page-empty">The leaderboard index is unreachable right now.</div>;
  if (!data) return <div className="page-empty">Loading the leaderboard…</div>;
  if (data.traders.length === 0) return <div className="page-empty">No settled trades yet. The first winner tops the board.</div>;

  return (
    <section className="leaderboard">
      <div className="stat-row">
        <div className="stat"><span>Traders</span><strong>{data.totals.traders}</strong></div>
        <div className="stat"><span>Stakes placed</span><strong>{data.totals.bets}</strong></div>
        <div className="stat"><span>Total staked</span><strong>${data.totals.staked.toFixed(2)}</strong></div>
      </div>

      <div className="stake-table lb-table" role="table">
        <div className="stake-head" role="row">
          <span>#</span><span>Trader</span><span>Stakes</span><span>Staked</span><span>Returned</span><span>Net</span>
        </div>
        {data.traders.map((t, i) => (
          <div key={t.address} className={`stake-row ${i < 3 ? MEDAL[i] : ""} ${you && t.address === you.toLowerCase() ? "is-you" : ""}`} role="row">
            <span className="lb-rank">{i + 1}</span>
            <span className="stake-market">
              <a href={explorerAddress(t.address)} target="_blank" rel="noreferrer">
                <strong className="mono">{t.address.slice(0, 6)}…{t.address.slice(-4)}</strong>
              </a>
              {you && t.address === you.toLowerCase() && <small>you</small>}
            </span>
            <span className="mono">{t.bets}</span>
            <span className="mono">${t.staked.toFixed(2)}</span>
            <span className="mono">${t.returned.toFixed(2)}</span>
            <span className={`mono lb-net ${t.net >= 0 ? "is-up" : "is-down"}`}>
              {t.net >= 0 ? "+" : "−"}${Math.abs(t.net).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <p className="page-foot">
        <Trophy weight="bold" /> Net is what claims paid minus everything staked, read from the on-chain index.
        Winnings not yet collected still count as spent.
      </p>
    </section>
  );
}
