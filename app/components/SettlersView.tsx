"use client";

import { useEffect, useMemo, useState } from "react";
import { AccountShell } from "@/components/AccountShell";
import { ADMIN, OUTCOME, toUsd, explorerAddress } from "@/lib/chain/config";
import { FEEDS } from "@/lib/pyth";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * Who actually settles Tick's markets, read from the Envio index.
 *
 * Settlement is permissionless and pays the caller half the market's fee, so the honest
 * measure of whether that works is how much of it is done by someone other than the app's
 * own server, and how fast. This page reports exactly that, including when the answer is
 * "mostly us".
 */
const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL;

interface Row {
  id: string;
  feedId: string;
  closesAt: number;
  outcome: number;
  settler: string;
  bounty: string | null;
  settledAt: number;
}

const QUERY = `{
  Market(where: { outcome: { _neq: 0 }, settledAt: { _is_null: false } }, order_by: { settledAt: desc }, limit: 400) {
    id feedId closesAt outcome settler bounty settledAt
  }
}`;

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const isApp = (a: string) => a.toLowerCase() === ADMIN.toLowerCase();

export function SettlersView() {
  const wallet = useTickWallet();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!INDEXER) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(INDEXER!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: QUERY }),
        });
        const json = (await res.json()) as { data?: { Market: Row[] } };
        if (!json.data) throw new Error("the index returned no data");
        if (!cancelled) {
          setRows(json.data.Market.filter((r) => r.settler));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const stats = useMemo(() => {
    if (!rows) return null;
    const bySettler = new Map<string, { n: number; bounty: bigint; lat: number[] }>();
    let paid = 0n;
    for (const r of rows) {
      const k = r.settler.toLowerCase();
      const e = bySettler.get(k) ?? { n: 0, bounty: 0n, lat: [] };
      e.n++;
      e.bounty += BigInt(r.bounty ?? "0");
      e.lat.push(r.settledAt - r.closesAt);
      bySettler.set(k, e);
      paid += BigInt(r.bounty ?? "0");
    }
    const others = rows.filter((r) => !isApp(r.settler)).length;
    return {
      total: rows.length,
      paid,
      medianLatency: median(rows.map((r) => r.settledAt - r.closesAt)),
      othersPct: rows.length ? (others / rows.length) * 100 : 0,
      board: [...bySettler.entries()]
        .map(([addr, v]) => ({ addr, n: v.n, bounty: v.bounty, latency: median(v.lat) }))
        .sort((a, b) => b.n - a.n),
    };
  }, [rows]);

  return (
    <AccountShell active="settlers" wallet={wallet}>
      <section className="page-intro">
        <h1>Settlers</h1>
        <p>
          Anyone can settle a closed market with Pyth&apos;s signed price and keep half its fee. This is who has, and how fast, read
          from the on-chain event index.
        </p>
      </section>

      {!INDEXER ? (
        <div className="page-empty">Set NEXT_PUBLIC_INDEXER_URL to read settlement history from the Envio index.</div>
      ) : error ? (
        <div className="page-empty">The index is unreachable right now: {error}</div>
      ) : !stats ? (
        <div className="page-empty">Loading from the index…</div>
      ) : stats.total === 0 ? (
        <div className="page-empty">No settled markets indexed yet.</div>
      ) : (
        <>
          <section className="stat-row" aria-label="Settlement summary">
            <div className="stat"><span>Markets settled</span><strong>{stats.total}</strong></div>
            <div className="stat"><span>Paid to settlers</span><strong>{toUsd(stats.paid).toFixed(2)}</strong></div>
            <div className="stat">
              <span>Median time to settle</span>
              <strong>{stats.medianLatency === null ? "-" : `${stats.medianLatency}s`}</strong>
            </div>
            <div className="stat">
              <span>Settled by someone else</span>
              <strong>{stats.othersPct.toFixed(0)}%</strong>
            </div>
          </section>

          <h2 className="section-title">Leaderboard</h2>
          <div className="stake-table settler-table" role="table">
            <div className="stake-head" role="row">
              <span>Settler</span>
              <span>Markets</span>
              <span>Bounties earned</span>
              <span>Median speed</span>
            </div>
            {stats.board.map((s) => (
              <div key={s.addr} className="stake-row" role="row">
                <span className="stake-market">
                  <a href={explorerAddress(s.addr)} target="_blank" rel="noreferrer"><strong className="mono">{short(s.addr)}</strong></a>
                  {isApp(s.addr) && <small>Tick&apos;s app server</small>}
                </span>
                <span className="mono">{s.n}</span>
                <span className="mono">{toUsd(s.bounty).toFixed(2)} USDC</span>
                <span className="mono">{s.latency === null ? "-" : `${s.latency}s`}</span>
              </div>
            ))}
          </div>

          <h2 className="section-title">Recent settlements</h2>
          <div className="stake-table settler-table" role="table">
            <div className="stake-head" role="row">
              <span>Market</span>
              <span>Outcome</span>
              <span>Settler</span>
              <span>After close</span>
            </div>
            {rows!.slice(0, 15).map((r) => {
              const feed = FEEDS.find((f) => f.id.toLowerCase() === r.feedId.toLowerCase());
              return (
                <div key={r.id} className="stake-row" role="row">
                  <span className="stake-market">
                    <strong>{feed?.symbol ?? "?"}</strong>
                    <small>{new Date(r.closesAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
                  </span>
                  <span>{r.outcome === OUTCOME.above ? "ABOVE" : r.outcome === OUTCOME.below ? "BELOW" : "VOID"}</span>
                  <span className="mono">{short(r.settler)}{isApp(r.settler) ? " (app)" : ""}</span>
                  <span className="mono">{r.settledAt - r.closesAt}s{r.bounty && BigInt(r.bounty) > 0n ? ` · +${toUsd(BigInt(r.bounty)).toFixed(2)}` : ""}</span>
                </div>
              );
            })}
          </div>

          <section className="settler-cta">
            <h2>Run a settler</h2>
            <p>
              Any wallet holding a little MON can do this. It finds closed markets from the event log, fetches Pyth&apos;s first price
              after the close, and keeps the bounty. No account, no permission.
            </p>
            <pre><code>cd app && npm install{"\n"}SETTLER_PK=&lt;a testnet-only key&gt; npm run settler</code></pre>
          </section>
        </>
      )}
    </AccountShell>
  );
}
