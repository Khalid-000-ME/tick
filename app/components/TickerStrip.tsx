"use client";

import { useEffect, useRef, useState } from "react";
import { FEEDS } from "@/lib/pyth";

/**
 * The running strip across the top: every market's live price, and the stakes people are
 * actually placing.
 *
 * Both halves are real. Prices come from Pyth through /api/price/live in one request for
 * all four markets; trades come from /api/activity, which reads the Envio index when it is
 * up and the last ~40 seconds of Staked events from the chain when it is not. When there
 * are no recent trades the strip says so instead of padding itself out.
 *
 * The marquee is duplicated and translated by exactly half its width, which is what makes
 * the loop seamless. It pauses on hover so a headline price can be read, and is held still
 * entirely for anyone who asked for reduced motion.
 */
interface Trade {
  symbol: string;
  side: "ABOVE" | "BELOW";
  amount: number;
  user: string;
  at: number | null;
}

interface Price {
  symbol: string;
  price: string;
  expo: number;
  publishTime: number;
}

const fmt = (raw: string, expo: number) => {
  const v = Number(raw) * 10 ** expo;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function TickerStrip() {
  const [prices, setPrices] = useState<Price[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const prev = useRef<Map<string, number>>(new Map());
  const [dir, setDir] = useState<Map<string, "up" | "down">>(new Map());

  useEffect(() => {
    let off = false;
    const ids = FEEDS.map((f) => f.id).join(",");

    async function tick() {
      try {
        const res = await fetch(`/api/price/live?ids=${ids}`);
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
      } catch {
        /* a dropped poll keeps the last prices on screen */
      }
    }

    async function activity() {
      try {
        const res = await fetch("/api/activity");
        if (!res.ok) return;
        const body = (await res.json()) as { trades?: Trade[] };
        if (!off && body.trades) setTrades(body.trades);
      } catch {
        /* same: keep what is already shown */
      }
    }

    void tick();
    void activity();
    const a = setInterval(tick, 1500);
    const b = setInterval(activity, 6000);
    return () => {
      off = true;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const cells = (
    <>
      {prices.map((p) => (
        <span className="tick-cell" key={`p-${p.symbol}`}>
          <b>{p.symbol}</b>
          <em className={dir.get(p.symbol) ? `is-${dir.get(p.symbol)}` : ""}>${fmt(p.price, p.expo)}</em>
        </span>
      ))}
      {trades.length > 0 ? (
        trades.map((t, i) => (
          <span className="tick-cell is-trade" key={`t-${i}`}>
            <i className={t.side === "ABOVE" ? "side-up" : "side-down"}>{t.side}</i>
            <b>{t.symbol}</b>
            <em>{t.amount.toFixed(2)} USDC</em>
            <small>{t.user.slice(0, 6)}…</small>
          </span>
        ))
      ) : (
        <span className="tick-cell is-quiet">No stakes in the last few blocks — take a side and yours shows up here</span>
      )}
    </>
  );

  // The strip keeps its height from the first paint. Returning null until prices arrive
  // would shift the whole page down by its height the moment they did.
  if (prices.length === 0) {
    return <div className="ticker-strip is-waiting" aria-hidden="true" />;
  }

  return (
    <div className="ticker-strip" aria-label="Live prices and recent stakes">
      <div className="ticker-track">
        <div className="ticker-run">{cells}</div>
        <div className="ticker-run" aria-hidden="true">{cells}</div>
      </div>
    </div>
  );
}
