import { NextResponse } from "next/server";
import { toUsd } from "@/lib/chain/config";

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

const QUERY = `{
  Stake(limit: 5000) { user amount }
  Claim(limit: 5000) { user payout }
}`;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_INDEXER_URL;
  if (!url) return NextResponse.json({ error: "No index configured." }, { status: 503 });
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as {
      data?: { Stake: { user: string; amount: string }[]; Claim: { user: string; payout: string }[] };
    };
    if (!json.data) throw new Error("the index returned no data");

    const rows = new Map<string, { staked: bigint; won: bigint; bets: number }>();
    const get = (u: string) => {
      const k = u.toLowerCase();
      const r = rows.get(k) ?? { staked: 0n, won: 0n, bets: 0 };
      rows.set(k, r);
      return r;
    };
    for (const s of json.data.Stake) {
      const r = get(s.user);
      r.staked += BigInt(s.amount);
      r.bets += 1;
    }
    for (const c of json.data.Claim) {
      get(c.user).won += BigInt(c.payout);
    }

    const traders = [...rows.entries()]
      .map(([address, r]) => ({
        address,
        bets: r.bets,
        staked: toUsd(r.staked),
        returned: toUsd(r.won),
        net: toUsd(r.won - r.staked),
      }))
      .filter((t) => t.bets > 0)
      .sort((a, b) => b.net - a.net || b.bets - a.bets)
      .slice(0, 25);

    const body = {
      traders,
      totals: {
        traders: rows.size,
        bets: traders.reduce((n, t) => n + t.bets, 0),
        staked: [...rows.values()].reduce((n, r) => n + toUsd(r.staked), 0),
      },
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[leaderboard] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Leaderboard unavailable." }, { status: 503 });
  }
}
