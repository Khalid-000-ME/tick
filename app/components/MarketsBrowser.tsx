"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Moon, Sun } from "@phosphor-icons/react";
import { Brand } from "@/components/Brand";
import { OddsChart, type OddsPoint } from "@/components/OddsChart";
import { CardBanner } from "@/components/CardBanner";
import { StrikeStepper } from "@/components/StrikeStepper";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, toUsd as toUsdc } from "@/lib/chain/config";
import { marketId } from "@/lib/chain/market";
import { readClient } from "@/lib/useWallet";
import { SportsCard, type SportsEvent } from "@/components/SportsCard";
import { NewsPanel } from "@/components/NewsPanel";
import { TickerStrip } from "@/components/TickerStrip";
import { nextOpenLabel } from "@/lib/marketHours";
import { MicroBoard } from "@/components/MicroMarkets";
import { WalletMenu } from "@/components/WalletMenu";
import { DURATIONS } from "@/lib/chain/config";
import { useTheme } from "@/lib/useTheme";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * Every market on offer, as cards you pick from.
 *
 * The terminal only ever showed one market: the thirty-second window for whichever asset
 * was selected. That hides the actual product, which is a board of markets opening and
 * closing continuously. This lists each asset across each window length, with both sides'
 * odds, what each pays, the pool, and the clock — so choosing a market is browsing rather
 * than configuring one.
 */

export interface LiveMarket {
  id: string;
  symbol: string;
  label: string;
  kind: "crypto" | "equity";
  feedId: string;
  expo: number;
  windowS: number;
  windowLabel: string;
  closesAt: number;
  secondsLeft: number;
  strike: string;
  price: string | null;
  poolAbove: number;
  poolBelow: number;
  volume: number;
  impliedAbove: number;
  closed: boolean;
  windows: number[];
  windowLabels: string[];
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n >= 1000 ? 0 : 2, maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;

/** What one unit staked returns if this side wins, from the pools as they stand. */
function payout(win: number, lose: number): number {
  if (lose <= 0) return 1;
  if (win <= 0) return 1 + lose;
  const profit = lose / win;
  return 1 + profit * 0.98; // 2% of profit is the published fee
}

const clock = (s: number) => (s <= 0 ? "closing" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

export function MarketsBrowser() {
  const wallet = useTickWallet();
  const { theme, toggle } = useTheme();
  const [markets, setMarkets] = useState<LiveMarket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "crypto" | "equity" | "sports">("all");
  const [sports, setSports] = useState<SportsEvent[] | null>(null);
  const [windowS, setWindowS] = useState<number | "all">("all");
  const [symbol, setSymbol] = useState<string | "all">("all");
  // Odds history is rendered, so it lives in state; a ref read during render can paint a
  // stale series.
  const [history, setHistory] = useState<Map<string, OddsPoint[]>>(new Map());

  useEffect(() => {
    let off = false;
    async function load() {
      try {
        const res = await fetch("/api/markets/live");
        const body = (await res.json()) as { markets?: LiveMarket[]; error?: string };
        if (off) return;
        if (!res.ok || !body.markets) throw new Error(body.error ?? "unavailable");
        // Odds history accumulates while the page is open, so the chart on each card is
        // genuinely observed rather than drawn from nothing.
        const t = Math.floor(Date.now() / 1000);
        setHistory((prev) => {
          const next = new Map(prev);
          for (const m of body.markets!) {
            const key = `${m.feedId}:${m.windowS}:${m.closesAt}`;
            const series = next.get(key) ?? [];
            const last = series[series.length - 1];
            if (!last || last.above !== m.impliedAbove) {
              next.set(key, [...series, { t, above: m.impliedAbove }].slice(-120));
            }
          }
          return next;
        });
        setMarkets(body.markets);
        setError(null);
      } catch (e) {
        if (!off) setError((e as Error).message);
      }
    }
    async function loadSports() {
      try {
        const res = await fetch("/api/sports/events");
        const body = (await res.json()) as { events?: SportsEvent[] };
        if (!off && body.events) {
          setSports(body.events);
          const t = Math.floor(Date.now() / 1000);
          setHistory((prev) => {
            const next = new Map(prev);
            for (const e of body.events!) {
              const series = next.get(e.id) ?? [];
              const last = series[series.length - 1];
              if (!last || last.above !== e.impliedHome) next.set(e.id, [...series, { t, above: e.impliedHome }].slice(-120));
            }
            return next;
          });
        }
      } catch {
        if (!off) setSports([]);
      }
    }

    void load();
    void loadSports();
    const timer = setInterval(load, 2500);
    const sportsTimer = setInterval(loadSports, 20_000);
    return () => {
      off = true;
      clearInterval(timer);
      clearInterval(sportsTimer);
    };
  }, []);

  const shown = useMemo(() => {
    if (!markets) return [];
    return markets
      .filter((m) => (kind === "all" ? true : m.kind === kind))
      .filter((m) => (windowS === "all" ? true : m.windows.includes(windowS)))
      .filter((m) => (symbol === "all" ? true : m.symbol === symbol))
      .sort((a, b) => b.volume - a.volume || a.secondsLeft - b.secondsLeft);
  }, [markets, kind, windowS, symbol]);

  const [featured, ...rest] = shown;

  return (
    <div className="terminal-shell page-shell board-shell">
      <header className="terminal-header page-header">
        <Link href="/" className="terminal-back" aria-label="Home"><ArrowLeft /></Link>
        <Brand />
        <nav className="terminal-nav page-nav" aria-label="Sections">
          <Link href="/markets" aria-current="page">Markets</Link>
          <Link href="/trade">Terminal</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/fund">Fund</Link>
        </nav>
        <button className="theme-toggle" type="button" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun weight="bold" /> : <Moon weight="bold" />}
        </button>
        <WalletMenu wallet={wallet} />
      </header>
      <TickerStrip mode={kind} />

      <main className="board-main">
        <div className="board-head">
          <h1>Markets</h1>
          <p>Every asset, every window length. A new one opens as each closes.</p>
        </div>

        <div className="board-filters">
          <div className="filter-row board-cats" role="tablist" aria-label="Category">
            {([["all", "All"], ["crypto", "Crypto"], ["equity", "Equities"], ["sports", "Sports"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "is-active" : ""} onClick={() => { setKind(k); setSymbol("all"); }}>{l}</button>
            ))}
          </div>
          {kind !== "sports" && <div className="board-durations" role="tablist" aria-label="Window length">
            <button type="button" role="tab" aria-selected={windowS === "all"} className={windowS === "all" ? "is-active" : ""} onClick={() => setWindowS("all")}>All</button>
            {DURATIONS.map((d) => (
              <button key={d.seconds} type="button" role="tab" aria-selected={windowS === d.seconds} className={windowS === d.seconds ? "is-active" : ""} onClick={() => setWindowS(d.seconds)}>{d.label}</button>
            ))}
          </div>}
        </div>

        {kind !== "sports" && markets && (
          <div className="board-assets" role="tablist" aria-label="Asset">
            <button type="button" role="tab" aria-selected={symbol === "all"} className={symbol === "all" ? "is-active" : ""} onClick={() => setSymbol("all")}>
              All assets
            </button>
            {[...new Set(markets.filter((m) => (kind === "all" ? true : m.kind === kind)).map((m) => m.symbol))].map((sym) => (
              <button key={sym} type="button" role="tab" aria-selected={symbol === sym} className={symbol === sym ? "is-active" : ""} onClick={() => setSymbol(sym)}>
                {sym.replace("/USD", "")}
              </button>
            ))}
          </div>
        )}

        {kind === "sports" ? (
          sports === null ? (
            <div className="page-empty">Loading fixtures…</div>
          ) : sports.length === 0 ? (
            <div className="page-empty">No fixtures from the scoreboard right now.</div>
          ) : (
            <>
            <div className="board-sports">
              <div className="board-sports-main">
                <MicroBoard />
                <div className="board-grid">
                  {sports.map((e) => (
                    <SportsCard key={e.id} event={e} />
                  ))}
                </div>
              </div>
              <NewsPanel topic="sports" variant="panel" title="Sports news" limit={12} />
            </div>
            </>
          )
        ) : error ? (
          <div className="page-empty">Markets are unavailable right now: {error}</div>
        ) : !markets ? (
          <div className="page-empty">Loading the board…</div>
        ) : shown.length === 0 ? (
          <div className="page-empty">No markets match that filter.</div>
        ) : (
          <>
            <MarketCard market={featured} series={history.get(`${featured.feedId}:${featured.windowS}:${featured.closesAt}`) ?? []} featured />
            <div className="board-grid">
              {rest.map((m) => (
                <MarketCard key={m.id} market={m} series={history.get(`${m.feedId}:${m.windowS}:${m.closesAt}`) ?? []} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Prices under a dollar need their cents and more; a strike that rounds to $0.09 is useless. */
const usd = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: v < 1 ? 4 : 2 });

function MarketCard({ market, series, featured = false }: { market: LiveMarket; series: OddsPoint[]; featured?: boolean }) {
  // A price the trader picked on this card. Each strike is its own pool, so its odds are
  // read from the chain rather than borrowed from the opening strike's.
  const [chosen, setChosen] = useState<bigint | null>(null);
  const [chosenPools, setChosenPools] = useState<{ above: number; below: number } | null>(null);
  const openStrike = BigInt(market.strike);

  useEffect(() => {
    if (chosen === null) return;
    let off = false;
    const id = marketId({ feedId: market.feedId as `0x${string}`, strike: chosen, expo: market.expo, closesAt: BigInt(market.closesAt) });
    void (readClient.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "pools", args: [id] }) as Promise<readonly [bigint, bigint]>)
      .then(([a, b]) => { if (!off) setChosenPools({ above: toUsdc(a), below: toUsdc(b) }); })
      .catch(() => {});
    return () => { off = true; };
  }, [chosen, market.feedId, market.expo, market.closesAt]);

  const strikeUnits = chosen ?? openStrike;
  const strike = Number(strikeUnits) * 10 ** market.expo;
  const price = market.price === null ? null : Number(market.price) * 10 ** market.expo;
  const pools = chosen === null ? { above: market.poolAbove, below: market.poolBelow } : chosenPools ?? { above: 0, below: 0 };
  const total = pools.above + pools.below;
  const above = chosen === null ? market.impliedAbove : total === 0 ? 50 : (pools.above / total) * 100;
  const href = `/trade?feed=${encodeURIComponent(market.symbol)}&window=${market.windowS}${chosen === null ? "" : `&strike=${chosen}`}`;
  // Which side the market is currently on, so the spot figure says something at a glance.
  const leaning = price === null ? null : price >= strike ? "up" : "down";

  return (
    <article className={`board-card has-banner ${featured ? "is-featured" : ""} ${market.closed ? "is-closed" : ""}`}>
      <Link href={href} className="card-hit" aria-label={`Open ${market.symbol}, ${market.windowLabel}`} />
      <CardBanner
        symbol={market.symbol}
        label={market.label}
        window={market.windowLabels.join(" / ")}
        status={market.closed ? (market.kind === "equity" ? `Opens ${nextOpenLabel().replace(" ET", "")}` : "Closed") : clock(market.secondsLeft)}
        urgent={!market.closed && market.secondsLeft <= 10}
        tall={featured}
      />

      <div className="board-card-title strike-title">
        <span>Above</span>
        <StrikeStepper open={openStrike} value={chosen} expo={market.expo} onChange={setChosen} compact />
      </div>

      <div className={`board-card-body ${featured ? "" : "is-compact"}`}>
        <div className="board-outcomes">
          <Link href={href} className="board-outcome tone-up">
            <span className="board-outcome-name">Above<i style={{ width: `${above}%` }} /></span>
            <span className="board-pays">{payout(pools.above, pools.below).toFixed(2)}x</span>
            <span className="board-odds">{above.toFixed(0)}%</span>
          </Link>
          <Link href={href} className="board-outcome tone-down">
            <span className="board-outcome-name">Below<i style={{ width: `${100 - above}%` }} /></span>
            <span className="board-pays">{payout(pools.below, pools.above).toFixed(2)}x</span>
            <span className="board-odds">{(100 - above).toFixed(0)}%</span>
          </Link>
          <div className="board-card-foot">
            <span>{money(total)} pool</span>
            {price !== null && <span className={`spot is-${leaning}`}>now ${usd(price)}</span>}
          </div>
        </div>
        <div className="board-chart">
          <OddsChart series={series} above={above} tall={featured} />
        </div>
      </div>
    </article>
  );
}
