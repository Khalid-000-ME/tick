"use client";

import { useEffect, useState } from "react";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, OUTCOME, toUsd } from "@/lib/chain/config";
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
    Claim(where: { user: { _eq: $user } }, limit: 1000) { market_id payout }
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
        const json = (await res.json()) as { data?: { Stake: Row[]; Claim: { market_id: string; payout: string }[] }; errors?: unknown };
        if (!json.data) throw new Error("indexer returned no data");
        const claimed = new Map(json.data.Claim.map((c) => [c.market_id, toUsd(BigInt(c.payout))]));

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

        // Payouts for settled markets, in one multicall round trip.
        const settled = [...byKey.values()].filter((p) => p.outcome !== OUTCOME.unresolved);
        const results = await readClient.multicall({
          allowFailure: true,
          contracts: settled.map((p) => ({
            address: CONTRACTS.tick,
            abi: TickAbi,
            functionName: "previewClaim" as const,
            args: [p.id, account!] as const,
          })),
        });
        settled.forEach((p, i) => {
          const r = results[i];
          // previewClaim reads 0 once claimed (the stake slot is cleared), so a claimed
          // market uses the payout the Claimed event recorded instead.
          if (p.claimed) p.payout = claimed.get(p.id) ?? null;
          else if (r.status === "success") p.payout = toUsd(r.result as bigint);
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
