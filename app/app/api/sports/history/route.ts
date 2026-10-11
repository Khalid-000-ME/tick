import { NextResponse } from "next/server";
import { isAddress, parseAbiItem } from "viem";
import { CONTRACTS } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";

/**
 * A wallet's recent sports stakes, read straight from the contract's logs.
 *
 * The event index covers the price contract only, and extending it costs an indexer
 * redeploy. Until then this scans the sports contract directly. Monad's public RPC answers
 * at most 99 blocks per request, so the scan is bounded to the last ~2 hours (about 200
 * requests, a dozen at a time) and cached per wallet. It exists so stakes placed on
 * another device, or before positions were recorded locally, can still be seen and claimed.
 */
export const dynamic = "force-dynamic";

const STAKED = parseAbiItem(
  "event Staked(bytes32 indexed marketId, address indexed user, bool home, uint256 amount, bytes32 eventId, uint64 closesAt)"
);
const SPAN = 20_000n;
const CHUNK = 99n;
const TTL_MS = 90_000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(request: Request) {
  const user = new URL(request.url).searchParams.get("user") ?? "";
  if (!isAddress(user)) return NextResponse.json({ error: "Expected a wallet address." }, { status: 400 });
  const key = user.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  try {
    const head = await pub.getBlockNumber();
    const ends: bigint[] = [];
    for (let to = head; to > head - SPAN; to -= CHUNK) ends.push(to);

    const logs = [];
    for (let i = 0; i < ends.length; i += 12) {
      const batch = await Promise.all(
        ends.slice(i, i + 12).map((to) =>
          pub.getLogs({ address: CONTRACTS.tickSports, event: STAKED, args: { user: user as `0x${string}` }, fromBlock: to - CHUNK + 1n, toBlock: to }).catch(() => [])
        )
      );
      for (const l of batch) logs.push(...l);
    }

    const stakes = logs.map((l) => ({
      marketId: l.args.marketId as `0x${string}`,
      eventId: l.args.eventId as `0x${string}`,
      closesAt: Number(l.args.closesAt),
      side: l.args.home ? "HOME" : "AWAY",
      amount: Number(l.args.amount) / 1e6,
      block: Number(l.blockNumber),
    }));
    const body = { stakes, fromBlock: Number(head - SPAN) };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(body);
  } catch (e) {
    console.error(`[sports/history] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not read sports history." }, { status: 503 });
  }
}
