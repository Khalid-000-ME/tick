"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, OUTCOME, toUsd, monadTestnet } from "@/lib/chain/config";
import type { Terms } from "@/lib/chain/market";

const pub = createPublicClient({ chain: monadTestnet, transport: http() });

/**
 * Every stake this wallet has taken, followed from "live" through to money in hand.
 *
 * WHY THIS EXISTS. A 30-second market that closes and then says nothing is
 * indistinguishable from one that took the money. Three things have to happen after the
 * window shuts, and none of them happened on their own before:
 *
 *   1. SOMEONE MUST SETTLE. settle() is permissionless but pays the caller nothing, so
 *      nobody has a reason to call it. /api/settle does it on the operator's gas. That
 *      changes nothing about who decides the outcome — the contract recomputes it from
 *      Pyth either way — it only means the market actually resolves.
 *   2. THE OUTCOME MUST BE READ BACK, from settlements(), not assumed from the last price
 *      seen in the browser. The settlement price is a specific published price from just
 *      after the close, which is frequently not the one on screen.
 *   3. THE WINNER MUST CLAIM. Payouts credit the internal balance rather than transfer,
 *      so claiming is cheap and the proceeds are immediately stakeable.
 *
 * Positions persist in localStorage because the market id is derived from terms the chain
 * never stores. Losing the terms means losing the ability to even ask what happened. This
 * is a convenience cache, not a source of truth: every outcome and payout below is read
 * from the contract, never computed here.
 */

export type PositionStatus = "live" | "awaiting" | "won" | "lost" | "refunded" | "claimed";

export interface Position {
  id: `0x${string}`;
  feedId: `0x${string}`;
  symbol: string;
  /** Strike in feed units, as a string so it survives JSON. */
  strike: string;
  expo: number;
  closesAt: number;
  strikeNumber: number;
  side: "ABOVE" | "BELOW";
  /** Staked amount in tUSD. */
  amount: number;
  stakedAt: number;
  stakeHash?: string;
  /** 0 unresolved, 1 above, 2 below, 3 void. Read from settlements(). */
  outcome: number;
  /** previewClaim(), in tUSD. Null until settled. */
  payout: number | null;
  settlePrice: number | null;
  claimed: boolean;
  claimHash?: string;
}

// v2: the contract was redeployed (settler bounty), so ids from v1 no longer exist.
const KEY = "tick.positions.v2";
/** Keeps the log useful without letting localStorage grow without bound. */
const MAX_KEPT = 60;

function load(account: string | null): Position[] {
  if (!account || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${KEY}.${account.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as Position[]) : [];
  } catch {
    return [];
  }
}

function save(account: string | null, positions: Position[]) {
  if (!account || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${KEY}.${account.toLowerCase()}`,
      JSON.stringify(positions.slice(0, MAX_KEPT))
    );
  } catch {
    /* a full or blocked store costs the history, not the session */
  }
}

export function statusOf(p: Position): PositionStatus {
  if (p.outcome === OUTCOME.unresolved) {
    return Math.floor(Date.now() / 1000) < p.closesAt ? "live" : "awaiting";
  }
  if (p.claimed) return "claimed";
  if (p.outcome === OUTCOME.void) return "refunded";
  const won = (p.outcome === OUTCOME.above) === (p.side === "ABOVE");
  return won ? "won" : "lost";
}

export function usePositions(account: `0x${string}` | null, walletClient: WalletClient | null) {
  const [positions, setPositions] = useState<Position[]>([]);
  /** The most recent position to have just resolved, for the result card. */
  const [justResolved, setJustResolved] = useState<Position | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const accountRef = useRef(account);
  accountRef.current = account;
  const settleTried = useRef<Set<string>>(new Set());

  useEffect(() => {
    setPositions(load(account));
    settleTried.current.clear();
  }, [account]);

  const update = useCallback((next: Position[] | ((prev: Position[]) => Position[])) => {
    setPositions((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      save(accountRef.current, value);
      return value;
    });
  }, []);

  const record = useCallback(
    (terms: Terms, side: "ABOVE" | "BELOW", amount: number, symbol: string, id: `0x${string}`, hash?: string) => {
      update((prev) => {
        // Staking the same side of the same market twice is one position, not two: the
        // contract pools them and pays out once.
        const existing = prev.find((p) => p.id === id && p.side === side);
        if (existing) {
          return prev.map((p) => (p === existing ? { ...p, amount: p.amount + amount, stakeHash: hash } : p));
        }
        const entry: Position = {
          id,
          feedId: terms.feedId,
          symbol,
          strike: terms.strike.toString(),
          expo: terms.expo,
          closesAt: Number(terms.closesAt),
          strikeNumber: Number(terms.strike) * 10 ** terms.expo,
          side,
          amount,
          stakedAt: Math.floor(Date.now() / 1000),
          stakeHash: hash,
          outcome: OUTCOME.unresolved,
          payout: null,
          settlePrice: null,
          claimed: false,
        };
        return [entry, ...prev];
      });
    },
    [update]
  );

  // Resolution loop: settle what has closed, then read back what the contract decided.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;

    async function pass() {
      const open = positions.filter((p) => p.outcome === OUTCOME.unresolved);
      if (open.length === 0) return;
      const now = Math.floor(Date.now() / 1000);

      for (const p of open) {
        // Two seconds of grace: the settlement price must have been published AFTER the
        // close, so there is nothing to settle against the instant the window shuts.
        if (now < p.closesAt + 2) continue;
        if (settleTried.current.has(p.id)) continue;

        const settled = (await pub
          .readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settlements", args: [p.id] })
          .catch(() => null)) as readonly [number, bigint, bigint, number, bigint, bigint] | null;

        if (!settled) continue;

        if (settled[0] === OUTCOME.unresolved) {
          // Nobody has settled it. Ask the server to, and let the next pass read the
          // result — a 409 means no qualifying price landed yet, which is routine.
          try {
            const res = await fetch("/api/settle", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ feedId: p.feedId, strike: p.strike, expo: p.expo, closesAt: p.closesAt }),
            });
            if (!res.ok && res.status !== 409) settleTried.current.add(p.id);
          } catch {
            /* transient: the next pass tries again */
          }
          continue;
        }

        const payout = (await pub
          .readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "previewClaim", args: [p.id, account!] })
          .catch(() => 0n)) as bigint;

        if (cancelled) return;
        const resolved: Position = {
          ...p,
          outcome: settled[0],
          payout: toUsd(payout),
          settlePrice: Number(settled[2]) * 10 ** p.expo,
        };
        update((prev) => prev.map((x) => (x.id === resolved.id && x.side === resolved.side ? resolved : x)));
        setJustResolved(resolved);
      }
    }

    void pass();
    const t = setInterval(() => void pass(), 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [account, positions, update]);

  /**
   * Claims a settled position. Credits the internal balance rather than transferring, so
   * the proceeds can go straight into the next window.
   */
  const claim = useCallback(
    async (id: `0x${string}`): Promise<{ ok: boolean; message: string }> => {
      if (!walletClient || !account) return { ok: false, message: "Connect a wallet first." };
      setClaiming(id);
      try {
        await pub.simulateContract({
          address: CONTRACTS.tick,
          abi: TickAbi,
          functionName: "claim",
          args: [id],
          account,
        });
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tick,
          abi: TickAbi,
          functionName: "claim",
          args: [id],
          account,
          chain: monadTestnet,
        });
        const rc = await pub.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") return { ok: false, message: "The claim reverted." };
        update((prev) => prev.map((p) => (p.id === id ? { ...p, claimed: true, claimHash: hash } : p)));
        setJustResolved((prev) => (prev && prev.id === id ? { ...prev, claimed: true, claimHash: hash } : prev));
        return { ok: true, message: "Claimed into your Tick balance — ready for the next window." };
      } catch (e) {
        const data = (e as { cause?: { data?: { errorName?: string } } }).cause?.data;
        if (data?.errorName === "NothingStaked") {
          update((prev) => prev.map((p) => (p.id === id ? { ...p, claimed: true } : p)));
          return { ok: false, message: "Already claimed." };
        }
        const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
        return { ok: false, message: msg.split("\n")[0] };
      } finally {
        setClaiming(null);
      }
    },
    [walletClient, account, update]
  );

  const dismiss = useCallback(() => setJustResolved(null), []);

  const clear = useCallback(() => update([]), [update]);

  return { positions, record, claim, claiming, justResolved, dismiss, clear };
}
