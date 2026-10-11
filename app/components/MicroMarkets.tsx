"use client";

import { AmountPicker } from "@/components/AmountPicker";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Lightning } from "@phosphor-icons/react";
import { useSportsStake } from "@/lib/useSportsStake";
import { StakeSheet } from "@/components/StakeSheet";
import { useSettings } from "@/lib/useSettings";
import { payout } from "@/components/SportsCard";
import type { WalletClient } from "viem";

/**
 * In-play windows: which side outscores the other over the next N minutes. In football
 * that is usually "who scores next"; in basketball, where both sides score every minute,
 * it is who wins that stretch. A tied window refunds, which is the contract's VOID.
 *
 * On the board these are doors to the match page. On the match page (`espnId` given) they
 * are the order entry itself. "Nobody scores" refunds, which is the contract's VOID, so it
 * needed no settlement logic of its own.
 */
export interface MicroMarket {
  id: `0x${string}`;
  eventId: `0x${string}`;
  descriptor: string;
  espnId: string;
  league: string;
  name: string;
  home: { name: string; short: string; abbr: string; score: number | null };
  away: { name: string; short: string; abbr: string; score: number | null };
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


function useMicro(espnId?: string) {
  const [markets, setMarkets] = useState<MicroMarket[] | null>(null);
  useEffect(() => {
    let off = false;
    async function load() {
      try {
        const res = await fetch("/api/sports/micro");
        const body = (await res.json()) as { markets?: MicroMarket[] };
        const all = body.markets ?? [];
        if (!off) setMarkets(espnId ? all.filter((m) => m.espnId === espnId) : all);
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
  }, [espnId]);
  return markets;
}

/** Board: one compact door per live match and window. Renders nothing when no match is live. */
export function MicroBoard() {
  const markets = useMicro();
  if (!markets || markets.length === 0) return null;
  return (
    <section className="micro-section">
      <h2 className="section-title micro-title"><Lightning weight="fill" /> In play</h2>
      <div className="micro-strip">
        {markets.map((m) => (
          <Link key={m.id} href={`/sports/${m.espnId}?window=${m.windowS}`} className="micro-tile">
            <span className="micro-tile-top">
              <b>{m.away.abbr} {m.openAway}:{m.openHome} {m.home.abbr}</b>
              <em className={m.secondsLeft <= 15 ? "is-urgent" : ""}>{Math.max(0, m.secondsLeft)}s</em>
            </span>
            <span className="micro-tile-q">Wins the next {m.windowLabel}</span>
            <span className="micro-tile-odds">
              <i className="tone-down">{m.away.abbr} {(100 - m.impliedHome).toFixed(0)}%</i>
              <i className="tone-up">{m.home.abbr} {m.impliedHome.toFixed(0)}%</i>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Match page: the windows for one fixture, stakeable. */
export function MicroOrders({
  espnId,
  initialWindow,
  walletClient,
  account,
  onNotice,
  onStaked,
}: {
  espnId: string;
  initialWindow?: number;
  walletClient: WalletClient | null;
  account: `0x${string}` | null;
  onNotice: (message: string) => void;
  /** Gets the window's terms, including its opening score, which settling it needs later. */
  onStaked?: (m: MicroMarket, home: boolean, amount: number) => void;
}) {
  const markets = useMicro(espnId);
  const [windowS, setWindowS] = useState(initialWindow ?? 120);
  const { settings, update: updateSettings } = useSettings();
  const [amount, setAmount] = useState(1);
  const amountTouched = useRef(false);
  useEffect(() => {
    if (!amountTouched.current) setAmount(settings.defaultAmount);
  }, [settings.defaultAmount]);
  const [pending, setPending] = useState<boolean | null>(null);
  const stake = useSportsStake(walletClient, account);

  if (!markets || markets.length === 0) return null;
  const m = markets.find((x) => x.windowS === windowS) ?? markets[0];

  async function place(home: boolean) {
    setPending(null);
    const res = await stake.submit(
      { eventId: m.eventId, closesAt: BigInt(m.closesAt) },
      home,
      amount,
      `${home ? m.home.short : m.away.short} to win the next ${m.windowLabel}`
    );
    onNotice(res.message);
    if (res.ok) onStaked?.(m, home, amount);
    void res.confirm?.then((d) => onNotice(d.message));
  }

  return (
    <section className="match-panel">
      <header className="match-panel-head">
        <h2><Lightning weight="fill" /> Wins the next {m.windowLabel}</h2>
        <span className={`card-chip is-dark ${m.secondsLeft <= 15 ? "is-urgent" : ""}`}>{Math.max(0, m.secondsLeft)}s</span>
      </header>
      <div className="board-durations">
        {markets.map((x) => (
          <button key={x.windowS} type="button" className={x.windowS === m.windowS ? "is-active" : ""} onClick={() => setWindowS(x.windowS)}>
            {x.windowLabel}
          </button>
        ))}
      </div>
      <div className="match-sides">
        {([[true, m.home, m.impliedHome, m.poolHome, m.poolAway, "up"], [false, m.away, 100 - m.impliedHome, m.poolAway, m.poolHome, "down"]] as const).map(
          ([home, team, odds, mine, theirs, tone]) => (
            <button key={team.abbr} type="button" className={`match-side tone-${tone}`} disabled={stake.busy || m.secondsLeft <= 2} onClick={() => (settings.stakeMode === "tap" ? void place(home) : setPending(home))}>
              <span>{team.short}</span>
              <strong>{odds.toFixed(0)}%</strong>
              <small>pays {payout(mine, theirs).toFixed(2)}x</small>
            </button>
          )
        )}
      </div>
      <AmountPicker value={amount} compact onChange={(n) => { amountTouched.current = true; setAmount(n); }} />
      <p className="match-note">Most points in the window wins. A tie refunds both sides. Opened at {m.openAway}:{m.openHome}.</p>
      {stake.busy && <p className="match-note">{stake.step || "Working..."}</p>}
      {pending !== null && settings.stakeMode !== "tap" && (
        <StakeSheet
          mode={settings.stakeMode}
          tone={pending ? "up" : "down"}
          eyebrow={`${m.league} · ${Math.max(0, m.secondsLeft)}s left`}
          title={<>{amount} USDC on <em>{pending ? m.home.short : m.away.short}</em></>}
          detail={`Wins if they outscore the other side over the next ${m.windowLabel}. A tie refunds.`}
          confirmLabel="Stake"
          onCancel={() => setPending(null)}
          onConfirm={() => void place(pending)}
          onAlwaysTap={() => { updateSettings({ stakeMode: "tap" }); void place(pending); }}
        />
      )}
    </section>
  );
}
