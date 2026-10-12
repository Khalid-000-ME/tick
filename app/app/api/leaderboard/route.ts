import { NextResponse } from "next/server";
import { byNet, standings } from "@/lib/server/standings";

/**
 * Top traders, computed from the on-chain event index.
 *
 * Net result is what a trader actually took home: everything their claims paid, minus
 * everything they staked. It is derived from Staked and Claimed events, so it cannot be
 * gamed by anything other than actually winning — and it counts refunds from voided
 * markets as the wash they are, since a refund pays back exactly what it took.
 *
 * Unclaimed winnings do not count yet. A trader who has won but not collected shows the
 * stake as spent, which understates them until they claim; that is the honest reading of
 * the chain rather than a prediction of what they would get.
 */
export const dynamic = "force-dynamic";

const TTL_MS = 15_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);
  try {
    const rows = await standings();
    const traders = [...rows.values()].filter((t) => t.bets > 0).sort(byNet).slice(0, 25);
    const body = {
      traders,
      totals: {
        traders: rows.size,
        bets: traders.reduce((n, t) => n + t.bets, 0),
        staked: [...rows.values()].reduce((n, r) => n + r.staked, 0),
      },
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[leaderboard] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Leaderboard unavailable." }, { status: 503 });
  }
}
