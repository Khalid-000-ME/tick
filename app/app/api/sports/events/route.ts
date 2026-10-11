import { NextResponse } from "next/server";
import { TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, toUsd } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";
import { fetchAllFixtures, sportsMarketId } from "@/lib/sports";

/**
 * Fixtures with their market state: pools, and whether the result is in.
 *
 * Only fixtures that have not kicked off can be staked, but settled and in-play ones stay
 * listed so a card can show how it ended.
 */
export const dynamic = "force-dynamic";

const TTL_MS = 4000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const fixtures = (await fetchAllFixtures()).slice(0, 40);
    if (fixtures.length === 0) {
      return NextResponse.json({ error: "No fixtures available from the scoreboard." }, { status: 503 });
    }

    const ids = fixtures.map((f) => sportsMarketId(f.eventId, f.kickoff));
    const [pools, settled] = await Promise.all([
      pub.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "pools" as const, args: [id] as const })),
      }),
      pub.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "settlements" as const, args: [id] as const })),
      }),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const events = fixtures.map((f, i) => {
      const pr = pools[i];
      const [home, away] = pr?.status === "success" && pr.result ? (pr.result as readonly [bigint, bigint]) : [0n, 0n];
      const sr = settled[i];
      const onChain = sr?.status === "success" && sr.result ? (sr.result as readonly [number, bigint, number, bigint, bigint]) : null;
      const total = home + away;
      return {
        ...f,
        id: ids[i],
        poolHome: toUsd(home),
        poolAway: toUsd(away),
        volume: toUsd(total),
        impliedHome: total === 0n ? 50 : Number((home * 10_000n) / total) / 100,
        settledOutcome: onChain ? onChain[0] : 0,
        open: now < f.kickoff,
        secondsToKickoff: f.kickoff - now,
      };
    });

    const body = { events, at: now };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[sports/events] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not load fixtures." }, { status: 503 });
  }
}
