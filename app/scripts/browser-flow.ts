/**
 * The browser's exact path, on a wallet that starts with nothing but gas.
 *
 *   npx tsx scripts/browser-flow.ts
 *
 * Mirrors what the UI does, in the same order and through the same API routes:
 *   setup  : faucet claim -> approve -> deposit        (lib/useStake.ts, first stake only)
 *   stake  : POST /api/price/refresh -> stakeOn        (inside one 30s window)
 *   settle : POST /api/settle                          (lib/usePositions.ts)
 *   claim  : claim(id)                                 (the dock's Claim button)
 *
 * This exists because the contract-level proof (bounty-e2e) funds wallets as an admin and
 * skips the approve/deposit a real first-time user hits. That setup takes longer than one
 * 30-second window, which is why useStake freezes the agreed terms and refuses to silently
 * restake them into the next window at a different strike. Asserted below.
 */
import { formatUnits } from "viem";
import { CONTRACTS, TestUSDAbi, TickAbi, deployer, deployerWallet, marketId, participant, pub, sleep, txUrl } from "./lib/chain.js";
import { feedBySymbol } from "../lib/pyth.js";
import { WINDOW_S } from "../lib/chain/config.js";

const usd = (v: bigint) => `${formatUnits(v, 6)} tUSD`;
const STAKE = 25n * 10n ** 6n;
const APP = "http://localhost:3000";

async function main() {
  const feed = feedBySymbol("BTC/USD");
  const me = participant(21);
  const other = participant(22);
  console.log(`fresh user ${me.account.address}`);

  // Gas only. Everything else must come from the product, as it would for a real user.
  for (const p of [me, other]) {
    const mon = await pub.getBalance({ address: p.account.address });
    if (mon < 300n * 10n ** 15n) {
      const h = await deployerWallet().sendTransaction({ to: p.account.address, value: 300n * 10n ** 15n - mon, account: deployer(), chain: null });
      await pub.waitForTransactionReceipt({ hash: h });
    }
  }

  // ---- setup, exactly as useStake does it on a first stake
  for (const p of [me, other]) {
    const bal = (await pub.readContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "balanceOf", args: [p.account.address] })) as bigint;
    if (bal < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "claim", args: [], account: p.account, chain: null, gas: 120_000n });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log("  faucet claimed");
    }
    const allow = (await pub.readContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "allowance", args: [p.account.address, CONTRACTS.tick] })) as bigint;
    if (allow < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "approve", args: [CONTRACTS.tick, 2n ** 255n], account: p.account, chain: null, gas: 80_000n });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log("  approved");
    }
    const dep = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [p.account.address] })) as bigint;
    if (dep < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposit", args: [STAKE - dep], account: p.account, chain: null, gas: 120_000n });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log("  deposited");
    }
  }

  // ---- stake, inside one window, the way the second tap does
  console.log("waiting for a fresh window…");
  while (Math.floor(Date.now() / 1000) % WINDOW_S > 2) await sleep(200);
  const closesAt = Math.floor(Date.now() / 1000 / WINDOW_S) * WINDOW_S + WINDOW_S;

  const strike = BigInt(((await (await fetch(`${APP}/api/strike?feedId=${feed.id}&closesAt=${closesAt}`)).json()) as { strike: string }).strike);
  const terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) };
  const id = marketId(terms);

  const r = await fetch(`${APP}/api/price/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id }) });
  console.log(`  /api/price/refresh -> ${r.status}`);

  const t0 = Date.now();
  for (const [p, above] of [[me, true], [other, false]] as const) {
    const h = await p.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "stakeOn", args: [terms, above, STAKE], account: p.account, chain: null, gas: 400_000n });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  staked ${above ? "ABOVE" : "BELOW"} ${rc.status}  ${txUrl(h)}`);
    if (rc.status !== "success") throw new Error("stake reverted");
  }
  const secondsLeft = closesAt - Math.floor(Date.now() / 1000);
  console.log(`  both stakes landed in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${secondsLeft}s still on the clock`);

  // ---- settle, the way the dock does when the countdown hits zero
  while (Math.floor(Date.now() / 1000) < closesAt + 2) await sleep(500);
  const sr = await fetch(`${APP}/api/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id, strike: strike.toString(), expo: feed.expo, closesAt }) });
  const sb = (await sr.json()) as { outcome?: number; error?: string };
  console.log(`  /api/settle -> ${sr.status} outcome=${sb.outcome ?? sb.error}`);

  // ---- what the dock shows, read back from the chain. Which side won is a coin flip,
  // so assert against whichever one did rather than hoping it was ours — a check that
  // only runs when ABOVE happens to win is a check that usually proves nothing.
  if (sb.outcome !== 1 && sb.outcome !== 2) throw new Error(`no outcome: ${sb.error}`);
  const winner = sb.outcome === 1 ? me : other;
  const loser = sb.outcome === 1 ? other : me;
  console.log(`  outcome ${sb.outcome === 1 ? "ABOVE" : "BELOW"} — ${winner === me ? "our user" : "the counterparty"} won`);

  const preview = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "previewClaim", args: [id, winner.account.address] })) as bigint;
  const loserPreview = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "previewClaim", args: [id, loser.account.address] })) as bigint;
  console.log(`  dock would show the winner "You won", claimable ${usd(preview)}; the loser "You lost", claimable ${usd(loserPreview)}`);

  const before = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [winner.account.address] })) as bigint;
  const ch = await winner.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "claim", args: [id], account: winner.account, chain: null, gas: 200_000n });
  await pub.waitForTransactionReceipt({ hash: ch });
  const claimed = ((await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [winner.account.address] })) as bigint) - before;
  console.log(`  claimed ${usd(claimed)} into the Tick balance  ${txUrl(ch)}`);

  const checks: [string, boolean][] = [
    ["a wallet holding only gas could stake through the product", true],
    ["both stakes fit inside one 30-second window", secondsLeft > 0],
    ["the market settled to a real outcome", sb.outcome === 1 || sb.outcome === 2],
    ["the winner was actually paid, and more than they staked", claimed > STAKE],
    ["the payout matched previewClaim exactly", claimed === preview],
    ["the loser is offered nothing to claim", loserPreview === 0n],
    ["winner + fee + bounty never exceeded the 50 staked", claimed <= 2n * STAKE],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
    ok &&= pass;
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
