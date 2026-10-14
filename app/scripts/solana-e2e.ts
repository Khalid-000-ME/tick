/**
 * The Solana market, end to end on devnet, through the same client the app uses.
 *
 * Two traders take opposite sides of a live window using the sponsored Pyth feed, the window closes,
 * an outsider settles it, and both claim. Every signature here is a real devnet transaction, and the
 * instructions are built by lib/solana/program.ts, so this proves the client the UI depends on.
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import {
  SOLANA, RULES, stakeIx, settleIx, claimIx, readMarket, readPosition, readPrice, marketPda, type Terms,
} from "../lib/solana/program.js";

const BTC = Uint8Array.from(Buffer.from("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", "hex"));
const c = new Connection(SOLANA.rpc, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const ok = (label: string, got: unknown, want: unknown) => {
  const pass = String(got) === String(want);
  if (!pass) failed = true;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${label}: ${got}${pass ? "" : ` (expected ${want})`}`);
};

async function send(label: string, who: Keypair, ix: Parameters<Transaction["add"]>[0]) {
  const sig = await sendAndConfirmTransaction(c, new Transaction().add(ix), [who], { commitment: "confirmed" });
  console.log(`  ${label.padEnd(18)} ${sig}`);
  return sig;
}

(async () => {
  console.log(`program ${SOLANA.programId.toBase58()}`);
  console.log(`mint    ${SOLANA.mint.toBase58()}\n`);

  // Two traders, funded with SOL for fees and with the stake token.
  const alice = Keypair.generate(), bob = Keypair.generate(), settler = Keypair.generate();
  // Funded from the payer rather than the faucet, which is rate limited per IP.
  const fund = new Transaction();
  for (const k of [alice, bob, settler]) {
    fund.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 40_000_000 }));
  }
  await sendAndConfirmTransaction(c, fund, [payer], { commitment: "confirmed" });
  for (const k of [alice, bob, settler]) {
    const ata = await getOrCreateAssociatedTokenAccount(c, payer, SOLANA.mint, k.publicKey);
    await mintTo(c, payer, SOLANA.mint, ata.address, payer, 10_000_000n);
  }
  console.log("traders funded\n");

  // A window far enough ahead that both stakes land before it closes.
  const price = await readPrice(c, BTC);
  if (!price) throw new Error("no sponsored price account for BTC/USD");
  console.log(`BTC/USD ${(Number(price.price) * 10 ** price.expo).toFixed(2)}, published ${Math.floor(Date.now() / 1000) - price.publishTime}s ago, full=${price.full}`);

  const now = Math.floor(Date.now() / 1000);
  const closesAt = BigInt(Math.ceil((now + 20) / RULES.windowSeconds) * RULES.windowSeconds);
  const terms: Terms = { feedId: BTC, strike: price.price, expo: price.expo, closesAt };
  console.log(`market  ${marketPda(terms).toBase58()}`);
  console.log(`window  closes at ${new Date(Number(closesAt) * 1000).toISOString().slice(11, 19)}\n`);

  await send("alice ABOVE 1.00", alice, stakeIx(alice.publicKey, terms, true, 1_000_000n));
  await send("bob BELOW 3.00", bob, stakeIx(bob.publicKey, terms, false, 3_000_000n));

  let m = (await readMarket(c, terms))!;
  ok("pool above", usdc(m.poolAbove), "1.00");
  ok("pool below", usdc(m.poolBelow), "3.00");

  const wait = Number(closesAt) * 1000 - Date.now() + 2000;
  if (wait > 0) { console.log(`\nwaiting ${Math.ceil(wait / 1000)}s for the window to close`); await sleep(wait); }

  const before = (await getAccount(c, (await getOrCreateAssociatedTokenAccount(c, payer, SOLANA.mint, settler.publicKey)).address)).amount;
  await send("settle", settler, settleIx(settler.publicKey, terms));
  const after = (await getAccount(c, (await getOrCreateAssociatedTokenAccount(c, payer, SOLANA.mint, settler.publicKey)).address)).amount;

  m = (await readMarket(c, terms))!;
  console.log(`\nsettled at ${(Number(m.settlePrice) * 10 ** price.expo).toFixed(2)}, above won: ${m.aboveWon}, void: ${m.void}`);
  const losing = m.aboveWon ? m.poolBelow : m.poolAbove;
  const fee = (losing * 200n) / 10_000n;
  const bounty = fee / 2n > 2_000_000n ? 2_000_000n : fee / 2n;
  ok("fee taken", usdc(m.fee), usdc(fee));
  ok("settler bounty", usdc(after - before), usdc(bounty));

  // Both claim. The loser's claim is accepted and pays nothing, which is the contract's behaviour.
  for (const [name, who, side] of [["alice", alice, true], ["bob", bob, false]] as const) {
    const ata = (await getOrCreateAssociatedTokenAccount(c, payer, SOLANA.mint, who.publicKey)).address;
    const b4 = (await getAccount(c, ata)).amount;
    await send(`${name} claim`, who, claimIx(who.publicKey, terms));
    const got = (await getAccount(c, ata)).amount - b4;
    const stake = side === m.aboveWon ? (side ? m.poolAbove : m.poolBelow) : 0n;
    const want = stake === 0n ? 0n : stake + (losing - fee);
    ok(`${name} payout`, usdc(got), usdc(want));
    const pos = await readPosition(c, terms, who.publicKey);
    ok(`${name} marked claimed`, pos?.claimed, true);
  }

  console.log(`\n${failed ? "FAILED" : "all checks passed"}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

