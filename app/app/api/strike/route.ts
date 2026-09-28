import { NextResponse } from "next/server";
import { WINDOW_S } from "@/lib/chain/config";
import { feedById, snapToGrid } from "@/lib/pyth";

/**
 * The strike for a window, as a pure function of public data.
 *
 * WHY THIS EXISTS. A market's id hashes its strike, so two people must compute the SAME
 * strike or they stake into different markets and each sits alone on one side until it
 * voids. Striking from "whatever price this browser last read" gave every client a
 * different answer whenever their reads straddled a grid boundary.
 *
 * The rule: the strike is Pyth's price at the instant the window OPENED
 * (closesAt - WINDOW_S), snapped to the feed's grid. Pyth keeps every published price, so
 * that value is canonical — any client or auditor can recompute it and get the same
 * number. This route does the lookup once, with the server-only API key, and caches it so
 * a window has exactly one strike for everyone.
 *
 * Nothing here is trusted by the contract: stakeOn accepts any on-grid strike. This is
 * convergence by convention, and the convention is verifiable from public data.
 */
export const dynamic = "force-dynamic";

const HOSTS = ["https://hermes.pyth.network", "https://pyth.dourolabs.app/hermes"];
const cache = new Map<string, { strike: string; price: string; publishTime: number }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const feed = feedById(url.searchParams.get("feedId") ?? "");
  const closesAt = Number(url.searchParams.get("closesAt"));
  if (!feed) return NextResponse.json({ error: "Unknown feed." }, { status: 400 });
  if (!Number.isInteger(closesAt) || closesAt % WINDOW_S !== 0) {
    return NextResponse.json({ error: "closesAt is off the window grid." }, { status: 400 });
  }

  const openAt = closesAt - WINDOW_S;
  const now = Math.floor(Date.now() / 1000);
  // Only recent windows: this must not become an open proxy to Hermes history on the
  // server's key.
  if (openAt > now || openAt < now - 3 * WINDOW_S) {
    return NextResponse.json({ error: "Window is not current." }, { status: 400 });
  }

  const key = `${feed.id}:${closesAt}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit);

  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "PYTH_API_KEY is not set on the server." }, { status: 500 });

  for (const host of HOSTS) {
    try {
      const res = await fetch(
        `${host}/v2/updates/price/${openAt}?ids[]=${feed.id}&parsed=true&encoding=hex`,
        { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" }
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        parsed?: { price: { price: string; expo: number; publish_time: number } }[];
      };
      const p = body.parsed?.[0]?.price;
      if (!p || p.expo !== feed.expo) continue;
      const entry = {
        strike: snapToGrid(BigInt(p.price), feed.strikeStep).toString(),
        price: p.price,
        publishTime: p.publish_time,
      };
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
      cache.set(key, entry);
      return NextResponse.json(entry);
    } catch {
      /* try the next host */
    }
  }
  // Not cached, so a transient miss is retried rather than frozen in.
  return NextResponse.json({ error: "Window-open price unavailable." }, { status: 503 });
}
