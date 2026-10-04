/**
 * Measures what the acceptance margin has to be justified against.
 *
 *   npx tsx scripts/measure-latency.ts [samples]
 *
 * The cutoff can never be tighter than the time between deciding to stake and the stake
 * being included, plus however stale the price already was. A first attempt used a 2s
 * margin and the second stake of a pair reverted, because 2s is BELOW Monad's own
 * inclusion latency over a public RPC. The margin is an empirical quantity, not a taste.
 *
 * Two distinct numbers, which it is easy to conflate:
 *   submit->receipt   wall-clock a user waits. Includes RPC round trips.
 *   priceAge at inclusion  how old the on-chain price was in the including block. This is
 *                     the one the contract actually gates on.
 */
import { formatUnits } from "viem";
import { CONTRACTS, PythAbi, deployer, deployerWallet, pub, sendTimed } from "./lib/chain.js";
import { fetchPriceUpdate, feedBySymbol } from "../lib/pyth.js";

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))];

async function main() {
  const n = Number(process.argv[2] ?? 8);
  const feed = feedBySymbol("BTC/USD");
  console.log(`\nmeasuring inclusion latency on Monad testnet, ${n} samples\n`);

  const submitToReceipt: number[] = [];
  const priceAgeAtInclusion: number[] = [];
  const hermesAgeAtSubmit: number[] = [];

  for (let i = 0; i < n; i++) {
    // Fetch a signed update and note how old it already is when we get it.
    const t0 = Date.now();
    const upd = await fetchPriceUpdate([feed.id]);
    const fetchMs = Date.now() - t0;
    const hermesAge = Math.floor(Date.now() / 1000) - upd.parsed[0].publishTime;
    hermesAgeAtSubmit.push(hermesAge);

    const fee = (await pub.readContract({
      address: CONTRACTS.pyth,
      abi: PythAbi,
      functionName: "getUpdateFee",
      args: [upd.updateData],
    })) as bigint;

    const w = deployerWallet();
    const res = await sendTimed(`refresh #${i + 1} (hermes ${fetchMs}ms, age ${hermesAge}s)`, () =>
      w.writeContract({
        address: CONTRACTS.pyth,
        abi: PythAbi,
        functionName: "updatePriceFeeds",
        args: [upd.updateData],
        value: fee,
        account: deployer(),
        chain: null,
      })
    );
    submitToReceipt.push(res.ms);

    // How stale would a stake included in the NEXT block see the price as?
    const stored = (await pub.readContract({
      address: CONTRACTS.pyth,
      abi: PythAbi,
      functionName: "getPriceUnsafe",
      args: [feed.id],
    })) as { publishTime: bigint };
    const blk = await pub.getBlock();
    priceAgeAtInclusion.push(Number(blk.timestamp) - Number(stored.publishTime));
  }

  console.log(`\nsubmit -> receipt (ms)`);
  console.log(`  min ${pct(submitToReceipt, 0)}  p50 ${pct(submitToReceipt, 0.5)}  p95 ${pct(submitToReceipt, 0.95)}  max ${pct(submitToReceipt, 1)}`);

  console.log(`\nprice age already present when Hermes answers (s)`);
  console.log(`  min ${pct(hermesAgeAtSubmit, 0)}  p50 ${pct(hermesAgeAtSubmit, 0.5)}  max ${pct(hermesAgeAtSubmit, 1)}`);

  console.log(`\non-chain price age one block after a refresh (s)`);
  console.log(`  min ${pct(priceAgeAtInclusion, 0)}  p50 ${pct(priceAgeAtInclusion, 0.5)}  max ${pct(priceAgeAtInclusion, 1)}`);

  // A stake must be included while priceAge <= acceptMargin. The worst case is the price
  // age right after a refresh, plus the time for the staker's own transaction to land.
  const worstPriceAge = pct(priceAgeAtInclusion, 1);
  const worstSubmit = Math.ceil(pct(submitToReceipt, 0.95) / 1000);
  const suggested = worstPriceAge + worstSubmit + 1; // +1 for whole-second timestamps
  console.log(`\nsuggested acceptMargin = ${worstPriceAge}s (price age after refresh)`);
  console.log(`                        + ${worstSubmit}s (p95 submit->receipt)`);
  console.log(`                        + 1s (block.timestamp is whole seconds)`);
  console.log(`                        = ${suggested}s`);
  console.log(
    `\nThis is the residual latency-arbitrage window and it is set by the chain, not by\n` +
      `preference. On a 12s-block chain the same arithmetic gives >= 24s, which is the\n` +
      `window oracle arbitrageurs work in. That comparison is the Monad argument.`
  );
  console.log(`\nMON spent on ${n} refreshes: see the transactions above.`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
  process.exit(1);
});
