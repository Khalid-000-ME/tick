import { NextResponse } from "next/server";
import { parseAbiItem } from "viem";
import { CONTRACTS } from "@/lib/chain/config";
import { feedById } from "@/lib/pyth";
import { pub } from "@/lib/server/oracle";

/**
 * The last stakes anyone placed, for the ticker.
 *
 * TWO SOURCES, DELIBERATELY. The Envio index holds the full history and is the right
 * answer when it is up. Monad's public RPC caps getLogs at about 100 blocks — roughly
 * forty seconds — so it cannot replace the index, but it needs no extra service and
 * covers exactly the window a live ticker cares about. The route prefers the index and
 * falls back to the RPC, so the ticker keeps showing real trades either way and never
 * shows invented ones.
 */
export const dynamic = "force-dynamic";

const STAKED = parseAbiItem(
  "event Staked(bytes32 indexed marketId, address indexed user, bool above, uint256 amount, int64 priceAtStake, uint64 priceAge, bytes32 feedId, int64 strike, uint64 closesAt)"
);
/** The RPC rejects wider ranges; measured against testnet-rpc.monad.xyz. */
const RPC_SPAN = 99n;
const TTL_MS = 4000;

export interface Trade {
  symbol: string;
  side: "ABOVE" | "BELOW";
  amount: number;
  user: string;
  at: number | null;
}

let cache: { at: number; body: { trades: Trade[]; source: string } } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  let body = await fromIndexer();
  if (!body) body = await fromRpc();
  if (!body) return NextResponse.json({ error: "No trade source reachable." }, { status: 503 });

  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}

async function fromIndexer(): Promise<{ trades: Trade[]; source: string } | null> {
  const url = process.env.NEXT_PUBLIC_INDEXER_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{ Stake(order_by: { stakedAt: desc }, limit: 20) { above amount stakedAt user market { feedId } } }`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { Stake: { above: boolean; amount: string; stakedAt: number; user: string; market: { feedId: string } }[] };
    };
    if (!json.data?.Stake) return null;
    const trades: Trade[] = [];
    for (const s of json.data.Stake) {
      const feed = feedById(s.market.feedId);
      if (!feed) continue;
      trades.push({
        symbol: feed.symbol,
        side: s.above ? "ABOVE" : "BELOW",
        amount: Number(s.amount) / 1e6,
        user: s.user,
        at: s.stakedAt,
      });
    }
    return { trades, source: "index" };
  } catch {
    return null;
  }
}

async function fromRpc(): Promise<{ trades: Trade[]; source: string } | null> {
  try {
    const head = await pub.getBlockNumber();
    const logs = await pub.getLogs({
      address: CONTRACTS.tick,
      event: STAKED,
      fromBlock: head - RPC_SPAN,
      toBlock: head,
    });
    const trades: Trade[] = [];
    for (const log of logs.reverse()) {
      const feed = feedById(log.args.feedId as string);
      if (!feed) continue;
      trades.push({
        symbol: feed.symbol,
        side: log.args.above ? "ABOVE" : "BELOW",
        amount: Number(log.args.amount) / 1e6,
        user: log.args.user as string,
        // Block timestamps would be one extra RPC call per trade; the ticker does not
        // show an age for these, so it stays null rather than being guessed.
        at: null,
      });
    }
    return { trades: trades.slice(0, 20), source: "rpc" };
  } catch (e) {
    console.error(`[activity] rpc fallback failed: ${(e as Error).message.split("\n")[0]}`);
    return null;
  }
}
