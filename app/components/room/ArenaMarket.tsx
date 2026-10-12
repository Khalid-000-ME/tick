"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp, Check, Info, X } from "@phosphor-icons/react";
import { AmountPicker } from "@/components/AmountPicker";
import { ASSET_ICONS } from "@/components/CardBanner";
import { PositionsDock } from "@/components/PositionsDock";
import { StakeSheet } from "@/components/StakeSheet";
import { TVChart } from "@/components/TVChart";
import { CountdownRing } from "@/components/room/CountdownRing";
import { fmtUsd, toUsd } from "@/lib/chain/config";
import { nextOpenLabel } from "@/lib/marketHours";
import type { FeedSpec } from "@/lib/pyth";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { useLiveQuote } from "@/lib/useLivePrice";
import { useMarket } from "@/lib/useMarket";
import { usePositions } from "@/lib/usePositions";
import { useSettings } from "@/lib/useSettings";
import { useStake } from "@/lib/useStake";
import { useTheme } from "@/lib/useTheme";
import type { useTickWallet } from "@/lib/useTickWallet";

/**
 * The room's market, played the way the main terminal plays it: the live chart with the strike drawn
 * on it, the pool split, an Above and a Below, and the same staking, settling and claiming underneath.
 * It is the same Tick contract, so a stake made here is a real stake that counts in the portfolio and
 * on the main leaderboard too; the room only watches the members who made them.
 */
const URGENT_AT = 8;
type Wallet = ReturnType<typeof useTickWallet>;

const priceText = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: v > 1000 ? 0 : 2, maximumFractionDigits: v > 1000 ? 0 : 2 });

/** What the confirm sheet says a stake returns, in the same words the terminal uses. */
function payoutLine(total: number, stake: number): string {
  const profit = total - stake;
  if (profit <= 0.005) return "Nobody is on the other side yet. If it stays that way, you are refunded in full.";
  return `Pays about ${total.toFixed(2)} USDC if it lands: your ${stake} back plus ${profit.toFixed(2)} profit after the 2% fee. Nothing if it does not.`;
}

export function ArenaMarket({ feed, windowS, wallet }: { feed: FeedSpec; windowS: number; wallet: Wallet }) {
  const { settings, update: updateSettings } = useSettings();
  const { theme } = useTheme();
  const { status, account, connect, switchChain, walletClient } = wallet;

  const market = useMarket(feed, windowS, null);
  const stake = useStake({ walletClient, account, market, feed });
  const positions = usePositions(account, walletClient);
  const auto = useAutoRefresh(feed, market.priceAge, market.acceptMargin, market.refetch);
  const { arm } = auto;
  const quote = useLiveQuote(feed);
  const livePrice = quote?.price ?? null;
  const shown = livePrice ?? market.priceNumber;
  const closed = feed.kind === "equity" && quote?.frozen === true;

  const [amount, setAmount] = useState(1);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setAmount(settings.defaultAmount);
  }, [settings.defaultAmount]);
  const [pending, setPending] = useState<"ABOVE" | "BELOW" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Keep the on-chain price warm once someone is about to stake, as the terminal does.
  useEffect(() => {
    if (status === "ready") arm();
  }, [amount, feed, windowS, status, arm]);

  const impliedAbove = market.impliedAboveBps / 100;
  const strike = market.terms ? Number(market.terms.strike) * 10 ** feed.expo : null;
  const urgent = market.secondsToClose <= URGENT_AT;

  const returnFor = useCallback(
    (which: "ABOVE" | "BELOW") => {
      const mine = BigInt(Math.round(amount * 1e6));
      if (mine === 0n) return 0;
      const win = which === "ABOVE" ? market.poolAbove : market.poolBelow;
      const lose = which === "ABOVE" ? market.poolBelow : market.poolAbove;
      if (lose === 0n) return amount;
      const profit = (lose * mine) / (win + mine);
      return toUsd(mine + profit - (profit * 200n) / 10_000n);
    },
    [amount, market.poolAbove, market.poolBelow]
  );

  function request(which: "ABOVE" | "BELOW") {
    setNotice(null);
    if (status === "disconnected" || status === "unsupported") return void connect();
    if (status === "wrong-chain") return void switchChain();
    if (closed) return setNotice(`${feed.symbol} trades on US market hours. It reopens ${nextOpenLabel()}.`);
    if (amount <= 0) return setNotice("Enter an amount above zero first.");
    if (settings.stakeMode === "tap") return void place(which);
    setPending(which);
  }

  async function place(which: "ABOVE" | "BELOW") {
    setPending(null);
    setNotice(null);
    const result = await stake.submit(which, amount, async () => {
      // A fresh on-chain price only when the stored one is near the freshness margin.
      if ((market.priceAge ?? 99) >= 7) {
        await auto.refreshNow();
        market.refetch();
      }
    });
    setNotice(result.message);
    if (result.ok && result.terms && result.id) {
      positions.record(result.terms, which, amount, feed.symbol, result.id, result.hash);
      const { id } = result;
      void result.confirm?.then((done) => {
        setNotice(done.message);
        if (!done.ok) positions.forget(id, which);
      });
    }
  }

  const label = closed
    ? `Closed · reopens ${nextOpenLabel()}`
    : status !== "ready"
      ? "Log in to take a side"
      : stake.busy
        ? stake.step || "Staking…"
        : `Tap a side to stake ${amount} USDC`;

  return (
    <section className="am" aria-label={`${feed.symbol} market`}>
      <header className="am-head">
        <div className="am-id">
          {ASSET_ICONS[feed.symbol] && <Image src={ASSET_ICONS[feed.symbol]} alt="" width={44} height={44} />}
          <div>
            <h2>{feed.symbol}<small>{windowS < 60 ? `${windowS}s` : `${windowS / 60}m`} window</small></h2>
            <p className="am-price">${shown === null ? "-" : priceText(shown)}{strike !== null && <span>strike ${priceText(strike)}</span>}</p>
          </div>
        </div>
        <CountdownRing seconds={market.secondsToClose} of={windowS} urgent={urgent} />
      </header>

      <div className="am-chart price-chart tv-host">
        <TVChart feed={feed} livePrice={livePrice} strike={strike} theme={theme} />
      </div>

      <div className="am-dock">
        <div className="am-crowd">
          <div className="am-crowd-top"><span>Crowd</span><strong>{impliedAbove.toFixed(0)}% above</strong></div>
          <div className="am-track"><span style={{ width: `${impliedAbove}%` }} /></div>
          <div className="am-crowd-bottom"><span>${fmtUsd(market.poolAbove)} above</span><span>${fmtUsd(market.poolBelow)} below</span></div>
        </div>

        <p className="am-prompt">{label}</p>
        <div className="am-sides">
          <button type="button" className="am-side is-up" disabled={stake.busy || closed} onClick={() => request("ABOVE")}>
            <ArrowUp weight="bold" />
            <span>Above</span>
            <small>pays {returnFor("ABOVE").toFixed(2)}</small>
          </button>
          <button type="button" className="am-side is-down" disabled={stake.busy || closed} onClick={() => request("BELOW")}>
            <ArrowDown weight="bold" />
            <span>Below</span>
            <small>pays {returnFor("BELOW").toFixed(2)}</small>
          </button>
        </div>
        <AmountPicker value={amount} onChange={(n) => { touched.current = true; setAmount(n); }} />
        {!market.twoSided && (market.poolAbove > 0n || market.poolBelow > 0n) && (
          <p className="am-fine">One side only so far. If nobody takes the other side this window voids and everyone is refunded.</p>
        )}
        <p className="am-fine">Real stakes on the same market as the main terminal. Testnet USDC, no monetary value.</p>
      </div>

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
          eyebrow={`${feed.symbol} · closes in ${market.secondsToClose}s`}
          title={<>{amount} USDC <em>{pending}</em> {strike === null ? "" : `$${priceText(strike)}`}</>}
          detail={payoutLine(returnFor(pending), amount)}
          confirmLabel={`Stake ${pending}`}
          onCancel={() => setPending(null)}
          onConfirm={() => void place(pending)}
          onAlwaysTap={() => { updateSettings({ stakeMode: "tap" }); void place(pending); }}
        />
      )}
      {auto.error && <div className="terminal-notice" role="status"><Info weight="bold" /><p>{auto.error}</p></div>}
      {market.error && <div className="terminal-notice" role="status"><Info weight="bold" /><p>{market.error}</p></div>}
      {notice && <div className="terminal-notice" role="status"><Check weight="bold" /><p>{notice}</p><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X /></button></div>}
    </section>
  );
}
