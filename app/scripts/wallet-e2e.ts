/**
 * One balance and the gas tank, end to end on Monad testnet, against the real contracts.
 *
 * A fresh wallet gets 2 USDC and some MON. Then, through the same lib/funds code the app
 * runs: money is moved into the price contract for a stake, pulled across to the sports
 * contract when a sports stake needs it, $0.10 of it is swapped for gas at GasStation, and
 * everything is brought back to the wallet. Every balance is read back from chain and
 * asserted, so a step that silently did nothing fails here.
 *
 *   npx tsx scripts/wallet-e2e.ts
 */
import { formatEther, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, ensureFunded, pub, walletFor } from "./lib/chain.js";
import { allowanceFor, consolidateToWallet, ensureStakeable, fillGas, quoteGas, readFunds } from "../lib/funds.js";

const pk = keccak256(toHex(`tick-wallet-e2e-${Date.now()}`));
const account = privateKeyToAccount(pk).address;
const wallet = walletFor(pk);
const step = (s: string) => console.log(`   · ${s}`);
const usd = (n: bigint) => (Number(n) / 1e6).toFixed(2);

function expect(cond: boolean, what: string) {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`   ✓ ${what}`);
}

async function show(label: string) {
  const f = await readFunds(account);
  console.log(`${label}: wallet ${usd(f.wallet)} · price ${usd(f.tick)} · sports ${usd(f.sports)} · total ${usd(f.total)} · ${Number(formatEther(f.mon)).toFixed(4)} MON`);
  return f;
}

async function main() {
  console.log(`Fresh wallet ${account}`);
  await ensureFunded(account, 300_000_000_000_000_000n, 2_000_000n);
  let f = await show("Funded");
  expect(f.total === 2_000_000n, "one balance of 2.00 USDC");

  console.log("\n1. A price stake of $0.50 needs money in the price contract");
  expect((await ensureStakeable(wallet, account, "tick", 500_000n, f, await allowanceFor(account, "tick"), step)) === null, "moved");
  f = await show("After");
  expect(f.tick === 2_000_000n && f.wallet === 0n, "whole balance consolidated into the price contract");

  console.log("\n2. A sports stake of $0.30 pulls it across");
  expect((await ensureStakeable(wallet, account, "sports", 300_000n, f, await allowanceFor(account, "sports"), step)) === null, "moved");
  f = await show("After");
  expect(f.sports === 2_000_000n && f.tick === 0n, "balance followed the stake to sports, total unchanged");

  console.log("\n3. Fill the gas tank with $0.10 of USDC");
  const quoted = await quoteGas(100_000n);
  const before = f.mon;
  const r = await fillGas(wallet, account, 100_000n, step);
  console.log(`   ${r.message}`);
  expect(r.ok, "fill succeeded");
  f = await show("After");
  expect(f.total === 1_900_000n, "exactly $0.10 spent");
  // MON rises by the quote, minus the gas the withdraw/approve/fill themselves cost.
  expect(f.mon > before && f.mon - before + 100_000_000_000_000_000n > quoted, `tank filled (${formatEther(quoted)} MON quoted)`);

  console.log("\n4. Move everything back to the wallet");
  expect((await consolidateToWallet(wallet, account, f, step)) === null, "moved");
  f = await show("After");
  expect(f.wallet === 1_900_000n && f.tick === 0n && f.sports === 0n, "all 1.90 USDC back in the wallet");

  const reserve = await pub.getBalance({ address: CONTRACTS.gasStation });
  console.log(`\nGasStation reserve now ${formatEther(reserve)} MON. All checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
