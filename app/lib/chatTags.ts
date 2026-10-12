import { DURATIONS } from "@/lib/chain/config";
import { FEEDS, type FeedSpec } from "@/lib/pyth";
import type { Post } from "@/lib/useSocial";

/**
 * Messages that mean something more than their words.
 *
 * Both ride on an ordinary chat message on TickSocial, which keeps them on chain with no new
 * contract. What makes them safe is that the chain records who SENT a message, so a tag is only
 * ever believed from someone entitled to use it.
 *
 *   [card] caption          draws the sender's results card (for whoever sent it, never anyone else)
 *   [market] BTC/USD 30     the room owner choosing the room's market: a feed and a window in seconds
 */
export const CARD_TAG = "[card]";
export const MARKET_TAG = "[market]";

export const marketMessage = (symbol: string, windowS: number) => `${MARKET_TAG} ${symbol} ${windowS}`;

export interface RoomMarket {
  feed: FeedSpec;
  windowS: number;
  /** When the owner chose it, which is when the round's scoreboard starts counting. */
  at: number;
}

/** A market tag as written, or null if the text is not one or names something not listed. */
export function parseMarket(text: string): { feed: FeedSpec; windowS: number } | null {
  const m = /^\[market\]\s+(\S+)\s+(\d+)\s*$/.exec(text);
  if (!m) return null;
  const feed = FEEDS.find((f) => f.symbol === m[1]);
  const windowS = Number(m[2]);
  if (!feed || !DURATIONS.some((d) => d.seconds === windowS)) return null;
  return { feed, windowS };
}

/**
 * The room's current market: the owner's latest market message. Anyone else's is ignored, so a
 * member cannot change the room's market by typing the tag.
 */
export function currentMarket(posts: readonly Post[], owner: string): RoomMarket | null {
  for (let i = posts.length - 1; i >= 0; i--) {
    const p = posts[i];
    if (p.from.toLowerCase() !== owner.toLowerCase()) continue;
    const m = parseMarket(p.text);
    if (m) return { ...m, at: p.at };
  }
  return null;
}

/** Is this message a market change by the owner, to be drawn as a notice rather than a bubble? */
export const isMarketNotice = (p: Post, owner?: string) => !!owner && p.from.toLowerCase() === owner.toLowerCase() && parseMarket(p.text) !== null;
