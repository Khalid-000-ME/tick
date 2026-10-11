import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";

/**
 * Fixtures and results from ESPN's public endpoints.
 *
 * These need no key and are the same JSON espn.com itself runs on, but they are
 * undocumented: they can change shape or disappear without notice, so every read here is
 * defensive and a fixture that cannot be parsed is skipped rather than guessed at.
 *
 * This is the weak link in a sports market and worth being plain about. A price market
 * settles on a signature Pyth produced; a scoreboard hands out unsigned JSON, so a key of
 * ours has to vouch for it. See TickSports for exactly what that key can and cannot do.
 */
export const LEAGUES = [
  { key: "eng.1", sport: "soccer", label: "Premier League", short: "EPL" },
  { key: "esp.1", sport: "soccer", label: "La Liga", short: "LaLiga" },
  { key: "nba", sport: "basketball", label: "NBA", short: "NBA" },
  { key: "nfl", sport: "football", label: "NFL", short: "NFL" },
] as const;

export type LeagueKey = (typeof LEAGUES)[number]["key"];

export interface Fixture {
  /** ESPN's own event id, e.g. "401772999". */
  espnId: string;
  /** bytes32 the contract knows the market by. */
  eventId: `0x${string}`;
  league: string;
  leagueKey: string;
  name: string;
  home: { name: string; abbr: string; score: number | null; logo: string | null };
  away: { name: string; abbr: string; score: number | null; logo: string | null };
  /** Kickoff, unix seconds. Staking closes here. */
  kickoff: number;
  state: "pre" | "in" | "post";
  completed: boolean;
  /** 1 home, 2 away, 3 void (draw, cancelled). Null until completed. */
  outcome: number | null;
}

export const HOME = 1;
export const AWAY = 2;
export const VOID = 3;

/** The market key. Must match the Solidity side exactly: keccak256("espn:<id>"). */
export function eventIdFor(espnId: string): `0x${string}` {
  return keccak256(toHex(`espn:${espnId}`));
}

/** keccak256(abi.encode(eventId, closesAt)) — TickSports.marketId, recomputed locally. */
export function sportsMarketId(eventId: `0x${string}`, closesAt: number): `0x${string}` {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint64"), [eventId, BigInt(closesAt)]));
}

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  winner?: boolean;
  team?: { displayName?: string; abbreviation?: string; logo?: string };
}

export async function fetchFixtures(league: (typeof LEAGUES)[number]): Promise<Fixture[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.key}/scoreboard`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { events?: unknown[] };

  const out: Fixture[] = [];
  for (const raw of body.events ?? []) {
    try {
      const e = raw as {
        id: string;
        name?: string;
        date?: string;
        competitions?: {
          competitors?: EspnCompetitor[];
          status?: { type?: { state?: string; completed?: boolean } };
        }[];
      };
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find((c) => c.homeAway === "home");
      const away = comp?.competitors?.find((c) => c.homeAway === "away");
      if (!e.id || !e.date || !home || !away) continue;

      const kickoff = Math.floor(Date.parse(e.date) / 1000);
      if (!Number.isFinite(kickoff)) continue;

      const completed = comp?.status?.type?.completed === true;
      const hs = home.score === undefined ? null : Number(home.score);
      const as = away.score === undefined ? null : Number(away.score);

      let outcome: number | null = null;
      if (completed) {
        // Prefer ESPN's own winner flag; fall back to the scoreline. A draw voids,
        // because this is a two-sided market with no draw to take.
        if (home.winner === true) outcome = HOME;
        else if (away.winner === true) outcome = AWAY;
        else if (hs !== null && as !== null) outcome = hs > as ? HOME : as > hs ? AWAY : VOID;
        else outcome = VOID;
      }

      out.push({
        espnId: e.id,
        eventId: eventIdFor(e.id),
        league: league.label,
        leagueKey: league.key,
        name: e.name ?? `${away.team?.displayName ?? "Away"} at ${home.team?.displayName ?? "Home"}`,
        home: {
          name: home.team?.displayName ?? "Home",
          abbr: home.team?.abbreviation ?? "HOME",
          score: hs,
          logo: home.team?.logo ?? null,
        },
        away: {
          name: away.team?.displayName ?? "Away",
          abbr: away.team?.abbreviation ?? "AWAY",
          score: as,
          logo: away.team?.logo ?? null,
        },
        kickoff,
        state: (comp?.status?.type?.state as Fixture["state"]) ?? "pre",
        completed,
        outcome,
      });
    } catch {
      // An endpoint that changed shape drops the fixture rather than inventing one.
    }
  }
  return out;
}

export async function fetchAllFixtures(): Promise<Fixture[]> {
  const batches = await Promise.all(LEAGUES.map((l) => fetchFixtures(l).catch(() => [])));
  return batches.flat().sort((a, b) => a.kickoff - b.kickoff);
}

export async function findFixture(espnId: string): Promise<Fixture | null> {
  const all = await fetchAllFixtures();
  return all.find((f) => f.espnId === espnId) ?? null;
}
