import { NextResponse } from "next/server";
import { FEEDS, HERMES_HOSTS, feedById } from "@/lib/pyth";

/**
 * Recent Pyth prices for one market, to seed the chart before live ticks arrive.
 *
 * Pyth retired its TradingView history endpoint (it now answers 404), but Hermes still
 * serves the signed price for any past second, and one request returns every listed asset
 * at once. A past price never changes, so each second fetched is cached permanently and
 * shared across every visitor and every asset: the first chart opened warms them all.
 *
 * The chart then draws Pyth's own prices, the same numbers the markets settle against,
 * rather than an exchange's.
 */
export const dynamic = "force-dynamic";

const STEP_S = 5;
const SPAN_S = 150;
const MAX_CACHED = 4000;

/** unix second -> feed id -> price as a number */
const seconds = new Map<number, Map<string, number>>();

async function fetchSecond(ts: number): Promise<Map<string, number> | null> {
  const hit = seconds.get(ts);
  if (hit) return hit;
  const key = process.env.PYTH_API_KEY;
  if (!key) return null;
  const ids = FEEDS.map((f) => `ids[]=${f.id}`).join("&");
  for (const host of HERMES_HOSTS) {
    try {
      const res = await fetch(`${host}/v2/updates/price/${ts}?${ids}&parsed=true&encoding=hex`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { parsed?: { id: string; price: { price: string; expo: number } }[] };
      const row = new Map<string, number>();
      for (const p of body.parsed ?? []) {
        row.set(`0x${p.id.replace(/^0x/, "")}`.toLowerCase(), Number(p.price.price) * 10 ** p.price.expo);
      }
      if (seconds.size > MAX_CACHED) seconds.delete(seconds.keys().next().value as number);
      seconds.set(ts, row);
      return row;
    } catch {
      /* next host */
    }
  }
  return null;
}

export async function GET(request: Request) {
  const feed = feedById(new URL(request.url).searchParams.get("feedId") ?? "");
  if (!feed) return NextResponse.json({ error: "Unknown feed." }, { status: 400 });

  // Aligned to the step, and a few seconds back, so every caller asks for the same seconds
  // and only ever for ones Hermes has already published.
  const end = Math.floor((Date.now() / 1000 - 3) / STEP_S) * STEP_S;
  const wanted: number[] = [];
  for (let t = end - SPAN_S; t <= end; t += STEP_S) wanted.push(t);

  const rows: (Map<string, number> | null)[] = [];
  // Six at a time: enough to warm quickly, few enough to stay polite to Hermes.
  for (let i = 0; i < wanted.length; i += 6) {
    rows.push(...(await Promise.all(wanted.slice(i, i + 6).map(fetchSecond))));
  }

  const id = feed.id.toLowerCase();
  const points = wanted
    .map((t, i) => ({ t, p: rows[i]?.get(id) }))
    .filter((x): x is { t: number; p: number } => typeof x.p === "number");
  return NextResponse.json({ points, step: STEP_S });
}
