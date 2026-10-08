"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CaretDown, Check, Info, Moon, Sun, X } from "@phosphor-icons/react";
import { Brand } from "@/components/Brand";
import { WalletMenu } from "@/components/WalletMenu";
import { PositionsDock } from "@/components/PositionsDock";
import { useTickWallet } from "@/lib/useTickWallet";
import { useMarket } from "@/lib/useMarket";
import { useStake } from "@/lib/useStake";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useLivePrice } from "@/lib/useLivePrice";
import { usePositions } from "@/lib/usePositions";
import { useTheme } from "@/lib/useTheme";
import { FEEDS, type FeedSpec } from "@/lib/pyth";
import { WINDOW_S, fmtUsd, toUsd } from "@/lib/chain/config";

/** Display metadata only. Every number comes from the chain — see useMarket(). */
const ICONS: Record<string, string> = {
  "BTC/USD": "/asset-icons/bitcoin.svg",
  "ETH/USD": "/asset-icons/ethereum.svg",
  "SOL/USD": "/asset-icons/solana.svg",
  AAPL: "/asset-icons/apple.svg",
  TSLA: "/asset-icons/tesla.svg",
  MSFT: "/asset-icons/microsoft.svg",
};
const AMOUNTS = [5, 10, 25, 50];
/** Seconds left at which the countdown turns red — long enough to still act on. */
const URGENT_AT = 8;
/** Where "now" sits across the 1000-wide chart. The line starts at the left edge. */
const NOW_X = 850;

export function MarketTerminal() {
  const [feed, setFeed] = useState<FeedSpec>(FEEDS[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [amount, setAmount] = useState(25);
  const [side, setSide] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [notice, setNotice] = useState<string | null>(null);
  const wallet = useTickWallet();
  const { status, account, connect, switchChain, walletClient } = wallet;
  const { theme, toggle: toggleTheme } = useTheme();

  const market = useMarket(feed);
  const stake = useStake({ walletClient, account, market, feed });
  // Follows each stake through settlement to a payout. Without it a window closes and
  // says nothing, which is indistinguishable from the money simply being gone.
  const positions = usePositions(account, walletClient);
  // Keeps the on-chain price fresh so the cutoff stays open. Pauses on a hidden tab and
  // can be switched off, because every refresh is a real transaction paid in MON.
  const auto = useAutoRefresh(feed, market.priceAge, market.acceptMargin, market.refetch);
  const { arm } = auto;
  // Picking a side, an amount or a market means a stake is coming: keep the price warm.
  useEffect(() => { if (status === "ready") arm(); }, [side, amount, feed, status, arm]);

  // Observed price history: real readings accumulated since this page loaded, not a
  // generated series. Starts empty by design — the proper fix for a longer window is an
  // indexer over Staked/Settled events rather than anything invented here.
  // Chart and headline read Pyth directly (free, several updates a second); the cutoff
  // and settlement still use the on-chain price, which is what the contract checks.
  const livePrice = useLivePrice(feed);
  const shownPrice = livePrice ?? market.priceNumber;
  const history = usePriceHistory(shownPrice, feed.symbol);

  const impliedAbove = market.impliedAboveBps / 100;
  const strikeNumber = market.terms ? Number(market.terms.strike) * 10 ** feed.expo : null;

  const chart = useMemo(() => chartGeometry(history, shownPrice, strikeNumber), [history, shownPrice, strikeNumber]);

  // Pool-ratio payout if this stake joined now and its side won. Parimutuel, so this
  // moves with every later stake — labelled as an estimate, never a quote.
  const estimatedReturn = useMemo(() => {
    const mine = BigInt(Math.round(amount * 1e6));
    if (mine === 0n) return 0;
    const win = side === "ABOVE" ? market.poolAbove : market.poolBelow;
    const lose = side === "ABOVE" ? market.poolBelow : market.poolAbove;
    if (lose === 0n) return amount; // no counterparty yet: a void refunds the stake
    const profit = (lose * mine) / (win + mine);
    const fee = (profit * 200n) / 10_000n;
    return toUsd(mine + profit - fee);
  }, [amount, side, market.poolAbove, market.poolBelow]);

  async function primaryAction() {
    setNotice(null);
    if (status === "disconnected" || status === "unsupported") { await connect(); return; }
    if (status === "wrong-chain") { await switchChain(); return; }
    const result = await stake.submit(side, amount, async () => {
      // The contract refuses a stake against a price older than the margin. Post a fresh
      // one only when the stored price is actually near that — otherwise a stake costs
      // no oracle post at all.
      // 7s leaves 3s of the 10s margin for signing and inclusion (~1.2s measured).
      if ((market.priceAge ?? 99) >= 7) {
        await auto.refreshNow();
        market.refetch();
      }
    });
    setNotice(result.message);
    // Record the exact terms, not just that something was staked: the chain stores only
    // their hash, so dropping them here would make the position impossible to follow.
    if (result.ok && result.terms && result.id) {
      positions.record(result.terms, side, amount, feed.symbol, result.id, result.hash);
      // The position and the notice appear the moment the transaction is accepted; the
      // receipt follows about a second later and takes the entry back out if it reverted.
      const { id } = result;
      void result.confirm?.then((done) => {
        setNotice(done.message);
        if (!done.ok) positions.forget(id, side);
      });
    }
  }

  const actionLabel =
    status !== "ready"
      ? status === "wrong-chain" ? "Switch to Monad" : "Connect to take a side"
      : stake.busy
        ? stake.step
        : `Stake ${amount} USDC ${side}`;

  const secondsToClose = market.secondsToClose;
  const ageLabel = market.priceAge === null ? "—" : `${market.priceAge}s old`;

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <Link href="/" className="terminal-back" aria-label="Back to landing page"><ArrowLeft /></Link><Brand />
        {/* The countdown is the product. A 30-second window that you have to hunt for in
            a corner is a window you will miss, so it gets the centre of the header and
            turns red once there is barely time left to act. */}
        <div className={`window-clock ${secondsToClose <= URGENT_AT ? "is-urgent" : ""}`} role="timer" aria-live="off">
          <span className="window-clock-label">Window closes in</span>
          <strong className="window-clock-value">{String(secondsToClose).padStart(2, "0")}<small>s</small></strong>
        </div>
        <nav className="terminal-nav" aria-label="Account">
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/fund">Fund</Link>
          <Link href="/settlers">Settlers</Link>
        </nav>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >{theme === "dark" ? <Sun weight="bold" /> : <Moon weight="bold" />}</button>
        <WalletMenu
          wallet={wallet}
          onCopied={(addr) => setNotice(`Wallet address copied: ${addr}. Fund it with MON at faucet.monad.xyz — an embedded wallet starts empty and cannot pay gas.`)}
        />
      </header>
      {/* Draining bar under the header: the same countdown, readable without reading. */}
      <div className={`window-bar ${secondsToClose <= URGENT_AT ? "is-urgent" : ""}`} aria-hidden="true">
        <span style={{ width: `${(secondsToClose / WINDOW_S) * 100}%` }} />
      </div>
      <main className="terminal-main">
        <section className="terminal-chart-panel" aria-label={`${feed.symbol} market chart`}>
          <div className="terminal-toolbar">
            <div className="asset-select-wrap">
              <button className="asset-select" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
                <span className="asset-icon"><Image src={ICONS[feed.symbol]} alt="" width={24} height={24} /></span><span><strong>{feed.symbol}</strong><small>{feed.label}</small></span><CaretDown weight="bold" />
              </button>
              {menuOpen && <div className="asset-menu">{FEEDS.map((item) => <AssetOption key={item.symbol} item={item} active={item.symbol === feed.symbol} pick={() => { setFeed(item); setMenuOpen(false); }} />)}</div>}
            </div>
            <div className="terminal-price"><strong>${shownPrice === null ? "—" : formatPrice(shownPrice)}</strong><span className={history.change >= 0 ? "positive" : "negative"}>{history.change >= 0 ? "+" : ""}{history.change.toFixed(2)}%</span></div>
            {/* One dot instead of a card. The cutoff only matters as open or shut, and
                when it is shut the useful thing is a way to reopen it. */}
            <button
              type="button"
              className={`cutoff-chip ${market.cutoffOpen ? "is-open" : "is-idle"}`}
              disabled={market.cutoffOpen || auto.busy}
              onClick={() => void auto.refreshNow()}
              title={market.cutoffOpen
                ? `The on-chain price is ${ageLabel}, inside the ${market.acceptMargin}s acceptance margin.`
                : `The on-chain price is ${ageLabel}. A fresh one is posted automatically when you stake; click to post one now.`}
            >
              <span className="cutoff-indicator" />
              {market.cutoffOpen ? "Open" : auto.busy ? "Posting…" : "Ready"}
            </button>
          </div>
          <div className="price-chart">
            <div className="chart-future" />
            {chart && strikeNumber !== null && <>
              <div className="chart-zone chart-zone-up" style={{ height: `${chart.strikeY / 520 * 100}%` }} />
              <div className="chart-zone chart-zone-down" style={{ top: `${chart.strikeY / 520 * 100}%`, height: `${100 - chart.strikeY / 520 * 100}%` }} />
            </>}
            <svg viewBox="0 0 1000 520" role="img" aria-label={`${feed.symbol}: observed prices end at the center; the right half is the unknown future`} preserveAspectRatio="none">
              <defs><linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#214f3b" stopOpacity="0.12" /><stop offset="1" stopColor="#214f3b" stopOpacity="0" /></linearGradient></defs>
              {chart && <><path d={`${chart.path} L ${NOW_X} 520 L ${chart.first.x} 520 Z`} fill="url(#chartArea)" /><path d={chart.path} fill="none" stroke="#153f31" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></>}
            </svg>
            {chart && strikeNumber !== null && <div className="strike-line" style={{ top: `${chart.strikeY / 520 * 100}%` }}><span>STRIKE · ${formatPrice(strikeNumber)}</span></div>}
            <div className="now-line"><span>NOW</span></div>
            {chart && <div className="latest-price" style={{ top: `${chart.last.y / 520 * 100}%` }}><i /><strong>${formatPrice(shownPrice!)}</strong></div>}
            {!chart && <div className="chart-empty">Waiting for the first onchain price…</div>}
                      </div>
        </section>
        <aside className="terminal-ticket" aria-label="Market order">
          <div className="ticket-heading"><h1>Will {feed.symbol} close above ${strikeNumber === null ? "—" : formatPrice(strikeNumber)}?</h1></div>
          <div className="pool-split"><div><span>Pool sentiment</span><strong>{impliedAbove.toFixed(0)}% above</strong></div><div className="pool-track"><span style={{ width: `${impliedAbove}%` }} /></div><div className="pool-labels"><span>{fmtUsd(market.poolAbove, 0)} ABOVE</span><span>{fmtUsd(market.poolBelow, 0)} BELOW</span></div></div>
          {!market.twoSided && (market.poolAbove > 0n || market.poolBelow > 0n) && <p className="ticket-disclosure">One side only so far — if nobody takes the other side this market voids and everyone is refunded.</p>}
          <fieldset className="side-picker"><legend>Take a side</legend><button type="button" className={`side-up ${side === "ABOVE" ? "is-active" : ""}`} aria-pressed={side === "ABOVE"} onClick={() => setSide("ABOVE")}><span>Above</span><strong>{impliedAbove.toFixed(0)}%</strong></button><button type="button" className={`side-down ${side === "BELOW" ? "is-active" : ""}`} aria-pressed={side === "BELOW"} onClick={() => setSide("BELOW")}><span>Below</span><strong>{(100 - impliedAbove).toFixed(0)}%</strong></button></fieldset>
          <div className="amount-field"><label htmlFor="stake-amount">Stake</label><div><span>USDC</span><input id="stake-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))} /></div></div>
          <div className="amount-quick">{AMOUNTS.map((value) => <button key={value} type="button" className={amount === value ? "is-active" : ""} onClick={() => setAmount(value)}>{value}</button>)}</div>
          <dl className="ticket-summary"><div><dt>Estimated return</dt><dd>{estimatedReturn.toFixed(2)} USDC</dd></div></dl>
          <button className="ticket-primary" type="button" disabled={stake.busy} onClick={() => void primaryAction()}>{actionLabel}</button><p className="ticket-disclosure">Testnet points, no monetary value.</p>
        </aside>
      </main>
      <footer className="terminal-footer">
        <span><i /> Monad testnet</span>
        <button
          type="button"
          className={`footer-toggle ${auto.enabled ? "is-on" : ""}`}
          onClick={() => auto.setEnabled(!auto.enabled)}
          title={auto.enabled
            ? "Posting a Pyth update every few seconds. Each one is a real transaction paid in MON — click to stop."
            : "A fresh price is posted only when you stake, so nothing is spent while idle. Click to keep it warm instead."}
        >
          <span className="footer-toggle-dot" />
          {auto.enabled ? "Keeping price warm" : "Price posts on stake"}
          {auto.count > 0 && <em>{auto.count} posted</em>}
        </button>
      </footer>
      <PositionsDock
        positions={positions.positions}
        justResolved={positions.justResolved}
        dismiss={positions.dismiss}
        claim={positions.claim}
        claiming={positions.claiming}
      />
      {auto.error && <div className="terminal-notice" role="status"><Info weight="bold" /><p>{auto.error}</p></div>}
      {market.error && <div className="terminal-notice" role="status"><Info weight="bold" /><p>{market.error}</p></div>}
      {notice && <div className="terminal-notice" role="status"><Check weight="bold" /><p>{notice}</p><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X /></button></div>}
    </div>
  );
}

function AssetOption({ item, active, pick }: { item: FeedSpec; active: boolean; pick: () => void }) {
  return <button type="button" className={active ? "is-active" : ""} onClick={pick}><span className="asset-icon"><Image src={ICONS[item.symbol]} alt="" width={20} height={20} /></span><span><strong>{item.symbol}</strong><small>{item.label}</small></span>{active && <Check weight="bold" />}</button>;
}

/**
 * Keeps the prices this page has actually observed. Resets when the feed changes, since
 * mixing two assets' prices into one line would be meaningless.
 */
/**
 * Samples the on-chain price on a fixed cadence rather than only when it changes.
 *
 * Recording only on change meant a frozen oracle — the normal state when no keeper is
 * posting updates — produced a single point and therefore no line at all, which looked
 * like a broken chart. A flat line is the honest picture there: the price really is not
 * moving, because nobody is refreshing it.
 */
function usePriceHistory(price: number | null, symbol: string) {
  const [values, setValues] = useState<number[]>([]);
  const target = useRef<number | null>(price);
  target.current = price;

  // Different asset, different series — mixing two assets into one line is meaningless.
  useEffect(() => {
    setValues([]);
  }, [symbol]);

  /**
   * Plots the on-chain price exactly as read, sampled on a fixed cadence.
   *
   * An earlier version eased the plotted value toward the chain's. On load that eased
   * from whatever was last shown, so opening a token drew a long decay from a stale
   * level down to the real price — a curve that never existed on chain. The line now
   * contains only real readings; a flat stretch means the price really did not move.
   */
  useEffect(() => {
    const t = setInterval(() => {
      const v = target.current;
      if (v === null) return;
      setValues((prev) => [...prev, v].slice(-300));
    }, 250);
    return () => clearInterval(t);
  }, []);

  const change = values.length > 1 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : 0;
  return { values, change };
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value > 1000 ? 0 : 2,
    maximumFractionDigits: value > 1000 ? 0 : 2,
  });
}

function chartGeometry(history: { values: number[] }, current: number | null, strike: number | null) {
  const values = history.values.length > 0 ? history.values : current === null ? [] : [current];
  if (!values.length) return null;
  const domain = strike === null ? values : [...values, strike];
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const range = Math.max(max - min, Math.abs(current ?? min) * 0.0002, 0.01);
  const middle = (min + max) / 2;
  const y = (value: number) => 260 - ((value - middle) / range) * 300;
  const coordinates = values.map((value, index) => ({
    x: values.length === 1 ? NOW_X : (index / (values.length - 1)) * NOW_X,
    y: y(value),
  }));
  return {
    path: linePath(coordinates),
    first: coordinates[0],
    last: coordinates[coordinates.length - 1],
    strikeY: strike === null ? 260 : y(strike),
  };
}

function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}
