import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { roomStandings } from "@/lib/server/standings";

/**
 * A room's live scoreboard. The members and the market come from the contract and the owner's
 * message, so the caller passes them in; this answers only the money question, quickly, and is
 * polled every few seconds by the room page.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const feed = q.get("feed") ?? "";
  const since = Math.max(0, Math.floor(Number(q.get("since") ?? 0)) || 0);
  const addresses = (q.get("addresses") ?? "").split(",").map((a) => a.trim()).filter((a) => isAddress(a)).slice(0, 200);
  if (!/^0x[0-9a-fA-F]{64}$/.test(feed) || addresses.length === 0) return NextResponse.json({ ok: true, rows: [] });
  try {
    return NextResponse.json({ ok: true, rows: await roomStandings(addresses, feed.toLowerCase(), since), at: Date.now() });
  } catch {
    return NextResponse.json({ ok: false, error: "The scoreboard is unavailable right now.", rows: [] });
  }
}
