import { NextResponse } from "next/server";
import { feedById, fetchPriceUpdate } from "@/lib/pyth";

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
 */
export const dynamic = "force-dynamic";

const TTL_MS = 350;
const cache = new Map<string, { at: number; body: { price: string; expo: number; publishTime: number } }>();

export async function GET(request: Request) {
  const feed = feedById(new URL(request.url).searchParams.get("feedId") ?? "");
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
