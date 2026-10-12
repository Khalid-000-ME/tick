import { OUTCOME, toUsd } from "@/lib/chain/config";
import { payoutForSide } from "@/lib/chain/payout";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS } from "@/lib/chain/config";
import deployed from "@/lib/chain/deployed.json";
import { pub } from "@/lib/server/oracle";

/**
 * What every trader has actually made, from the on-chain event index.
 *
 * NET IS PROFIT ON MARKETS THAT HAVE SETTLED: what each position pays, minus what was staked
 * on it, whether or not the winnings have been collected yet. That is the number the Portfolio
 * shows, and it has to be: the leaderboard, a room's table, a group's board and the card on a
 * feed post used to count a stake as spent the moment it was placed and a win as money only
 * once claimed, so the same wallet read differently in each place and a post could show a loss
 * for someone who was up. A stake still open is shown as open and is not counted yet.
 *
 * The payout is the contract's own arithmetic (lib/chain/payout), applied per wallet, market
 * and side exactly as the Portfolio applies it, using what settlement stored. The indexer
 * keeps the event, which has the pools before the settler's bounty and the bounty itself, and
 * the contract's fee adjustment is a closed formula of those, so the stored totals and fee are
 * rebuilt here with no further call. Only the feed's base fee needs the chain, once per feed.
 */
export interface Standing {
  address: string;
  /** Every stake placed. */
  bets: number;
  /** Everything staked, settled or not. */
  staked: number;
  /** Staked on markets that have not settled yet. */
  open: number;
  /** Paid by positions on settled markets, collected or not. A void pays the stake back. */
  returned: number;
  /** Profit on settled markets: returned minus what was staked on them. */
  net: number;
}

const TTL_MS = 15_000;
const PAGE = 5000;
const MAX_PAGES = 12;
let cache: { at: number; rows: Map<string, Standing> } | null = null;

const QUERY = `query S($limit: Int!, $offset: Int!) {
  Stake(limit: $limit, offset: $offset, order_by: { id: asc }) {
    user amount above
    market { id feedId outcome totalAbove totalBelow bounty }
  }
}`;

interface Row {
  user: string;
  amount: string;
  above: boolean;
  market: { id: string; feedId: string; outcome: number; totalAbove: string | null; totalBelow: string | null; bounty: string | null };
}

const FALLBACK_FEE = Number((deployed as { feeBps: number }).feeBps);
const fees: { at: number; byFeed: Map<string, number> } = { at: 0, byFeed: new Map() };

/** A feed's base fee, from the contract, cached. Falls back to the deployment's fee. */
async function baseFees(feedIds: string[]): Promise<Map<string, number>> {
  const missing = feedIds.filter((f) => !fees.byFeed.has(f));
  if (missing.length && Date.now() - fees.at > 60_000) {
    fees.at = Date.now();
    for (const feedId of missing) {
      try {
        // feeds() returns (enabled, strikeStep, windowSeconds, settleTolerance, feeBps).
        const cfg = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "feeds", args: [feedId as `0x${string}`] })) as readonly [boolean, bigint, number, number, number];
        fees.byFeed.set(feedId, Number(cfg[4]));
      } catch {
        /* the fallback below covers it */
      }
    }
  }
  return new Map(feedIds.map((f) => [f, fees.byFeed.get(f) ?? FALLBACK_FEE]));
}

/**
 * What settlement stored for a market, rebuilt from its event. The contract carves the
 * settler's bounty out of the losing pool and lowers the fee so bounty plus fee never
 * exceeds the base fee on that pool (Tick._finalise); this is that, step for step.
 */
export function settledTerms(outcome: number, ta: bigint, tb: bigint, bounty: bigint, baseFee: number) {
  let above = ta;
  let below = tb;
  let fee = BigInt(baseFee);
  if (outcome === OUTCOME.void) return { above, below, feeBps: 0 };
  const lose = outcome === OUTCOME.above ? tb : ta;
  if (bounty !== 0n && lose > bounty) {
    fee = (lose * fee - bounty * 10_000n) / (lose - bounty);
    if (outcome === OUTCOME.above) below = tb - bounty;
    else above = ta - bounty;
  }
  return { above, below, feeBps: Number(fee) };
}

async function allStakes(url: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { limit: PAGE, offset: page * PAGE } }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { data?: { Stake: Row[] }; errors?: unknown };
    if (!json.data) throw new Error("the index returned no data");
    rows.push(...json.data.Stake);
    if (json.data.Stake.length < PAGE) break;
  }
  return rows;
}

export async function standings(): Promise<Map<string, Standing>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const url = process.env.NEXT_PUBLIC_INDEXER_URL;
  if (!url) throw new Error("no index configured");

  const stakes = await allStakes(url);
  const feeOf = await baseFees([...new Set(stakes.filter((s) => s.market.outcome !== OUTCOME.unresolved).map((s) => s.market.feedId))]);

  // One position per wallet, market and side, as the Portfolio keeps them: the pro-rata payout
  // divides once over the whole position, so adding stakes first is what matches it to the unit.
  const positions = new Map<string, { user: string; above: boolean; mine: bigint; market: Row["market"] }>();
  const totals = new Map<string, { bets: number; staked: bigint; open: bigint }>();
  for (const s of stakes) {
    const user = s.user.toLowerCase();
    const amount = BigInt(s.amount);
    const t = totals.get(user) ?? { bets: 0, staked: 0n, open: 0n };
    t.bets += 1;
    t.staked += amount;
    if (s.market.outcome === OUTCOME.unresolved) t.open += amount;
    totals.set(user, t);
    const key = `${user}|${s.market.id}|${s.above}`;
    const p = positions.get(key);
    if (p) p.mine += amount;
    else positions.set(key, { user, above: s.above, mine: amount, market: s.market });
  }

  const paid = new Map<string, { returned: bigint; settledStake: bigint }>();
  for (const p of positions.values()) {
    const m = p.market;
    if (m.outcome === OUTCOME.unresolved || m.totalAbove === null || m.totalBelow === null) continue;
    const terms = settledTerms(m.outcome, BigInt(m.totalAbove), BigInt(m.totalBelow), BigInt(m.bounty ?? "0"), feeOf.get(m.feedId) ?? FALLBACK_FEE);
    const payout = payoutForSide(m.outcome, terms.feeBps, terms.above, terms.below, p.above ? "ABOVE" : "BELOW", p.mine);
    const r = paid.get(p.user) ?? { returned: 0n, settledStake: 0n };
    r.returned += payout;
    r.settledStake += p.mine;
    paid.set(p.user, r);
  }

  const rows = new Map<string, Standing>();
  for (const [address, t] of totals) {
    const r = paid.get(address) ?? { returned: 0n, settledStake: 0n };
    rows.set(address, {
      address,
      bets: t.bets,
      staked: toUsd(t.staked),
      open: toUsd(t.open),
      returned: toUsd(r.returned),
      net: toUsd(r.returned - r.settledStake),
    });
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/** One wallet's standing, zeroed when it has never staked. */
export function standingOf(rows: Map<string, Standing>, address: string): Standing {
  return rows.get(address.toLowerCase()) ?? { address: address.toLowerCase(), bets: 0, staked: 0, open: 0, returned: 0, net: 0 };
}

export const byNet = (a: Standing, b: Standing) => b.net - a.net || b.bets - a.bets;

