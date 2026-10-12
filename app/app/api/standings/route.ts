import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { standingOf, standings } from "@/lib/server/standings";

/**
 * What a given set of wallets has made, for a room's table. The membership comes from the
 * contract; this only answers the money question for addresses the caller already has.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const list = (new URL(request.url).searchParams.get("addresses") ?? "").split(",").map((a) => a.trim()).filter((a) => isAddress(a)).slice(0, 200);
  if (list.length === 0) return NextResponse.json({ ok: true, standings: [] });
  try {
    const rows = await standings();
    return NextResponse.json({ ok: true, standings: list.map((a) => standingOf(rows, a)) });
  } catch {
    return NextResponse.json({ ok: false, error: "Standings are unavailable right now.", standings: list.map((a) => ({ address: a.toLowerCase(), bets: 0, staked: 0, returned: 0, net: 0 })) });
  }
}
