import { toUsd } from "@/lib/chain/config";

/**
 * What every trader has actually made, from the on-chain event index.
 *
 * Net is everything their claims paid minus everything they staked, so a ranking cannot be
 * gamed by volume: only by winning. Shared by the global leaderboard and by each room, so a
 * room's table and the main board can never disagree about the same wallet.
 */
export interface Standing {
  address: string;
  bets: number;
  staked: number;
  returned: number;
  net: number;
}

const TTL_MS = 15_000;
let cache: { at: number; rows: Map<string, Standing> } | null = null;

const QUERY = `{
  Stake(limit: 5000) { user amount }
  Claim(limit: 5000) { user payout }
}`;

export async function standings(): Promise<Map<string, Standing>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const url = process.env.NEXT_PUBLIC_INDEXER_URL;
  if (!url) throw new Error("no index configured");

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

  const totals = new Map<string, { staked: bigint; won: bigint; bets: number }>();
  const get = (u: string) => {
    const k = u.toLowerCase();
    const r = totals.get(k) ?? { staked: 0n, won: 0n, bets: 0 };
    totals.set(k, r);
    return r;
  };
  for (const s of json.data.Stake) {
    const r = get(s.user);
    r.staked += BigInt(s.amount);
    r.bets += 1;
  }
  for (const c of json.data.Claim) get(c.user).won += BigInt(c.payout);

  const rows = new Map<string, Standing>();
  for (const [address, r] of totals) {
    rows.set(address, { address, bets: r.bets, staked: toUsd(r.staked), returned: toUsd(r.won), net: toUsd(r.won - r.staked) });
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/** One wallet's standing, zeroed when it has never staked. */
export function standingOf(rows: Map<string, Standing>, address: string): Standing {
  return rows.get(address.toLowerCase()) ?? { address: address.toLowerCase(), bets: 0, staked: 0, returned: 0, net: 0 };
}

export const byNet = (a: Standing, b: Standing) => b.net - a.net || b.bets - a.bets;
