/**
 * The path the UI takes on Solana: stake both sides, then settle through /api/solana/settle, the
 * same route the terminal calls. Proves the route and the client agree with the program.
 */
import { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { SOLANA, stakeIx, readPrice, readMarket, marketPda, type Terms } from "../lib/solana/program.js";

const APP = process.env.DEMO_APP ?? "http://localhost:3000";
const BTC = Uint8Array.from(Buffer.from("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", "hex"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c = new Connection(SOLANA.rpc, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
  const a = Keypair.generate(), b = Keypair.generate();

  const fund = new Transaction();
  for (const k of [a, b]) fund.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 30_000_000 }));
  await sendAndConfirmTransaction(c, fund, [payer], { commitment: "confirmed" });
  for (const k of [a, b]) {
    const t = await getOrCreateAssociatedTokenAccount(c, payer, SOLANA.mint, k.publicKey);
    await mintTo(c, payer, SOLANA.mint, t.address, payer, 5_000_000n);
  }

  // The program refuses a price older than ten seconds, so wait for a fresh publish rather than
  // staking against whatever happened to be there when the script started.
  let price = await readPrice(c, BTC);
  for (let i = 0; i < 20 && price && Math.floor(Date.now() / 1000) - price.publishTime > 2; i++) {
    await sleep(700);
    price = await readPrice(c, BTC);
  }
  if (!price) throw new Error("no price account");
  console.log(`price ${(Number(price.price) * 10 ** price.expo).toFixed(2)}, ${Math.floor(Date.now() / 1000) - price.publishTime}s old`);
  const closesAt = BigInt(Math.ceil((Math.floor(Date.now() / 1000) + 18) / 30) * 30);
  const terms: Terms = { feedId: BTC, strike: price.price, expo: price.expo, closesAt };

  await sendAndConfirmTransaction(c, new Transaction().add(stakeIx(a.publicKey, terms, true, 1_000_000n)), [a], { commitment: "confirmed" });
  await sendAndConfirmTransaction(c, new Transaction().add(stakeIx(b.publicKey, terms, false, 2_000_000n)), [b], { commitment: "confirmed" });
  console.log(`staked both sides on ${marketPda(terms).toBase58()}`);

  const body = { feedId: Buffer.from(BTC).toString("hex"), strike: price.price.toString(), expo: price.expo, closesAt: Number(closesAt) };

  // Too early: the route should stand down and leave the bounty to an outside settler.
  const early = await (await fetch(`${APP}/api/solana/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  console.log(`before close: ${JSON.stringify(early).slice(0, 80)}`);

  const wait = Number(closesAt) * 1000 - Date.now() + 13_000;
  console.log(`waiting ${Math.ceil(wait / 1000)}s for the window and the grace period`);
  await sleep(wait);

  const res = await (await fetch(`${APP}/api/solana/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  console.log(`settle route: ${JSON.stringify(res).slice(0, 140)}`);

  const m = await readMarket(c, terms);
  console.log(`settled=${m?.settled} aboveWon=${m?.aboveWon} void=${m?.void} fee=${Number(m?.fee ?? 0) / 1e6}`);
  if (!m?.settled) process.exit(1);
  console.log("\nthe UI settle path works");
}
main().catch((e) => { console.error(e); process.exit(1); });
