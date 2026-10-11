import { NextResponse } from "next/server";
import { parseAbiItem } from "viem";
import { CONTRACTS } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";

/**
 * The latest sports stakes from anyone, for the sports ticker.
 *
 * The event index covers the price contract only, and the public RPC answers at most 99
 * blocks a request, so this keeps a rolling scan in memory: the first call backfills about
 * the last half hour, and every later call reads only the blocks since the one before. The
 * chain gives an eventId, not a fixture name, so names are learned from the fixtures and
 * in-play windows the app serves and remembered per eventId. A stake on a window that has
 * already rolled away still keeps its name once it has been seen.
 */
export const dynamic = "force-dynamic";

const STAKED = parseAbiItem(
  "event Staked(bytes32 indexed marketId, address indexed user, bool home, uint256 amount, bytes32 eventId, uint64 closesAt)"
);
const CHUNK = 99n;
const BACKFILL = 4_000n;
const KEEP = 40;
const TTL_MS = 4_000;

export interface SportsTrade {
  label: string;
  team: string;
  amount: number;
  user: string;
  block: number;
  micro: boolean;
}

interface Raw { eventId: string; home: boolean; amount: number; user: string; block: number }

const names = new Map<string, { fixture: string; home: string; away: string; micro: string | null }>();
let scanned = 0n;
let recent: Raw[] = [];
let cache: { at: number; body: unknown } | null = null;

async function learnNames(origin: string) {
  const grab = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const [events, micro] = await Promise.all([grab("/api/sports/events"), grab("/api/sports/micro")]);
  type Side = { abbr: string; short: string };
  for (const e of (events?.events ?? []) as { eventId: string; home: Side; away: Side }[]) {
    names.set(e.eventId.toLowerCase(), { fixture: `${e.away.abbr} @ ${e.home.abbr}`, home: e.home.short, away: e.away.short, micro: null });
  }
  for (const m of (micro?.markets ?? []) as { eventId: string; home: Side; away: Side; windowLabel: string }[]) {
    if (!names.has(m.eventId.toLowerCase())) {
      names.set(m.eventId.toLowerCase(), { fixture: `${m.away.abbr} @ ${m.home.abbr}`, home: m.home.short, away: m.away.short, micro: m.windowLabel });
    }
  }
  if (names.size > 5000) names.clear();
}

async function scan() {
  const head = await pub.getBlockNumber();
  const from = scanned > 0n ? scanned + 1n : head - BACKFILL;
  if (from > head) return;
  const ends: bigint[] = [];
  for (let to = head; to >= from; to -= CHUNK) ends.push(to);
  const found: Raw[] = [];
  for (let i = 0; i < ends.length; i += 12) {
    const batch = await Promise.all(
      ends.slice(i, i + 12).map((to) => {
        const lo = to - CHUNK + 1n;
        return pub.getLogs({ address: CONTRACTS.tickSports, event: STAKED, fromBlock: lo < from ? from : lo, toBlock: to }).catch(() => []);
      })
    );
    for (const logs of batch) {
      for (const l of logs) {
        found.push({
          eventId: (l.args.eventId as string).toLowerCase(),
          home: Boolean(l.args.home),
          amount: Number(l.args.amount) / 1e6,
          user: l.args.user as string,
          block: Number(l.blockNumber),
        });
      }
    }
  }
  scanned = head;
  recent = [...found, ...recent].sort((a, b) => b.block - a.block).slice(0, KEEP);
}

export async function GET(request: Request) {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);
  try {
    await Promise.all([scan(), learnNames(new URL(request.url).origin)]);
    const trades: SportsTrade[] = recent.map((r) => {
      const n = names.get(r.eventId);
      return {
        label: n ? (n.micro ? `${n.fixture} · next ${n.micro}` : n.fixture) : "Sports market",
        team: n ? (r.home ? n.home : n.away) : r.home ? "Home" : "Away",
        amount: r.amount,
        user: r.user,
        block: r.block,
        micro: Boolean(n?.micro),
      };
    });
    const body = { trades };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[sports/activity] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not read sports activity." }, { status: 503 });
  }
}
