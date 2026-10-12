import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { byNet, standingOf, standings } from "@/lib/server/standings";

/**
 * What a given set of wallets has made, and where each ranks overall. Membership and
 * authorship come from the contracts; this only answers the money question for addresses the
 * caller already has, which is what a room's table, a group's leaderboard and a feed post's
 * card all need.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const list = (new URL(request.url).searchParams.get("addresses") ?? "").split(",").map((a) => a.trim()).filter((a) => isAddress(a)).slice(0, 200);
  if (list.length === 0) return NextResponse.json({ ok: true, standings: [] });
  try {
    const rows = await standings();
    const ranked = [...rows.values()].filter((t) => t.bets > 0).sort(byNet);
    const place = new Map(ranked.map((t, i) => [t.address, i + 1]));
    return NextResponse.json({
      ok: true,
      of: ranked.length,
      standings: list.map((a) => ({ ...standingOf(rows, a), rank: place.get(a.toLowerCase()) ?? null })),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Standings are unavailable right now.",
      of: 0,
      standings: list.map((a) => ({ address: a.toLowerCase(), bets: 0, staked: 0, returned: 0, net: 0, rank: null })),
    });
  }
}
