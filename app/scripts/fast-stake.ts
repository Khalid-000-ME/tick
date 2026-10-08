/**
 * Proves the one-tap stake path on chain: a wallet that is already set up (approved and
 * deposited) stakes with a single transaction at the fixed gas limit useStake uses, and the
 * receipt arrives at Monad speed instead of viem's default 4-second polling.
 *
 * Needs the app running (for /api/strike and /api/price/refresh) and one of the e2e
 * participants to hold a Tick deposit. Stakes alone, so the market voids and refunds.
 */
import { createPublicClient, formatUnits, http } from "viem";
import { feedBySymbol } from "../lib/pyth.js";
import { CONTRACTS, TickAbi, marketId, monadTestnet, participant, sleep, txUrl } from "./lib/chain.js";

const APP = "http://localhost:3000";
const WINDOW_S = 30;
const STAKE_GAS = 300_000n;
const STAKE = 1n * 10n ** 6n;

const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

async function main() {
  const feed = feedBySymbol("BTC/USD");
  let who = participant(11);
  let dep = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [who.account.address] })) as bigint;
  if (dep < STAKE) {
    who = participant(12);
    dep = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [who.account.address] })) as bigint;
  }
  if (dep < STAKE) throw new Error("no e2e participant holds a Tick deposit; run bounty-e2e first");
  console.log(`staker ${who.account.address} deposited ${formatUnits(dep, 6)} USDC`);

  while (Math.floor(Date.now() / 1000) % WINDOW_S > 2) await sleep(200);
  const closesAt = Math.floor(Date.now() / 1000 / WINDOW_S) * WINDOW_S + WINDOW_S;
  const strike = BigInt(((await (await fetch(`${APP}/api/strike?feedId=${feed.id}&closesAt=${closesAt}`)).json()) as { strike: string }).strike);
  const terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) };

  const t0 = Date.now();
  await fetch(`${APP}/api/price/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id }) });
  const tPrice = Date.now();

  const estimate = await pub.estimateContractGas({ address: CONTRACTS.tick, abi: TickAbi, functionName: "stakeOn", args: [terms, true, STAKE], account: who.account });
  console.log(`estimateGas for stakeOn: ${estimate} (fixed limit ${STAKE_GAS})`);

  const tSend = Date.now();
  const hash = await who.wallet.writeContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "stakeOn",
    args: [terms, true, STAKE],
    account: who.account,
    chain: monadTestnet,
    gas: STAKE_GAS,
  });
  const tSigned = Date.now();
  const rc = await pub.waitForTransactionReceipt({ hash });
  const tDone = Date.now();

  console.log(`price post ${tPrice - t0}ms | sign+send ${tSigned - tSend}ms | receipt ${tDone - tSigned}ms | tap-to-confirmed ${tDone - t0}ms`);
  console.log(`market ${marketId(terms).slice(0, 12)}…  ${rc.status}  ${txUrl(hash)}`);
  const left = closesAt - Math.floor(Date.now() / 1000);
  console.log(`${left}s left on the clock at confirmation`);

  const checks: [string, boolean][] = [
    ["stake landed at the fixed 300k gas limit", rc.status === "success"],
    ["the fixed limit leaves headroom over the estimate", STAKE_GAS > estimate],
    ["confirmed with time to spare in the 30s window", left > 15],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
