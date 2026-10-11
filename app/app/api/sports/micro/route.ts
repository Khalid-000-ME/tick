import { NextResponse } from "next/server";
import { TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, toUsd } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";
import { MICRO_WINDOWS, fetchAllFixtures, microCloseFor, microDescriptor, microEventId, sportsMarketId } from "@/lib/sports";

/**
 * The short markets running inside matches that are in play.
 *
 * One per live fixture per window length: "who scores next in the next N minutes". Each
 * carries the descriptor it hashes to, so a reader can rebuild the market id and check
 * that the opening scoreline it commits to is the one the scoreboard showed.
 */
export const dynamic = "force-dynamic";

const TTL_MS = 5000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const live = (await fetchAllFixtures()).filter((f) => f.state === "in");
    if (live.length === 0) {
      const body = { markets: [], live: 0, at: Math.floor(Date.now() / 1000) };
      cache = { at: Date.now(), body };
      return NextResponse.json(body);
    }

    const planned = live.flatMap((f) =>
      MICRO_WINDOWS.map((w) => {
        const key = {
          espnId: f.espnId,
          closesAt: microCloseFor(w.seconds),
          openHome: f.home.score ?? 0,
          openAway: f.away.score ?? 0,
        };
        const eventId = microEventId(key);
        return { fixture: f, window: w, key, eventId, id: sportsMarketId(eventId, key.closesAt) };
      })
    );

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
