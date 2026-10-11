"use client";

import { useEffect, useState } from "react";
import type { FeedSpec } from "@/lib/pyth";
import { isFrozen } from "@/lib/marketHours";

/**
 * Pyth's latest published price for the chart and headline, polled from /api/price/live.
 *
 * Reading the chain gives a price only as fresh as the last paid post, so the chart
 * stepped (or cost a wallet to smooth). This reads the same oracle off-chain, which is
 * free and updates several times a second. The cutoff and settlement still use the
 * on-chain price — that is what the contract checks — so this is for display only.
 */
export interface LiveQuote {
  price: number;
  /** Unix seconds Pyth published this price. */
  publishTime: number;
  /** No fresh publish for a while: for an equity, the exchange is shut. Measured at read time. */
  frozen: boolean;
}

export function useLiveQuote(feed: FeedSpec, intervalMs = 500): LiveQuote | null {
  const [state, setState] = useState<({ feedId: string } & LiveQuote) | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function read() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/price/live?feedId=${feed.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { price: string; expo: number; publishTime: number };
        if (!cancelled) setState({ feedId: feed.id, price: Number(body.price) * 10 ** body.expo, publishTime: body.publishTime, frozen: isFrozen(body.publishTime) });
      } catch {
        /* a missed poll just leaves the last reading on screen */
      }
    }
    void read();
    const t = setInterval(read, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [feed.id, intervalMs]);

  // Never show another asset's price while the new feed loads.
  return state && state.feedId === feed.id ? { price: state.price, publishTime: state.publishTime, frozen: state.frozen } : null;
}

export function useLivePrice(feed: FeedSpec, intervalMs = 500): number | null {
  return useLiveQuote(feed, intervalMs)?.price ?? null;
}
