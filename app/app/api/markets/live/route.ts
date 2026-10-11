import { NextResponse } from "next/server";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, DURATIONS, closeFor, toUsd } from "@/lib/chain/config";
import { marketId } from "@/lib/chain/market";
import { FEEDS, fetchOpenPrice, fetchPriceUpdate, snapToGrid, type FeedSpec } from "@/lib/pyth";
import { pub } from "@/lib/server/oracle";

/**
 * Every market currently on offer: each listed asset across each window length.
 *
 * A longer window is not a different product — the contract only requires a close on its
 * 30-second grid, so a three-minute market is a close three minutes out with its strike
 * struck three minutes back. This route works out each one's terms, reads its pools in a
 * single multicall, and returns what the cards need.
 *
 * Strikes are cached by (feed, close, window) because a struck window never changes its
 * strike; only the pools move. That keeps a page of 32 cards to one Hermes burst per
 * window rather than one per poll.
 */
export const dynamic = "force-dynamic";

const TTL_MS = 2500;
const strikes = new Map<string, bigint>();
let cache: { at: number; body: unknown } | null = null;

async function strikeFor(feed: FeedSpec, closesAt: number, windowS: number): Promise<bigint | null> {
  const key = `${feed.id}:${closesAt}:${windowS}`;
  const hit = strikes.get(key);
  if (hit !== undefined) return hit;
  try {
    const open = await fetchOpenPrice(feed.id, closesAt - windowS);
    if (open.expo !== feed.expo) return null;
    const value = snapToGrid(open.price, feed.strikeStep);
    if (strikes.size > 600) strikes.delete(strikes.keys().next().value as string);
    strikes.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const live = await fetchPriceUpdate(FEEDS.map((f) => f.id));

    const planned = FEEDS.flatMap((feed) =>
      DURATIONS.map((d) => ({ feed, windowS: d.seconds, label: d.label, closesAt: closeFor(d.seconds) }))
    );
    const struck = await Promise.all(planned.map((m) => strikeFor(m.feed, m.closesAt, m.windowS)));

    const usable = planned
      .map((m, i) => ({ ...m, strike: struck[i] }))
      .filter((m): m is typeof m & { strike: bigint } => m.strike !== null)
      .map((m) => ({
        ...m,
        id: marketId({ feedId: m.feed.id, strike: m.strike, expo: m.feed.expo, closesAt: BigInt(m.closesAt) }),
      }));

    // One round trip for every pool on the page.
    const pools = (await pub.multicall({
      allowFailure: true,
      contracts: usable.map((m) => ({
        address: CONTRACTS.tick,
        abi: TickAbi,
        functionName: "pools" as const,
        args: [m.id] as const,
      })),
    })) as { status: string; result?: readonly [bigint, bigint] }[];

    const now = Math.floor(Date.now() / 1000);
    const all = usable.map((m, i) => {
      const r = pools[i];
      const [above, below] = r?.status === "success" && r.result ? r.result : [0n, 0n];
      const total = above + below;
      const p = live.parsed.find((x) => x.id.toLowerCase() === m.feed.id.toLowerCase());
      return {
        id: m.id,
        symbol: m.feed.symbol,
        label: m.feed.label,
        kind: m.feed.kind,
        feedId: m.feed.id,
        expo: m.feed.expo,
        windowS: m.windowS,
        windowLabel: m.label,
        closesAt: m.closesAt,
        secondsLeft: m.closesAt - now,
        strike: m.strike.toString(),
        price: p ? p.price.toString() : null,
        poolAbove: toUsd(above),
        poolBelow: toUsd(below),
        volume: toUsd(total),
        // With nothing staked the two sides are genuinely unknown, so the cards show an
        // even split rather than implying a crowd that is not there.
        impliedAbove: total === 0n ? 50 : Number((above * 10_000n) / total) / 100,
        // Equities only publish while their exchange is open. A price that has not moved
        // in minutes cannot pass the contract's freshness cutoff, so the card must not
        // invite a stake that will be refused.
        closed: p ? now - p.publishTime > 120 : true,
      };
    });

    // Two windows that close at the same instant with the same strike are the SAME market
    // on chain — the id is the hash of its terms. That happens whenever a price is frozen
    // (an equity outside trading hours), and listing it twice gave two cards one React
    // key, which leaked stale cards and broke the filters. Merge them, keeping every
    // window label so filtering by either still finds it.
    const byId = new Map<string, (typeof all)[number] & { windows: number[]; windowLabels: string[] }>();
    for (const m of all) {
      const hit = byId.get(m.id);
      if (hit) {
        hit.windows.push(m.windowS);
        hit.windowLabels.push(m.windowLabel);
      } else {
        byId.set(m.id, { ...m, windows: [m.windowS], windowLabels: [m.windowLabel] });
      }
    }
    const markets = [...byId.values()];

    const body = { markets, at: now };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[markets/live] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not load markets right now." }, { status: 503 });
  }
}
