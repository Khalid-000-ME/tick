/**
 * A stake at a price the trader chose, not the window's opening price, lands on chain.
 * Any strike is valid (the feeds are listed with a strike step of 1); this proves it with
 * a real transaction rather than by reading the config.
 */
import { createPublicClient, http } from "viem";
import { Erc20Abi, TickAbi } from "../lib/chain/abi.js";
import { CONTRACTS, monadTestnet } from "../lib/chain/config.js";
import { marketId } from "../lib/chain/market.js";
import { feedBySymbol } from "../lib/pyth.js";
import { strikeLadder } from "../lib/strikes.js";
import { deployer, deployerWallet, sleep, txUrl } from "./lib/chain.js";

const APP = "http://localhost:3101";
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });
const STAKE = 1_000_000n;

async function main() {
  const feed = feedBySymbol("BTC/USD");
  const me = deployer();
  const w = deployerWallet();

  const allow = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [me.address, CONTRACTS.tick] })) as bigint;
  if (allow < STAKE) await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve", args: [CONTRACTS.tick, 2n ** 255n], account: me, chain: null, gas: 180_000n }) });
  const dep = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [me.address] })) as bigint;
  if (dep < STAKE) {
    const rc = await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposit", args: [STAKE - dep], account: me, chain: null, gas: 280_000n }) });
    if (rc.status !== "success") throw new Error("deposit reverted");
  }

  while (Math.floor(Date.now() / 1000) % 30 > 8) await sleep(500);
  const closesAt = (Math.floor(Date.now() / 1000 / 30) + 1) * 30;
  const open = BigInt(((await (await fetch(`${APP}/api/strike?feedId=${feed.id}&closesAt=${closesAt}`)).json()) as { strike: string }).strike);
  const ladder = strikeLadder(open, feed.expo);
  const chosen = ladder[ladder.length - 1]; // the highest round level, well away from the opening price
  console.log(`opening strike ${Number(open) / 1e8}   chosen strike ${Number(chosen) / 1e8}`);

  await fetch(`${APP}/api/price/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id }) });

  const terms = { feedId: feed.id, strike: chosen, expo: feed.expo, closesAt: BigInt(closesAt) } as const;
  const hash = await w.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "stakeOn", args: [terms, true, STAKE], account: me, chain: null, gas: 300_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  const [above] = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "pools", args: [marketId(terms)] })) as readonly [bigint, bigint];
  const [openAbove] = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "pools", args: [marketId({ ...terms, strike: open })] })) as readonly [bigint, bigint];

  console.log(`stake ${rc.status}  ${txUrl(hash)}`);
  const checks: [string, boolean][] = [
    ["a stake at a chosen, non-opening strike succeeded", rc.status === "success"],
    ["it landed in that strike's own pool", above >= STAKE],
    ["and not in the opening strike's pool", openAbove === 0n],
  ];
  for (const [n, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${n}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}
main().catch((e) => { console.error((e as { shortMessage?: string }).shortMessage ?? e); process.exit(1); });
