"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedSpec } from "@/lib/pyth";

export interface AutoRefreshState {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  /** True while a refresh transaction is in flight. */
  busy: boolean;
  /** Last error, or null. A 429 is not an error — it means someone else just refreshed. */
  error: string | null;
  /** Refresh transactions this session, so the gas cost is visible rather than hidden. */
  count: number;
  refreshNow: () => Promise<void>;
}

/**
 * Keeps the on-chain Pyth price fresh enough that the cutoff stays open.
 *
 * WHY THIS IS NEEDED AT ALL. Pyth on Monad is a pull oracle: the stored price only moves
 * when someone pays to post a signed update. Left alone it ages out — measured at hours,
 * then days, old — and every stake is correctly refused. One manual refresh only buys
 * about six usable seconds, because posting consumes two to three of the ten-second
 * margin. So a live market needs a steady refresher, not a button.
 *
 * COST IS REAL AND DELIBERATELY VISIBLE. Every refresh is a transaction paid for by the
 * server's key, so this hook:
 *   - pauses when the tab is hidden, rather than burning gas on a forgotten tab,
 *   - only refreshes when the price is actually getting stale, not on a blind timer,
 *   - can be switched off,
 *   - and counts what it has spent so the number is on screen rather than implied.
 *
 * Concurrent tabs do not multiply the cost: /api/price/refresh throttles server-side and
 * answers 429 to anyone arriving too soon after a successful post, which this treats as
 * success rather than an error.
 */
export function useAutoRefresh(
  feed: FeedSpec,
  priceAge: number | null,
  acceptMargin: number,
  onRefreshed: () => void
): AutoRefreshState {
  // Off by default: every post costs real MON, so the price is refreshed just before a
  // stake (see useStake) rather than on a standing timer. Switch on to keep it warm.
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  // Refs so the interval always sees current values without being torn down and
  // rebuilt every time the price age ticks.
  const inFlight = useRef(false);
  const backoffUntil = useRef(0);
  const ageRef = useRef(priceAge);
  const feedRef = useRef(feed);
  const onRefreshedRef = useRef(onRefreshed);
  ageRef.current = priceAge;
  feedRef.current = feed;
  onRefreshedRef.current = onRefreshed;

  const post = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/price/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the feed being traded: each post costs real MON (~0.018 for one feed,
        // ~0.026 for all four), and the chart no longer depends on these posts.
        body: JSON.stringify({ feedId: feedRef.current.id }),
      });

      // 429 means another client (or tab) refreshed moments ago. The price is fresh,
      // which is the outcome we wanted, so it is not a failure.
      if (res.status === 429) {
        setError(null);
        onRefreshedRef.current();
        return;
      }

      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Price refresh failed.");
        // Back off. Retrying every second against an empty wallet or a rejecting RPC
        // only spams the logs and Hermes.
        backoffUntil.current = Date.now() + 15_000;
        return;
      }

      setError(null);
      setCount((n) => n + 1);
      onRefreshedRef.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Refresh once the price has used half its allowance. Going faster no longer makes
    // the chart smoother (it reads Pyth directly) and costs real MON on every post: a
    // 1-2s cadence emptied the operator wallet and every refresh then failed.
    const threshold = Math.max(3, Math.floor(acceptMargin / 2));

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (Date.now() < backoffUntil.current) return;
      const age = ageRef.current;
      if (age === null || age >= threshold) void post();
    };

    tick();
    const timer = setInterval(tick, 1000);

    // Resume promptly when the tab comes back, rather than waiting out the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, acceptMargin, post]);

  return { enabled, setEnabled, busy, error, count, refreshNow: post };
}
