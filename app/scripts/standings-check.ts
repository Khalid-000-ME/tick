/**
 * The card, the leaderboard and the portfolio must agree. This computes each wallet's net the
 * way the Portfolio does (settlements() read from the chain, per wallet, market and side) and
 * compares it with what the server's standings say, to the cent, for every trader.
 */
import { createPublicClient, http } from "viem";
import { TickAbi } from "../lib/chain/abi";
import { CONTRACTS, monadTestnet, toUsd } from "../lib/chain/config";
import { payoutForSide } from "../lib/chain/payout";
import { standings } from "../lib/server/standings";

const pub = createPublicClient({ chain: { ...monadTestnet, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } }, transport: http() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = await standings();
  const url = process.env.NEXT_PUBLIC_INDEXER_URL!;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ Stake(limit: 5000) { user amount above market { id outcome } } }" }),
  });
  const stakes = ((await res.json()) as { data: { Stake: { user: string; amount: string; above: boolean; market: { id: string; outcome: number } }[] } }).data.Stake;

  // The portfolio's way: one position per wallet, market and side; payout from what settlement stored.
  const pos = new Map<string, { user: string; above: boolean; mine: bigint; id: string; outcome: number }>();
  for (const s of stakes) {
    if (s.market.outcome === 0) continue;
    const k = `${s.user.toLowerCase()}|${s.market.id}|${s.above}`;
    const p = pos.get(k);
    if (p) p.mine += BigInt(s.amount);
    else pos.set(k, { user: s.user.toLowerCase(), above: s.above, mine: BigInt(s.amount), id: s.market.id, outcome: s.market.outcome });
  }
  const list = [...pos.values()];
  const settle = new Map<string, readonly [number, bigint, bigint, number, bigint, bigint]>();
  const ids = [...new Set(list.map((p) => p.id))];
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const out = await pub.multicall({ allowFailure: true, contracts: part.map((id) => ({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settlements" as const, args: [id as `0x${string}`] as const })) });
    out.forEach((r, j) => { if (r.status === "success") settle.set(part[j], r.result as never); });
    await sleep(300);
  }

  const portfolio = new Map<string, bigint>();
  for (const p of list) {
    const s = settle.get(p.id);
    if (!s) continue;
    const pay = payoutForSide(p.outcome, s[3], s[4], s[5], p.above ? "ABOVE" : "BELOW", p.mine);
    portfolio.set(p.user, (portfolio.get(p.user) ?? 0n) + pay - p.mine);
  }

  let bad = 0;
  console.log(`${rows.size} traders, ${list.length} settled positions in ${ids.length} markets`);
  for (const [addr, row] of rows) {
    const want = toUsd(portfolio.get(addr) ?? 0n);
    const same = Math.abs(want - row.net) < 0.0000005;
    if (!same) bad++;
    console.log(`${same ? "ok  " : "DIFF"} ${addr.slice(0, 10)}  portfolio ${want.toFixed(6).padStart(10)}  card ${row.net.toFixed(6).padStart(10)}  (${row.bets} stakes, ${row.open.toFixed(2)} open)`);
  }
  console.log(bad ? `\n${bad} traders differ` : "\nevery trader matches");
  process.exit(bad ? 1 : 0);
}

void main();
