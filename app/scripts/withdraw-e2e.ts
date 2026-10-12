/**
 * Withdrawing to a pasted address, end to end on Monad testnet, against the real contracts.
 *
 * A fresh wallet is funded, its USDC is parked in BOTH market contracts (the awkward case),
 * and then sent out through the same lib/funds code the Fund page runs. Every balance is
 * read back from chain, including the recipient's, so a transfer that silently did nothing
 * fails here. The address checks are exercised too, since a bad paste cannot be undone.
 *
 *   npx tsx scripts/withdraw-e2e.ts
 */
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, ensureFunded, pub, walletFor, participant } from "./lib/chain.js";
import { Erc20Abi, TickAbi, TickSportsAbi } from "../lib/chain/abi.js";
import { readFunds, recipientProblem, sendUsdc } from "../lib/funds.js";

const pk = keccak256(toHex(`tick-withdraw-e2e-${Date.now()}`));
const account = privateKeyToAccount(pk).address;
const wallet = walletFor(pk);
const recipient = participant(9001).account.address;
const step = (s: string) => console.log(`   · ${s}`);
const usd = (n: bigint) => (Number(n) / 1e6).toFixed(2);

function expect(cond: boolean, what: string) {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`   ✓ ${what}`);
}
const balanceOf = (a: `0x${string}`) => pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
async function send(address: `0x${string}`, abi: typeof Erc20Abi | typeof TickAbi | typeof TickSportsAbi, fn: string, args: unknown[]) {
  const hash = await wallet.writeContract({ address, abi, functionName: fn, args, gas: 280_000n } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${fn} reverted`);
}

async function main() {
  console.log("1. Address checks");
  const good = recipient;
  const lower = good.toLowerCase();
  // Flip the case of one letter in a checksummed address: valid hex, broken checksum.
  const idx = good.slice(2).search(/[a-fA-F]/) + 2;
  const swapped = good.slice(0, idx) + (good[idx] === good[idx].toUpperCase() ? good[idx].toLowerCase() : good[idx].toUpperCase()) + good.slice(idx + 1);
  const cases: [string, string, boolean][] = [
    ["empty", "", true],
    ["not hex", "hello", true],
    ["too short", "0x1234", true],
    ["bad checksum", swapped, true],
    ["zero address", "0x0000000000000000000000000000000000000000", true],
    ["this wallet", account, true],
    ["the USDC contract", CONTRACTS.usdc, true],
    ["the Tick contract", CONTRACTS.tick, true],
    ["the sports contract", CONTRACTS.tickSports, true],
    ["the gas station", CONTRACTS.gasStation, true],
    ["a checksummed wallet", good, false],
    ["a lowercase wallet", lower, false],
  ];
  for (const [name, addr, bad] of cases) {
    const p = recipientProblem(addr, account);
    expect(bad ? p !== null : p === null, `${name} is ${bad ? "rejected" : "accepted"}`);
  }

  console.log("\n2. Park 2.00 USDC in both contracts");
  await ensureFunded(account, 400_000_000_000_000_000n, 2_000_000n);
  await send(CONTRACTS.usdc, Erc20Abi, "approve", [CONTRACTS.tick, 2n ** 255n]);
  await send(CONTRACTS.usdc, Erc20Abi, "approve", [CONTRACTS.tickSports, 2n ** 255n]);
  await send(CONTRACTS.tick, TickAbi, "deposit", [1_000_000n]);
  await send(CONTRACTS.tickSports, TickSportsAbi, "deposit", [700_000n]);
  let f = await readFunds(account);
  console.log(`   wallet ${usd(f.wallet)} · price ${usd(f.tick)} · sports ${usd(f.sports)} · total ${usd(f.total)}`);
  expect(f.wallet === 300_000n && f.tick === 1_000_000n && f.sports === 700_000n, "split 0.30 / 1.00 / 0.70");

  const before = await balanceOf(recipient);

  console.log("\n3. Send 0.50: the wallet's 0.30 is short, so 0.20 is pulled from sports");
  let r = await sendUsdc(wallet, account, recipient, 500_000n, step);
  console.log(`   ${r.message}`);
  expect(r.ok && !!r.hash, "sent, with a transaction hash");
  f = await readFunds(account);
  expect(f.total === 1_500_000n, "balance fell by exactly 0.50");
  expect(f.sports === 500_000n && f.tick === 1_000_000n && f.wallet === 0n, "only the sports balance was touched");
  expect((await balanceOf(recipient)) - before === 500_000n, "the recipient received exactly 0.50");

  console.log("\n4. Send 1.20: needs both contracts");
  r = await sendUsdc(wallet, account, recipient, 1_200_000n, step);
  console.log(`   ${r.message}`);
  expect(r.ok, "sent");
  f = await readFunds(account);
  expect(f.total === 300_000n, "0.30 left");
  expect((await balanceOf(recipient)) - before === 1_700_000n, "the recipient has received 1.70 in all");

  console.log("\n5. Refusals");
  r = await sendUsdc(wallet, account, recipient, 5_000_000n, step);
  console.log(`   ${r.message}`);
  expect(!r.ok && /0\.30/.test(r.message), "more than the balance is refused, naming the balance");
  r = await sendUsdc(wallet, account, CONTRACTS.usdc, 100_000n, step);
  expect(!r.ok, "sending to the USDC contract is refused");
  f = await readFunds(account);
  expect(f.total === 300_000n, "refusals moved no money");

  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(String(e).split("\n").slice(0, 3).join("\n"));
  process.exit(1);
});
