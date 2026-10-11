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

const TTL_MS = 3000;
let cache: { at: number; body: unknown } | null = null;

/**
 * The score each window OPENED at, fixed for the life of that window.
 *
 * The market id commits to the opening scoreline. Reading the score fresh on every request
 * instead meant that in a basketball game, where the score moves every few seconds, each
 * basket minted a new market mid-window: a stake landed in a pool the page had already
 * stopped showing, and two traders almost never met. The first score seen for a window is
 * kept until that window closes, so everyone staking in it shares one pool.
 */
const opens = new Map<string, { home: number; away: number }>();

/**
 * The score each window CLOSED at, keyed by fixture and close instant.
 *
 * Settling an in-play window compares the score it opened at with the score it closed at.
 * ESPN offers no "score at a past second", so the close has to be caught as it happens:
 * any request in the first 20 seconds after a close records the score then. Settlement
 * reads this; a window whose close nobody observed settles as a refund rather than on a
 * score from some later moment, which would be a different market.
 */
const closes = new Map<string, { home: number; away: number; at: number }>();

export async function GET(request: Request) {
  // Settlement asks for a close snapshot directly.
  const closeOf = new URL(request.url).searchParams.get("close");
  if (closeOf) return NextResponse.json({ close: closes.get(closeOf) ?? null });

  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const all = await fetchAllFixtures();
    const live = all.filter((f) => f.state === "in");

    // Catch every window that has just closed, on fixtures still playing or just finished.
    const nowC = Math.floor(Date.now() / 1000);
    for (const slot of opens.keys()) {
      const [espnId, , closesAtS] = slot.split(":");
      const closesAt = Number(closesAtS);
      const k = `${espnId}:${closesAt}`;
      if (closes.has(k) || nowC < closesAt || nowC > closesAt + 20) continue;
      const f = all.find((x) => x.espnId === espnId);
      if (f && f.home.score !== null && f.away.score !== null) closes.set(k, { home: f.home.score, away: f.away.score, at: nowC });
    }
    for (const [k, v] of closes) if (v.at < nowC - 86_400) closes.delete(k);
    if (live.length === 0) {
      const body = { markets: [], live: 0, at: Math.floor(Date.now() / 1000) };
      cache = { at: Date.now(), body };
      return NextResponse.json(body);
    }

    const nowS = Math.floor(Date.now() / 1000);
    for (const k of opens.keys()) if (Number(k.split(":")[2]) < nowS - 600) opens.delete(k);

    const planned = live.flatMap((f) =>
      MICRO_WINDOWS.map((w) => {
        const closesAt = microCloseFor(w.seconds);
        const slot = `${f.espnId}:${w.seconds}:${closesAt}`;
        let open = opens.get(slot);
        if (!open) {
          open = { home: f.home.score ?? 0, away: f.away.score ?? 0 };
          opens.set(slot, open);
        }
        const key = { espnId: f.espnId, closesAt, openHome: open.home, openAway: open.away };
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
