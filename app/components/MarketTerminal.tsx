"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Info, Moon, Sun, X } from "@phosphor-icons/react";
import { Brand } from "@/components/Brand";
import { ASSET_ICONS as ICONS } from "@/components/CardBanner";
import { AmountPicker } from "@/components/AmountPicker";
import { useQueryString } from "@/lib/useQueryString";
import { StrikeStepper } from "@/components/StrikeStepper";
import { TVChart } from "@/components/TVChart";
import { StakeSheet } from "@/components/StakeSheet";
import { useSettings } from "@/lib/useSettings";
import { WalletMenu } from "@/components/WalletMenu";
import { ModeSwitch } from "@/components/ModeSwitch";
import { ChainSwitch } from "@/components/ChainSwitch";
import { useChain } from "@/lib/useChain";
import { useSolanaStake, useSolanaWallet } from "@/lib/solana/useSolanaStake";
import { useSolanaPositions } from "@/lib/solana/useSolanaPositions";
import { SOLANA } from "@/lib/solana/program";
import { RailGrip } from "@/components/RailGrip";
import { TickerStrip } from "@/components/TickerStrip";
import { NewsPanel } from "@/components/NewsPanel";
import { PositionsDock } from "@/components/PositionsDock";
import { useTickWallet } from "@/lib/useTickWallet";
import { useMarket } from "@/lib/useMarket";
import { useStake } from "@/lib/useStake";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useLiveQuote } from "@/lib/useLivePrice";
import { nextOpenLabel } from "@/lib/marketHours";
import { usePositions } from "@/lib/usePositions";
import { useTheme } from "@/lib/useTheme";
import { FEEDS } from "@/lib/pyth";
import { DURATIONS, WINDOW_S, fmtUsd, toUsd } from "@/lib/chain/config";

/** Seconds left at which the countdown turns red — long enough to still act on. */
const URGENT_AT = 8;

export function MarketTerminal() {
  const { settings, update: updateSettings } = useSettings();

  // The board links here carrying the market it was showing, so a card and the terminal
  // are the same market rather than two that merely look alike. The query string is read
  // as external state (see useQueryString) instead of being copied into state on mount,
  // which cost every visitor a second render.
  const search = useQueryString();
  const fromUrl = useMemo(() => {
    const q = new URLSearchParams(search);
    const w = Number(q.get("window"));
    const k = q.get("strike");
    return {
      feed: FEEDS.find((f) => f.symbol === q.get("feed")) ?? null,
      windowS: DURATIONS.some((d) => d.seconds === w) ? w : null,
      strike: k && /^\d+$/.test(k) ? BigInt(k) : null,
    };
  }, [search]);

  // Each of these is "what the trader picked here", which falls back to the link, which
  // falls back to the default. Picking on this page therefore always wins, and nothing
  // has to be copied anywhere when the link changes.
  const [windowPick, setWindowPick] = useState<number | null>(null);
  const [strikePick, setStrikePick] = useState<bigint | null>(null);
  const [strikeCleared, setStrikeCleared] = useState(false);

  const feed = fromUrl.feed ?? FEEDS[0];
  const windowS =
    windowPick ??
    fromUrl.windowS ??
    (DURATIONS.some((d) => d.seconds === settings.defaultWindow) ? settings.defaultWindow : WINDOW_S);
  // A price the trader picked instead of the window's opening one, in feed units.
  const strikeOverride = strikePick ?? (strikeCleared ? null : fromUrl.strike);

  const setWindowS = useCallback((next: number) => setWindowPick(next), []);
  const setStrikeOverride = useCallback((next: bigint | null) => {
    setStrikePick(next);
    if (next === null) setStrikeCleared(true);
  }, []);
  const [amount, setAmount] = useState(1);
  // No selected side any more: a side IS the action. `pending` holds the side awaiting
  // confirmation; whether there is one at all is a setting (one tap, confirm or slide).
  const [pending, setPending] = useState<"ABOVE" | "BELOW" | null>(null);
  const { chain, isSolana } = useChain();
  const solana = useSolanaStake();
  const solanaWallet = useSolanaWallet();
  const solanaPositions = useSolanaPositions(solanaWallet.address);
  // The amount default still copies into state, because the field is edited in place.
  const amountTouched = useRef(false);
  useEffect(() => {
    if (!amountTouched.current) setAmount(settings.defaultAmount);
  }, [settings.defaultAmount]);
  const [notice, setNotice] = useState<string | null>(null);
  const wallet = useTickWallet();
  const { status, account, connect, switchChain, walletClient } = wallet;
  const { theme, toggle: toggleTheme } = useTheme();

  const market = useMarket(feed, windowS, strikeOverride);
  const stake = useStake({ walletClient, account, market, feed });
  // Follows each stake through settlement to a payout. Without it a window closes and
  // says nothing, which is indistinguishable from the money simply being gone.
  const positions = usePositions(account, walletClient);
  // Keeps the on-chain price fresh so the cutoff stays open. Pauses on a hidden tab and
  // can be switched off, because every refresh is a real transaction paid in MON.
  const auto = useAutoRefresh(feed, market.priceAge, market.acceptMargin, market.refetch);
  const { arm } = auto;
  // Picking a side, an amount or a market means a stake is coming: keep the price warm.
  useEffect(() => { if (status === "ready") arm(); }, [amount, feed, windowS, status, arm]);

  // Observed price history: real readings accumulated since this page loaded, not a
  // generated series. Starts empty by design — the proper fix for a longer window is an
  // indexer over Staked/Settled events rather than anything invented here.
  // Chart and headline read Pyth directly (free, several updates a second); the cutoff
  // and settlement still use the on-chain price, which is what the contract checks.
  const quote = useLiveQuote(feed);
  const livePrice = quote?.price ?? null;
  // An equity whose price has stopped publishing is a closed exchange: every stake would be
  // refused by the freshness cutoff, so the ticket says so instead of inviting one.
  const closed = feed.kind === "equity" && quote?.frozen === true;
  const shownPrice = livePrice ?? market.priceNumber;
  const history = usePriceHistory(shownPrice, feed.symbol);

  const impliedAbove = market.impliedAboveBps / 100;
  const strikeNumber = market.terms ? Number(market.terms.strike) * 10 ** feed.expo : null;


  // Pool-ratio payout if this stake joined now and its side won. Parimutuel, so this
  // moves with every later stake — labelled as an estimate, never a quote.
  // What each side pays, so both buttons can carry their own number. Without a selected
  // side there is nothing to tie a single figure to.
  const returnFor = useCallback(
    (which: "ABOVE" | "BELOW") => {
      const mine = BigInt(Math.round(amount * 1e6));
      if (mine === 0n) return 0;
      const win = which === "ABOVE" ? market.poolAbove : market.poolBelow;
      const lose = which === "ABOVE" ? market.poolBelow : market.poolAbove;
      if (lose === 0n) return amount; // no counterparty yet: a void refunds the stake
      const profit = (lose * mine) / (win + mine);
      const fee = (profit * 200n) / 10_000n;
      return toUsd(mine + profit - fee);
    },
    [amount, market.poolAbove, market.poolBelow]
  );

  /** A click on a side is the order. The modal, when shown, only confirms it. */
  function requestStake(which: "ABOVE" | "BELOW") {
    setNotice(null);
    if (status === "disconnected" || status === "unsupported") { void connect(); return; }
    if (status === "wrong-chain") { void switchChain(); return; }
    if (closed) { setNotice(`${feed.symbol} trades on US market hours. It reopens ${nextOpenLabel()}.`); return; }
    if (amount <= 0) { setNotice("Enter an amount above zero first."); return; }
    if (settings.stakeMode === "tap") { void placeStake(which); return; }
    setPending(which);
  }

  async function placeStake(which: "ABOVE" | "BELOW") {
    setPending(null);
    setNotice(null);

    // Solana runs the same window through the Anchor program instead of the Monad contract. The
    // terms are identical, so the strike and the close second come from the same place; only the
    // signing and the settlement venue differ.
    if (isSolana) {
      if (!solanaWallet.address) {
        setNotice("Setting up your Solana wallet. Try again in a moment; if it keeps saying this, Solana wallets are switched off for this app.");
        void solanaWallet.create().catch(() => {});
        return;
      }
      if (!market.terms) { setNotice("No open window right now."); return; }
      const terms = {
        feedId: Uint8Array.from(Buffer.from(feed.id.replace(/^0x/, ""), "hex")),
        // The same strike the Monad side would use, so a window is the same market on either chain.
        strike: strikeOverride ?? market.terms.strike,
        expo: feed.expo,
        closesAt: market.terms.closesAt,
      };
      const units = BigInt(Math.round(amount * 1e6));
      const r = await solana.submit(terms, which === "ABOVE", units);
      if (!r.ok) { setNotice(r.message); return; }

      // The terms are kept the moment the stake lands: the program stores a market under their
      // hash, so losing them here would make the position impossible to follow afterwards.
      solanaPositions.record(terms, which, amount, feed.symbol, r.signature);
      setNotice(`Staked ${amount} USDC ${which} on Solana. Settles when the window closes.`);

      // Nudge the fallback settler once the window has closed. It stands down for the grace period
      // so an outside bot can take the bounty first; this only covers the windows nobody takes.
      const closesIn = Number(terms.closesAt) * 1000 - Date.now();
      window.setTimeout(() => {
        void fetch("/api/solana/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            feedId: Buffer.from(terms.feedId).toString("hex"),
            strike: terms.strike.toString(),
            expo: terms.expo,
            closesAt: Number(terms.closesAt),
          }),
        }).then(() => solanaPositions.refresh()).catch(() => {});
      }, Math.max(0, closesIn) + 12_000);
      return;
    }

    const result = await stake.submit(which, amount, async () => {
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
      positions.record(result.terms, which, amount, feed.symbol, result.id, result.hash);
      // The position and the notice appear the moment the transaction is accepted; the
      // receipt follows about a second later and takes the entry back out if it reverted.
      const { id } = result;
      void result.confirm?.then((done) => {
        setNotice(done.message);
        if (!done.ok) positions.forget(id, which);
      });
    }
  }



  const secondsToClose = market.secondsToClose;
  const ageLabel = market.priceAge === null ? "-" : `${market.priceAge}s old`;

  return (
    <div className="terminal-shell is-flat">
      <TickerStrip />
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
          <Link href="/feed">Feed</Link>
          <Link href="/markets">Markets</Link>
          <Link href="/groups">Groups</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/fund">Fund</Link>
        </nav>
        <ChainSwitch />
        <ModeSwitch />
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >{theme === "dark" ? <Sun weight="bold" /> : <Moon weight="bold" />}</button>
        <WalletMenu
          wallet={wallet}
          onCopied={(addr) => setNotice(`Wallet address copied: ${addr}. Send USDC to it, then tap Fill gas on the Fund page.`)}
        />
      </header>
      {/* Draining bar under the header: the same countdown, readable without reading. */}
      <div className={`window-bar ${secondsToClose <= URGENT_AT ? "is-urgent" : ""}`} aria-hidden="true">
        <span style={{ width: `${(secondsToClose / windowS) * 100}%` }} />
      </div>
      <main className="terminal-main">
        <section className="terminal-chart-panel" aria-label={`${feed.symbol} market chart`}>
          <div className="terminal-toolbar">
            {/* The market is chosen on the board, so this names it instead of offering a menu. */}
            <div className="asset-select is-static">
              <span className="asset-icon"><Image src={ICONS[feed.symbol]} alt="" width={24} height={24} /></span><span><strong>{feed.symbol}</strong><small>{feed.label}</small></span>
            </div>
            <div className="term-durations" role="tablist" aria-label="Window length">
              {DURATIONS.map((d) => (
                <button key={d.seconds} type="button" role="tab" aria-selected={windowS === d.seconds} className={windowS === d.seconds ? "is-active" : ""} onClick={() => setWindowS(d.seconds)}>{d.label}</button>
              ))}
            </div>
            <div className="terminal-price"><strong>${shownPrice === null ? "-" : formatPrice(shownPrice)}</strong><span className={history.change >= 0 ? "positive" : "negative"}>{history.change >= 0 ? "+" : ""}{history.change.toFixed(2)}%</span></div>
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
          <div className="price-chart tv-host">
            <TVChart feed={feed} livePrice={livePrice} strike={strikeNumber} theme={theme} />
          </div>
        </section>
        <div className="terminal-rail">
        <RailGrip />
        <NewsPanel title={`What's moving ${feed.symbol}`} symbol={feed.symbol} foldKey="tick.terminal.news" />
        <aside className="terminal-ticket" aria-label="Market order">
          <div className="ticket-heading"><h1>Will {feed.symbol} close above</h1></div>
          <StrikeStepper open={market.openStrike} value={strikeOverride} expo={feed.expo} onChange={setStrikeOverride} />
          <div className="pool-split"><div><span>Pool sentiment</span><strong>{impliedAbove.toFixed(0)}% above</strong></div><div className="pool-track"><span style={{ width: `${impliedAbove}%` }} /></div><div className="pool-labels"><span>${fmtUsd(market.poolAbove)} ABOVE</span><span>${fmtUsd(market.poolBelow)} BELOW</span></div></div>
          {!market.twoSided && (market.poolAbove > 0n || market.poolBelow > 0n) && <p className="ticket-disclosure">One side only so far. If nobody takes the other side this market voids and everyone is refunded.</p>}
          <fieldset className="side-picker is-order"><legend>{closed ? `Market closed · reopens ${nextOpenLabel()}` : status !== "ready" ? "Log in to take a side" : stake.busy ? stake.step || "Staking…" : `Tap a side to stake ${amount} USDC`}</legend>
            <button type="button" className="side-up" disabled={stake.busy || closed} onClick={() => requestStake("ABOVE")}>
              <span>Above</span><strong>{impliedAbove.toFixed(0)}%</strong><small>pays {returnFor("ABOVE").toFixed(2)}</small>
            </button>
            <button type="button" className="side-down" disabled={stake.busy || closed} onClick={() => requestStake("BELOW")}>
              <span>Below</span><strong>{(100 - impliedAbove).toFixed(0)}%</strong><small>pays {returnFor("BELOW").toFixed(2)}</small>
            </button>
          </fieldset>
          <AmountPicker value={amount} onChange={(n) => { amountTouched.current = true; setAmount(n); }} />
          {status !== "ready" && (
            <button className="ticket-primary" type="button" onClick={() => void (status === "wrong-chain" ? switchChain() : connect())}>
              {status === "wrong-chain" ? "Switch to Monad" : "Log in to take a side"}
            </button>
          )}
          <p className="ticket-disclosure">Testnet USDC, no monetary value.</p>
        </aside>
        </div>
      </main>
      <footer className="terminal-footer">
        <span><i /> Monad testnet</span>
        <button
          type="button"
          className={`footer-toggle ${auto.enabled ? "is-on" : ""}`}
          onClick={() => auto.setEnabled(!auto.enabled)}
          title={auto.enabled
            ? "Posting a Pyth update every few seconds. Each one is a real transaction and uses gas. Click to stop."
            : "A fresh price is posted only when you stake, so nothing is spent while idle. Click to keep it warm instead."}
        >
          <span className="footer-toggle-dot" />
          {auto.enabled ? "Keeping price warm" : "Price posts on stake"}
          {auto.count > 0 && <em>{auto.count} posted</em>}
        </button>
      </footer>
      <PositionsDock
        positions={positions.positions}
        account={account}
        justResolved={positions.justResolved}
        dismiss={positions.dismiss}
        claim={positions.claim}
        claiming={positions.claiming}
      />
      {pending && settings.stakeMode !== "tap" && (
        <StakeSheet
          mode={settings.stakeMode}
          tone={pending === "ABOVE" ? "up" : "down"}
          eyebrow={`${feed.symbol} · closes in ${secondsToClose}s`}
          title={<>{amount} USDC <em>{pending}</em> {strikeNumber === null ? "" : `$${formatPrice(strikeNumber)}`}</>}
          detail={payoutLine(returnFor(pending), amount)}
          confirmLabel={`Stake ${pending}`}
          onCancel={() => setPending(null)}
          onConfirm={() => void placeStake(pending)}
          onAlwaysTap={() => { updateSettings({ stakeMode: "tap" }); void placeStake(pending); }}
        />
      )}
      {auto.error && <div className="terminal-notice" role="status"><Info weight="bold" /><p>{auto.error}</p></div>}
      {market.error && <div className="terminal-notice" role="status"><Info weight="bold" /><p>{market.error}</p></div>}
      {notice && <div className="terminal-notice" role="status"><Check weight="bold" /><p>{notice}</p><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X /></button></div>}
    </div>
  );
}

/**
 * What the confirm sheet says a stake returns. The total includes the stake, so it is also
 * broken into "your stake back plus the profit": the profit is the other side's money less
 * the 2% fee, which is the figure that matches what the portfolio later shows. With nobody
 * on the other side yet there is no profit to promise, and the market refunds instead.
 */
function payoutLine(total: number, stake: number): string {
  const profit = total - stake;
  if (profit <= 0.005) return "Nobody is on the other side yet. If it stays that way, you are refunded in full.";
  return `Pays about ${total.toFixed(2)} USDC if it lands: your ${stake} back plus ${profit.toFixed(2)} profit after the 2% fee. Nothing if it does not.`;
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
  useEffect(() => {
    target.current = price;
  });

  // Different asset, different series — mixing two assets into one line is meaningless.
  const [plotted, setPlotted] = useState(symbol);
  if (plotted !== symbol) {
    setPlotted(symbol);
    setValues([]);
  }

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


