import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import type { FeedSpec } from "@/lib/pyth";

/**
 * A market, in full. Never stored on chain — the id IS the hash of these fields, so
 * presenting them and recomputing the id proves which market is meant.
 */
export interface Terms {
  feedId: `0x${string}`;
  strike: bigint;
  expo: number;
  closesAt: bigint;
}

/**
 * Must match Tick.marketId exactly:
 *   keccak256(abi.encode(feedId, strike, expo, closesAt))
 *
 * Recomputed client-side rather than read from the contract so a mismatch surfaces as
 * a failed stake rather than a silently wrong market.
 */
export function marketId(t: Terms): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, int64, int32, uint64"), [
      t.feedId,
      t.strike,
      t.expo,
      t.closesAt,
    ])
  );
}

/**
 * The window grid. Markets exist only on these boundaries — that is what makes
 * independent stakers land in the SAME pool instead of each inventing a market and
 * sitting alone on one side until it voids.
 */
export function windowCloseAfter(nowSeconds: number, windowSeconds: number): bigint {
  return BigInt((Math.floor(nowSeconds / windowSeconds) + 1) * windowSeconds);
}

/** Rounds a price to the feed's strike grid. Off-grid strikes revert on chain. */
export function snapStrike(priceInFeedUnits: bigint, step: bigint): bigint {
  const half = step / 2n;
  return ((priceInFeedUnits + half) / step) * step;
}

/**
 * Builds the current market for a feed: the next window boundary, with the strike
 * snapped to the grid nearest the live price.
 */
export function currentTerms(
  feed: FeedSpec,
  livePrice: bigint,
  nowSeconds: number,
  windowSeconds: number
): Terms {
  return {
    feedId: feed.id,
    strike: snapStrike(livePrice, feed.strikeStep),
    expo: feed.expo,
    closesAt: windowCloseAfter(nowSeconds, windowSeconds),
  };
}

/** Human price from feed units (expo is negative, e.g. -8). */
export function priceToNumber(price: bigint, expo: number): number {
  return Number(price) * 10 ** expo;
}

export const OUTCOME_NAMES = ["UNRESOLVED", "ABOVE", "BELOW", "VOID"] as const;
