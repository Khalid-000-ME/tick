"use client";

import { useEffect, useState } from "react";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, OUTCOME, toUsd } from "@/lib/chain/config";
import { payoutForSide, toUnits } from "@/lib/chain/payout";
import { feedById } from "@/lib/pyth";
import { readClient } from "@/lib/useWallet";
import type { Position } from "@/lib/usePositions";

/**
 * A wallet's full stake history from the Envio indexer, so it follows the wallet to any
 * browser instead of living in one browser's localStorage.
 *
 * The indexer only supplies WHAT happened (stakes, markets, claims). Payouts are still
 * read from previewClaim() on chain, never recomputed here, so the numbers match what
 * claim() will actually credit.
 *
 * NEXT_PUBLIC_INDEXER_URL is a public GraphQL endpoint, not a secret. Unset, or if the
 * indexer is down, this returns nothing and the page falls back to local history.
 */
const URL_ = process.env.NEXT_PUBLIC_INDEXER_URL;

const QUERY = /* GraphQL */ `
  query Stakes($user: String!) {
    Stake(where: { user: { _eq: $user } }, order_by: { stakedAt: desc }, limit: 1000) {
      id
      above
      amount
      stakedAt
      txHash
      market { id feedId strike closesAt outcome settlePrice }
    }
    Claim(where: { user: { _eq: $user } }, limit: 1000) { market_id }
  }
`;

interface Row {
  id: string;
  above: boolean;
  amount: string;
  stakedAt: number;
  txHash: string;
  market: { id: string; feedId: string; strike: string; closesAt: number; outcome: number; settlePrice: string | null };
}

export function useIndexedPositions(account: `0x${string}` | null) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [state, setState] = useState<"off" | "loading" | "ready" | "error">(URL_ ? "loading" : "off");

  useEffect(() => {
    if (!URL_ || !account) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(URL_!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: QUERY, variables: { user: account!.toLowerCase() } }),
        });
        const json = (await res.json()) as { data?: { Stake: Row[]; Claim: { market_id: string }[] }; errors?: unknown };
        if (!json.data) throw new Error("indexer returned no data");
        const claimed = new Set(json.data.Claim.map((c) => c.market_id));

        // One position per market and side, as usePositions keeps them.
        const byKey = new Map<string, Position>();
        for (const r of json.data.Stake) {
          const feed = feedById(r.market.feedId);
          if (!feed) continue;
          const side = r.above ? "ABOVE" : "BELOW";
          const key = `${r.market.id}-${side}`;
          const amount = toUsd(BigInt(r.amount));
          const existing = byKey.get(key);
          if (existing) {
            existing.amount += amount;
            continue;
          }
          byKey.set(key, {
            id: r.market.id as `0x${string}`,
            feedId: r.market.feedId as `0x${string}`,
            symbol: feed.symbol,
            strike: r.market.strike,
            expo: feed.expo,
            closesAt: r.market.closesAt,
            strikeNumber: Number(r.market.strike) * 10 ** feed.expo,
            side,
            amount,
            stakedAt: r.stakedAt,
            stakeHash: r.txHash,
            outcome: r.market.outcome,
            payout: null,
            settlePrice: r.market.settlePrice === null ? null : Number(r.market.settlePrice) * 10 ** feed.expo,
            claimed: claimed.has(r.market.id),
          });
        }

        // Settlements for everything resolved, in one multicall round trip. Payout is
        // then computed per side: previewClaim totals both sides of a market, which
        // credits a losing side with the winning side's money.
        const settled = [...byKey.values()].filter((p) => p.outcome !== OUTCOME.unresolved);
        const results = await readClient.multicall({
          allowFailure: true,
          contracts: settled.map((p) => ({
            address: CONTRACTS.tick,
            abi: TickAbi,
            functionName: "settlements" as const,
            args: [p.id] as const,
          })),
        });
        settled.forEach((p, i) => {
          const r = results[i];
          if (r.status !== "success") return;
          const [, , , feeBps, totalAbove, totalBelow] = r.result as readonly [number, bigint, bigint, number, bigint, bigint];
          p.payout = toUsd(payoutForSide(p.outcome, feeBps, totalAbove, totalBelow, p.side, toUnits(p.amount)));
        });

        if (!cancelled) {
          setPositions([...byKey.values()]);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }

    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [account]);

  return { positions, state };
}
