import { NextResponse } from "next/server";
import { FEEDS, feedById, fetchPriceUpdate } from "@/lib/pyth";

/**
 * Pyth's latest published price, straight from Hermes. Free to read, updates several
 * times a second.
 *
 * WHY THIS IS SEPARATE FROM THE ON-CHAIN PRICE. The chain only holds a price when
 * someone pays to post it (~0.02 MON each), so a chart drawn from chain reads either
 * moves in slow steps or burns a wallet. The chart and headline use this live price;
 * the cutoff and settlement still use the on-chain one, which is what the contract
 * actually checks. Same oracle, same signed data — this just avoids paying to look.
 *
 * Coalesced server-side so many tabs cost one upstream request per interval.
 *
 * One feed with ?feedId=, or several with ?ids=a,b,c (the ticker wants every market in a
 * single request rather than one per symbol).
 */
export const dynamic = "force-dynamic";

const TTL_MS = 350;
const cache = new Map<string, { at: number; body: { price: string; expo: number; publishTime: number } }>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const many = params.get("ids");
  if (many !== null) {
    const feeds = many
      .split(",")
      .map((id) => feedById(id.trim()))
      .filter((f): f is (typeof FEEDS)[number] => Boolean(f));
    if (feeds.length === 0) return NextResponse.json({ error: "No known feeds requested." }, { status: 400 });

    const fresh = feeds.filter((f) => {
      const hit = cache.get(f.id);
      return !hit || Date.now() - hit.at >= TTL_MS;
    });

    if (fresh.length > 0) {
      try {
        const { parsed } = await fetchPriceUpdate(fresh.map((f) => f.id));
        for (const p of parsed) {
          const feed = feedById(p.id);
          if (feed) cache.set(feed.id, { at: Date.now(), body: { price: p.price.toString(), expo: p.expo, publishTime: p.publishTime } });
        }
      } catch (e) {
        // A cached price is better than none; only fail when there is nothing to serve.
        if (!feeds.some((f) => cache.has(f.id))) {
          return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 502 });
        }
      }
    }

    return NextResponse.json({
      prices: feeds
        .map((f) => ({ symbol: f.symbol, ...cache.get(f.id)?.body }))
        .filter((p): p is { symbol: string; price: string; expo: number; publishTime: number } => "price" in p),
    });
  }

  const feed = feedById(params.get("feedId") ?? "");
  if (!feed) return NextResponse.json({ error: "Unknown feed." }, { status: 400 });

  const hit = cache.get(feed.id);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  try {
    const { parsed } = await fetchPriceUpdate([feed.id]);
    const p = parsed[0];
    if (!p) throw new Error("no price returned");
    const body = { price: p.price.toString(), expo: p.expo, publishTime: p.publishTime };
    cache.set(feed.id, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 502 });
  }
}
