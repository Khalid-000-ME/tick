"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Moon, Sun } from "@phosphor-icons/react";
import { Brand } from "@/components/Brand";
import { OddsChart, type OddsPoint } from "@/components/OddsChart";
import { SportsCard, type SportsEvent } from "@/components/SportsCard";
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
const ICONS: Record<string, string> = {
  "BTC/USD": "/asset-icons/bitcoin.svg",
  "ETH/USD": "/asset-icons/ethereum.svg",
  "SOL/USD": "/asset-icons/solana.svg",
  TSLA: "/asset-icons/tesla.svg",
};

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
  const [notice, setNotice] = useState<string | null>(null);
  const [windowS, setWindowS] = useState<number | "all">("all");
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
      .filter((m) => (windowS === "all" ? true : m.windowS === windowS))
      .sort((a, b) => b.volume - a.volume || a.secondsLeft - b.secondsLeft);
  }, [markets, kind, windowS]);

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
          <Link href="/fund">Fund</Link>
        </nav>
        <button className="theme-toggle" type="button" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun weight="bold" /> : <Moon weight="bold" />}
        </button>
        <WalletMenu wallet={wallet} />
      </header>

      <main className="board-main">
        <div className="board-head">
          <h1>Markets</h1>
          <p>Every asset, every window length. A new one opens as each closes.</p>
        </div>

        <div className="board-filters">
          <div className="filter-row board-cats" role="tablist" aria-label="Category">
            {([["all", "All"], ["crypto", "Crypto"], ["equity", "Equities"], ["sports", "Sports"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "is-active" : ""} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          {kind !== "sports" && <div className="board-durations" role="tablist" aria-label="Window length">
            <button type="button" role="tab" aria-selected={windowS === "all"} className={windowS === "all" ? "is-active" : ""} onClick={() => setWindowS("all")}>All</button>
            {DURATIONS.map((d) => (
              <button key={d.seconds} type="button" role="tab" aria-selected={windowS === d.seconds} className={windowS === d.seconds ? "is-active" : ""} onClick={() => setWindowS(d.seconds)}>{d.label}</button>
            ))}
          </div>}
        </div>

        {kind === "sports" ? (
          sports === null ? (
            <div className="page-empty">Loading fixtures…</div>
          ) : sports.length === 0 ? (
            <div className="page-empty">No fixtures from the scoreboard right now.</div>
          ) : (
            <div className="board-grid">
              {sports.map((e) => (
                <SportsCard
                  key={e.id}
                  event={e}
                  series={history.get(e.id) ?? []}
                  walletClient={wallet.walletClient}
                  account={wallet.account}
                  onNotice={setNotice}
                />
              ))}
            </div>
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
        {notice && (
          <div className="page-note board-note" role="status">
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}
      </main>
    </div>
  );
}

function MarketCard({ market, series, featured = false }: { market: LiveMarket; series: OddsPoint[]; featured?: boolean }) {
  const strike = Number(market.strike) * 10 ** market.expo;
  const price = market.price === null ? null : Number(market.price) * 10 ** market.expo;
  const above = market.impliedAbove;
  const href = `/trade?feed=${encodeURIComponent(market.symbol)}&window=${market.windowS}`;

  return (
    <article className={`board-card ${featured ? "is-featured" : ""}`}>
      <header className="board-card-head">
        <span className="board-card-icon">
          {ICONS[market.symbol] && <Image src={ICONS[market.symbol]} alt="" width={featured ? 26 : 20} height={featured ? 26 : 20} />}
        </span>
        <span className="board-card-cat">{market.kind === "crypto" ? "Crypto" : "Equity"} · {market.windowLabel} window</span>
        <span className={`board-clock ${market.secondsLeft <= 10 ? "is-urgent" : ""}`}>{clock(market.secondsLeft)}</span>
      </header>

      <h2 className="board-card-title">
        Will {market.symbol} close above ${strike.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?
      </h2>

      <div className="board-card-body">
        <div className="board-outcomes">
          <div className="board-outcome-head"><span>Side</span><span>Pays</span><span>Odds</span></div>
          <Link href={href} className="board-outcome tone-up">
            <span className="board-outcome-name">Above<i style={{ width: `${above}%` }} /></span>
            <span className="board-pays">{payout(market.poolAbove, market.poolBelow).toFixed(2)}x</span>
            <span className="board-odds">{above.toFixed(0)}%</span>
          </Link>
          <Link href={href} className="board-outcome tone-down">
            <span className="board-outcome-name">Below<i style={{ width: `${100 - above}%` }} /></span>
            <span className="board-pays">{payout(market.poolBelow, market.poolAbove).toFixed(2)}x</span>
            <span className="board-odds">{(100 - above).toFixed(0)}%</span>
          </Link>
          <div className="board-card-foot">
            <span>{money(market.volume)} pool</span>
            {price !== null && <span>spot ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
          </div>
        </div>

        <div className="board-chart">
          <div className="board-legend">
            <span className="tone-up"><i />Above {above.toFixed(0)}%</span>
            <span className="tone-down"><i />Below {(100 - above).toFixed(0)}%</span>
          </div>
          <OddsChart series={series} above={above} tall={featured} />
        </div>
      </div>
    </article>
  );
}
