import { NextResponse } from "next/server";
import { TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, toUsd } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";
import { MICRO_WINDOWS, fetchAllFixtures, microCloseFor, microDescriptor, microEventId, sportsMarketId } from "@/lib/sports";
import { scoreAt, scoreTimeline, summaryUrl } from "@/lib/server/scoreTimeline";

/**
 * The short markets running inside matches that are in play.
 *
 * One per live fixture per window length: "who scores next in the next N minutes". Each
 * carries the descriptor it hashes to, so a reader can rebuild the market id and check
 * that the opening scoreline it commits to is the one the scoreboard showed.
 */
export const dynamic = "force-dynamic";

const TTL_MS = 3000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const all = await fetchAllFixtures();
    const live = all.filter((f) => f.state === "in");

    if (live.length === 0) {
      const body = { markets: [], live: 0, at: Math.floor(Date.now() / 1000) };
      cache = { at: Date.now(), body };
      return NextResponse.json(body);
    }

    // The opening scoreline comes from ESPN's play log at the instant the window opened,
    // so every copy of this server computes the same market id and settlement can rebuild
    // it afterwards. A fixture whose log is unreadable gets no in-play markets: offering
    // one that cannot be settled from evidence would be worse than offering none.
    const timelines = new Map(
      await Promise.all(live.map(async (f) => [f.espnId, await scoreTimeline(f.leagueKey, f.espnId)] as const))
    );

    const planned = live.flatMap((f) => {
      const timeline = timelines.get(f.espnId);
      if (!timeline) return [];
      return MICRO_WINDOWS.map((w) => {
        const closesAt = microCloseFor(w.seconds);
        const open = scoreAt(timeline, closesAt - w.seconds);
        const key = { espnId: f.espnId, closesAt, openHome: open.home, openAway: open.away };
        const eventId = microEventId(key);
        return { fixture: f, window: w, key, eventId, id: sportsMarketId(eventId, key.closesAt) };
      });
    });

    if (planned.length === 0) {
      const body = { markets: [], live: 0, at: Math.floor(Date.now() / 1000) };
      cache = { at: Date.now(), body };
      return NextResponse.json(body);
    }

    const pools = (await pub.multicall({
      allowFailure: true,
      contracts: planned.map((m) => ({
        address: CONTRACTS.tickSports,
        abi: TickSportsAbi,
        functionName: "pools" as const,
        args: [m.id] as const,
      })),
    })) as { status: string; result?: readonly [bigint, bigint] }[];

    const now = Math.floor(Date.now() / 1000);
    const markets = planned.map((m, i) => {
      const r = pools[i];
      const [home, away] = r?.status === "success" && r.result ? r.result : [0n, 0n];
      const total = home + away;
      return {
        id: m.id,
        eventId: m.eventId,
        descriptor: microDescriptor(m.key),
        espnId: m.fixture.espnId,
        league: m.fixture.league,
        name: m.fixture.name,
        home: m.fixture.home,
        away: m.fixture.away,
        clock: m.fixture.state,
        windowS: m.window.seconds,
        windowLabel: m.window.label,
        closesAt: m.key.closesAt,
        secondsLeft: m.key.closesAt - now,
        openHome: m.key.openHome,
        openAway: m.key.openAway,
        poolHome: toUsd(home),
        poolAway: toUsd(away),
        volume: toUsd(total),
        impliedHome: total === 0n ? 50 : Number((home * 10_000n) / total) / 100,
        evidence: summaryUrl(m.fixture.leagueKey, m.fixture.espnId),
      };
    });

    const body = { markets, live: live.length, at: now };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[sports/micro] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not load in-play markets." }, { status: 503 });
  }
}
