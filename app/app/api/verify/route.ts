import { NextResponse } from "next/server";
import { SETTLE_TOLERANCE_S, WINDOW_S } from "@/lib/chain/config";
import { feedById, fetchOpenPrice, fetchUpdateForWindow } from "@/lib/pyth";

/**
 * The public facts a market's outcome should follow from: Pyth's price when the window
 * opened (what the strike should equal) and the FIRST price Pyth published at or after
 * the close (the only one the contract accepts). The browser compares these with what the
 * contract stored; this route only fetches public data with the server-only Hermes key.
 *
 * Bounded so it cannot become an open proxy to Hermes history: listed feeds, grid-aligned
 * closes, and only the last week.
 */
export const dynamic = "force-dynamic";

const WEEK = 7 * 24 * 3600;
const cache = new Map<string, unknown>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const feed = feedById(url.searchParams.get("feedId") ?? "");
  const closesAt = Number(url.searchParams.get("closesAt"));
  if (!feed) return NextResponse.json({ error: "Unknown feed." }, { status: 400 });
  if (!Number.isInteger(closesAt) || closesAt % WINDOW_S !== 0) {
    return NextResponse.json({ error: "closesAt is off the window grid." }, { status: 400 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (closesAt > now || closesAt < now - WEEK) {
    return NextResponse.json({ error: "Only markets that closed within the last week can be verified here." }, { status: 400 });
  }

  const key = `${feed.id}:${closesAt}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit);

  try {
    const [open, close] = await Promise.all([
      fetchOpenPrice(feed.id, closesAt - WINDOW_S),
      fetchUpdateForWindow(feed.id, closesAt, SETTLE_TOLERANCE_S),
    ]);
    const body = {
      expo: feed.expo,
      open: { price: open.price.toString(), publishTime: open.publishTime },
      close: { price: close.price.toString(), publishTime: close.publishTime, prevPublishTime: close.prevPublishTime },
    };
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    cache.set(key, body);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split(";")[0] }, { status: 503 });
  }
}
