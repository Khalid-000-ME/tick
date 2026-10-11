"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import { TickAbi } from "@/lib/chain/abi";
import { PythAbi } from "@/lib/chain/pythAbi";
import {
  ACCEPT_MARGIN_S,
  CONTRACTS,
  WINDOW_S,
  monadTestnet,
} from "@/lib/chain/config";
import { marketId, priceToNumber, type Terms } from "@/lib/chain/market";
import type { FeedSpec } from "@/lib/pyth";

const pub = createPublicClient({ chain: monadTestnet, transport: http() });

/**
 * Everything the trading UI needs, read from the chain. No fabricated values.
 *
 * WHY THE PRICE CAN LOOK STALE: Pyth on Monad is a pull oracle — the stored price only
 * moves when someone pays to post a signed update. With no keeper running, the stored
 * price was measured at ~7 hours old. So a stale reading here is the honest state of the
 * chain, not a bug in this hook, and the cutoff being shut is the mechanism working.
 * Run `npx tsx scripts/keeper.ts` to open it.
 */
export interface MarketView {
  /** Live on-chain Pyth price, in feed units, and as a number. */
  price: bigint | null;
  priceNumber: number | null;
  /** Seconds since the on-chain price was published, per the latest block. */
  priceAge: number | null;
  /** The contract's own answer to "would a stake be accepted right now". */
  cutoffOpen: boolean;
  acceptMargin: number;
  /** The market currently open for staking on this feed. */
  terms: Terms | null;
  /** The window's opening strike, before any override: where the strike ladder centres. */
  openStrike: bigint | null;
  id: `0x${string}` | null;
  /** Seconds until this window closes. */
  secondsToClose: number;
  /** Real pool totals, in token base units (6 decimals). */
  poolAbove: bigint;
  poolBelow: bigint;
  /** Pool-implied probability of ABOVE, in basis points. 5000 when the pool is empty. */
  impliedAboveBps: number;
  /** True once both sides have money — below this a market VOIDS and refunds. */
  twoSided: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * @param windowS Window length in seconds. Every listed duration is a multiple of the
 *   contract's 30s grid, so a longer market is only a further-out close — the chain needs
 *   no change, just a strike struck at the matching opening instant.
 */
export function useMarket(
  feed: FeedSpec,
  windowS: number = WINDOW_S,
  /** A price the trader chose instead of the opening one. Any strike is valid on chain. */
  strikeOverride: bigint | null = null,
  pollMs = 2500
): MarketView {
  const [price, setPrice] = useState<bigint | null>(null);
  const [publishTime, setPublishTime] = useState<number | null>(null);
  const [blockTime, setBlockTime] = useState<number | null>(null);
  const [cutoff, setCutoff] = useState<{ ok: boolean; age: number } | null>(null);
  const [pools, setPools] = useState<{ above: bigint; below: bigint }>({ above: 0n, below: 0n });
  const [impliedBps, setImpliedBps] = useState(5000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Local clock, so the countdown is smooth between polls rather than jumping.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // The strike is Pyth's price at the instant this window OPENED, snapped to the grid,
  // looked up by /api/strike. Every client gets the same number, so everyone stakes into
  // the same market. It cannot come from this browser's own price reads: those differ
  // by a poll or two between clients, which split pools at grid boundaries.
  const windowClose = Math.floor(now / windowS) * windowS + windowS;
  const [strikeFor, setStrikeFor] = useState<{ key: string; strike: bigint } | null>(null);
  const strikeKey = `${feed.id}:${windowClose}:${windowS}`;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const res = await fetch(`/api/strike?feedId=${feed.id}&closesAt=${windowClose}&window=${windowS}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { strike: string };
        if (!cancelled) setStrikeFor({ key: strikeKey, strike: BigInt(body.strike) });
      } catch {
        // Window just opened and Hermes may not have the instant yet; retry shortly.
        if (!cancelled) timer = setTimeout(load, 700);
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [feed.id, windowClose, windowS, strikeKey]);

  // Never show a strike belonging to another window or feed: no terms until it matches.
  const openStrike = strikeFor && strikeFor.key === strikeKey ? strikeFor.strike : null;
  const terms = useMemo<Terms | null>(() => {
    const strike = strikeOverride ?? openStrike;
    return strike === null ? null : { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(windowClose) };
  }, [strikeOverride, openStrike, feed, windowClose]);
  const id = useMemo(() => (terms ? marketId(terms) : null), [terms]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  // A different feed must not inherit the previous feed's price, or the new market is
  // struck from the wrong asset for a moment.
  useEffect(() => {
    setPrice(null);
    setPublishTime(null);
    setCutoff(null);
  }, [feed]);
  // Chain reads: price + the contract's own cutoff verdict.
  useEffect(() => {
    let cancelled = false;

    async function read() {
      try {
        const [p, status, block] = await Promise.all([
          pub.readContract({
            address: CONTRACTS.pyth,
            abi: PythAbi,
            functionName: "getPriceUnsafe",
            args: [feed.id],
          }) as Promise<{ price: bigint; conf: bigint; expo: number; publishTime: bigint }>,
          pub.readContract({
            address: CONTRACTS.tick,
            abi: TickAbi,
            functionName: "cutoffStatus",
            args: [feed.id],
          }) as Promise<readonly [boolean, bigint, bigint, bigint]>,
          pub.getBlock(),
        ]);
        if (cancelled) return;

        // A changed exponent would silently redenominate the strike; surface it rather
        // than quietly pricing the market wrong.
        if (p.expo !== feed.expo) {
          setError(`${feed.symbol}: feed exponent is ${p.expo}, expected ${feed.expo}`);
        } else {
          setError(null);
        }

        setPrice(p.price);
        setPublishTime(Number(p.publishTime));
        setBlockTime(Number(block.timestamp));
        setCutoff({ ok: status[0], age: Number(status[1]) });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
        setLoading(false);
      }
    }

    void read();
    const t = setInterval(read, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [feed, pollMs, tick]);

  // Pool reads, keyed to the current market.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function readPools() {
      try {
        const [p, implied] = await Promise.all([
          pub.readContract({
            address: CONTRACTS.tick,
            abi: TickAbi,
            functionName: "pools",
            args: [id!],
          }) as Promise<readonly [bigint, bigint]>,
          pub.readContract({
            address: CONTRACTS.tick,
            abi: TickAbi,
            functionName: "impliedAboveBps",
            args: [id!],
          }) as Promise<bigint>,
        ]);
        if (cancelled) return;
        setPools({ above: p[0], below: p[1] });
        setImpliedBps(Number(implied));
      } catch {
        /* a market with no stakes yet reads as zero; not worth surfacing */
      }
    }

    void readPools();
    const t = setInterval(readPools, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, pollMs]);

  const secondsToClose = terms ? Math.max(0, Number(terms.closesAt) - now) : 0;

  // Roll to the next window as soon as this one closes, so the UI never offers a stake
  // the contract would reject with NotOpen.
  useEffect(() => {
    if (terms && secondsToClose === 0) refetch();
  }, [terms, secondsToClose, refetch]);

  // Prefer the contract's own verdict. Fall back to local arithmetic only before the
  // first successful read, so the UI never claims "open" without having asked.
  const derivedAge =
    publishTime !== null && blockTime !== null ? Math.max(0, blockTime - publishTime) : null;

  return {
    price,
    priceNumber: price === null ? null : priceToNumber(price, feed.expo),
    priceAge: cutoff?.age ?? derivedAge,
    cutoffOpen: cutoff?.ok ?? false,
    acceptMargin: ACCEPT_MARGIN_S,
    terms,
    openStrike,
    id,
    secondsToClose,
    poolAbove: pools.above,
    poolBelow: pools.below,
    impliedAboveBps: impliedBps,
    twoSided: pools.above > 0n && pools.below > 0n,
    loading,
    error,
    refetch,
  };
}
