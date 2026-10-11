import { LEAGUES } from "@/lib/sports";

/**
 * What the score was at any instant of a match, rebuilt from ESPN's own play log.
 *
 * WHY THIS EXISTS. An in-play market is "who scores more between T0 and T1", so settling
 * it needs the score at two past instants. The scoreboard only ever reports the score
 * NOW, so the server used to remember both: it froze a window's opening score the first
 * time it saw that window, and it snapshotted the closing score only if some request
 * happened to arrive within twenty seconds of the close. Two consequences, both bad. A
 * close nobody observed in that twenty seconds settled as a refund even though the match
 * plainly had a result. And on serverless hosting, where requests land on whichever copy
 * of the server is warm, two copies could freeze different opening scores for the same
 * window, mint two different market ids from them, and split the traders between pools
 * that never meet.
 *
 * Every ESPN play carries a UTC `wallclock`, so the score at an instant is simply the
 * score after the last play before it. Nothing has to be remembered, every copy of the
 * server computes the same answer, settlement works however late it runs, and anyone can
 * recompute it from the public summary feed. The timeline IS the evidence.
 *
 * Each sport logs scores differently: basketball and football carry a running score on
 * every play, while soccer's key events name the scoring team without a score, so goals
 * are counted as they land.
 */
export interface Checkpoint {
  /** Unix seconds at which the score became this. */
  at: number;
  home: number;
  away: number;
}

interface Summary {
  plays?: Play[];
  keyEvents?: KeyEvent[];
  drives?: { previous?: { plays?: Play[] }[]; current?: { plays?: Play[] } };
  header?: { competitions?: { competitors?: { homeAway?: string; team?: { id?: string } }[] }[] };
}
interface Play {
  wallclock?: string;
  homeScore?: number;
  awayScore?: number;
}
interface KeyEvent {
  wallclock?: string;
  scoringPlay?: boolean;
  team?: { id?: string };
}

const TTL_MS = 12_000;
const cache = new Map<string, { at: number; timeline: Checkpoint[] | null }>();

const sportOf = (leagueKey: string) => LEAGUES.find((l) => l.key === leagueKey)?.sport ?? "soccer";

/** The public page a reader can check any of this against. */
export function summaryUrl(leagueKey: string, espnId: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${sportOf(leagueKey)}/${leagueKey}/summary?event=${espnId}`;
}

const seconds = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) : NaN);

/**
 * Every moment the score changed, in order. Null when ESPN has no usable play log for
 * this fixture, which is a reason to offer no in-play market rather than to guess.
 */
export async function scoreTimeline(leagueKey: string, espnId: string): Promise<Checkpoint[] | null> {
  const key = `${leagueKey}:${espnId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.timeline;

  let timeline: Checkpoint[] | null = null;
  try {
    const res = await fetch(summaryUrl(leagueKey, espnId), {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Tick/0.1 (+https://github.com/Khalid-000-ME/tick)" },
    });
    if (res.ok) timeline = build(sportOf(leagueKey), (await res.json()) as Summary);
  } catch {
    /* a failed fetch is "unknown", never "nothing happened" */
  }
  // A failure keeps the last good timeline rather than dropping live markets on one bad
  // request; only a genuinely empty log yields null.
  if (!timeline && hit?.timeline) return hit.timeline;
  cache.set(key, { at: Date.now(), timeline });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return timeline;
}

function build(sport: string, s: Summary): Checkpoint[] | null {
  const out: Checkpoint[] = [];

  if (sport === "soccer") {
    // Goals name a team but carry no score, so they are counted. Verified against a
    // finished fixture: counting reproduced the published final score exactly.
    const competitors = s.header?.competitions?.[0]?.competitors ?? [];
    const homeId = competitors.find((c) => c.homeAway === "home")?.team?.id;
    const awayId = competitors.find((c) => c.homeAway === "away")?.team?.id;
    if (!homeId || !awayId) return null;
    let home = 0;
    let away = 0;
    const goals = (s.keyEvents ?? [])
      .filter((e) => e.scoringPlay && e.team?.id && e.wallclock)
      .map((e) => ({ at: seconds(e.wallclock), team: e.team!.id! }))
      .filter((g) => Number.isFinite(g.at))
      .sort((a, b) => a.at - b.at);
    for (const g of goals) {
      if (g.team === homeId) home += 1;
      else if (g.team === awayId) away += 1;
      else continue;
      out.push({ at: g.at, home, away });
    }
    // An in-play match with no goals yet is a real, usable 0-0 timeline.
    return (s.keyEvents ?? []).length > 0 ? out : null;
  }

  // Basketball and football: every play carries the score that stands after it.
  const plays: Play[] =
    sport === "football"
      ? [...(s.drives?.previous ?? []).flatMap((d) => d.plays ?? []), ...(s.drives?.current?.plays ?? [])]
      : s.plays ?? [];
  for (const p of plays) {
    const at = seconds(p.wallclock);
    if (!Number.isFinite(at) || typeof p.homeScore !== "number" || typeof p.awayScore !== "number") continue;
    const last = out[out.length - 1];
    if (last && last.home === p.homeScore && last.away === p.awayScore) continue;
    out.push({ at, home: p.homeScore, away: p.awayScore });
  }
  if (plays.length === 0) return null;
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** The score as it stood at `t`: whatever the last play before `t` left it at. */
export function scoreAt(timeline: Checkpoint[], t: number): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const c of timeline) {
    if (c.at > t) break;
    home = c.home;
    away = c.away;
  }
  return { home, away };
}
