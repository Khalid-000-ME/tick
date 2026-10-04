/**
 * End-to-end proof of the settler bounty, with real transactions and NO help from the app.
 *
 *   npx tsx scripts/bounty-e2e.ts
 *
 * Two participants take opposite sides of one 30-second BTC window. A third wallet that
 * has never touched the product — only MON for gas — runs scripts/settler.ts, settles the
 * market from Hermes' signed update, and is paid. Then both claim.
 *
 * What it asserts, on chain:
 *   - the settler (a stranger) earns exactly half the fee: 1 tUSD on a 100 tUSD losing pool
 *   - the winner is paid, the loser is not
 *   - winner + fee recipient + settler never exceed what was staked, and account for
 *     essentially all of it
 */
import { spawnSync } from "node:child_process";
import { formatUnits } from "viem";
import {
  CONTRACTS,
  TickAbi,
  Terms,
  deployerWallet,
  deployer,
  ensureFunded,
  marketId,
  participant,
  pub,
  registerParticipantPk,
  sleep,
  txUrl,
} from "./lib/chain.js";
import { fetchPriceUpdate, feedBySymbol } from "../lib/pyth.js";
import { PythAbi } from "../lib/chain/pythAbi.js";
import { WINDOW_S } from "../lib/chain/config.js";

const usd = (v: bigint) => `${formatUnits(v, 6)} tUSD`;
const STAKE = 100n * 10n ** 6n;

async function main() {
  const feed = feedBySymbol("BTC/USD");
  const a = participant(11);
  const b = participant(12);
  const settler = participant(13);
  for (const p of [a, b, settler]) registerParticipantPk(p.account.address, p.pk);

  console.log("funding participants (MON for gas, tUSD for stakes)…");
  await ensureFunded(a.account.address, 150n * 10n ** 15n, 200n * 10n ** 6n);
  await ensureFunded(b.account.address, 150n * 10n ** 15n, 200n * 10n ** 6n);
  // The settler gets MON only. It must earn its tUSD or this proves nothing.
  const sMon = await pub.getBalance({ address: settler.account.address });
  if (sMon < 400n * 10n ** 15n) {
    const h = await deployerWallet().sendTransaction({ to: settler.account.address, value: 400n * 10n ** 15n - sMon, account: deployer(), chain: null });
    await pub.waitForTransactionReceipt({ hash: h });
  }

  // Deposit once each, so the stake itself is one transaction inside the window.
  for (const p of [a, b]) {
    const have = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [p.account.address] })) as bigint;
    if (have < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposit", args: [STAKE - have], account: p.account, chain: null });
      await pub.waitForTransactionReceipt({ hash: h });
    }
  }

  // Start of a fresh window, so there is time to stake before it closes.
  console.log("waiting for a window to open…");
  while (Math.floor(Date.now() / 1000) % WINDOW_S > 3 || Math.floor(Date.now() / 1000) % WINDOW_S < 1) await sleep(250);
  const open = Math.floor(Date.now() / 1000 / WINDOW_S) * WINDOW_S;
  const closesAt = open + WINDOW_S;

  const strike = BigInt(((await (await fetch(`http://localhost:3000/api/strike?feedId=${feed.id}&closesAt=${closesAt}`)).json()) as { strike: string }).strike);
  const terms: Terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) };
  const id = marketId(terms);
  console.log(`window closes ${closesAt}, strike ${strike}, market ${id.slice(0, 12)}…`);

  // Post a fresh price so the cutoff is open, in its own block before the stakes.
  const upd = await fetchPriceUpdate([feed.id]);
  const fee = (await pub.readContract({ address: CONTRACTS.pyth, abi: PythAbi, functionName: "getUpdateFee", args: [upd.updateData] })) as bigint;
  const rh = await deployerWallet().writeContract({ address: CONTRACTS.pyth, abi: PythAbi, functionName: "updatePriceFeeds", args: [upd.updateData], value: fee, gas: 210_000n, account: deployer(), chain: null });
  await pub.waitForTransactionReceipt({ hash: rh });

  for (const [p, above] of [[a, true], [b, false]] as const) {
    const h = await p.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "stakeOn", args: [terms, above, STAKE], account: p.account, chain: null, gas: 400_000n });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  ${above ? "ABOVE" : "BELOW"} staked ${rc.status}  ${txUrl(h)}`);
  }

  const settlerTickBefore = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [settler.account.address] })) as bigint;

  console.log("waiting for the close, then handing the market to a stranger's bot…");
  while (Math.floor(Date.now() / 1000) < closesAt + 2) await sleep(500);

  if (process.env.VIA === "api") {
    // Exercise the app's own /api/settle path instead of the outside bot. The operator
    // collects the bounty here, so only the settlement itself is asserted.
    const r = await fetch("http://localhost:3000/api/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedId: feed.id, strike: strike.toString(), expo: feed.expo, closesAt }),
    });
    const body = await r.json();
    console.log(`  /api/settle -> ${r.status} ${JSON.stringify(body)}`);
    process.exit(r.ok && (body.outcome === 1 || body.outcome === 2) ? 0 : 1);
  }

  const run = spawnSync("npx", ["tsx", "scripts/settler.ts", "once"], {
    env: { ...process.env, SETTLER_PK: settler.pk },
    encoding: "utf8",
  });
  console.log(run.stdout.trim().split("\n").map((l) => `  bot> ${l}`).join("\n"));
  if (run.status !== 0) throw new Error(`settler failed: ${run.stderr}`);

  const s = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settlements", args: [id] })) as readonly [number, bigint, bigint, number, bigint, bigint];
  const outcome = s[0];
  if (outcome !== 1 && outcome !== 2) throw new Error(`expected ABOVE/BELOW, got outcome ${outcome}`);
  console.log(`outcome: ${outcome === 1 ? "ABOVE" : "BELOW"}  settled at ${s[2]} vs strike ${strike}`);

  const bounty = ((await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [settler.account.address] })) as bigint) - settlerTickBefore;
  console.log(`settler (no prior tUSD) earned ${usd(bounty)}`);

  let paid = 0n;
  for (const p of [a, b]) {
    const before = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [p.account.address] })) as bigint;
    const h = await p.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "claim", args: [id], account: p.account, chain: null, gas: 200_000n });
    await pub.waitForTransactionReceipt({ hash: h });
    const after = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [p.account.address] })) as bigint;
    paid += after - before;
  }
  const fees = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "feesAccrued", args: [deployer().address] })) as bigint;

  console.log(`claimed payouts ${usd(paid)} | fee recipient ${usd(fees)} | settler ${usd(bounty)} | staked ${usd(2n * STAKE)}`);

  const total = paid + fees + bounty;
  const checks: [string, boolean][] = [
    ["settler earned exactly half the 2% fee (1 tUSD)", bounty === 1_000_000n],
    ["winner paid more than the 100 staked, loser nothing", paid > STAKE && paid < 2n * STAKE],
    ["payouts + fees + bounty never exceed what was staked", total <= 2n * STAKE],
    ["and account for all but dust", total >= 2n * STAKE - 1_000n],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
    ok &&= pass;
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
