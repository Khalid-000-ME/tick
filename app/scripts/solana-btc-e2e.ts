/**
 * A BTC/USD stake on Solana against a price we posted ourselves.
 *
 * Devnet's sponsored BTC feed is frozen, so this is the path the app takes for it: ask
 * /api/solana/price to post a fresh update, then stake against that account. The program checks it
 * exactly as it checks a sponsored one, so the only thing that changed is who paid for the price.
 */
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { SOLANA, stakeIx, readMarket, marketPda, hexBytes, type Terms } from "../lib/solana/program.js";

const APP = process.env.DEMO_APP ?? "http://localhost:3000";
const BTC_HEX = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const BTC = hexBytes(BTC_HEX);

async function main() {
  const c = new Connection(SOLANA.rpc, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
  const alice = Keypair.generate(), bob = Keypair.generate();

  await sendAndConfirmTransaction(c, new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: alice.publicKey, lamports: 30_000_000 }))
    .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: bob.publicKey, lamports: 30_000_000 })),
    [payer], { commitment: "confirmed" });
  for (const k of [alice, bob]) {
    const t = await getOrCreateAssociatedTokenAccount(c, payer, SOLANA.mint, k.publicKey);
    await mintTo(c, payer, SOLANA.mint, t.address, payer, 5_000_000n);
  }

  // Post a price, the way the app does for feeds nobody maintains.
  const posted = await (await fetch(`${APP}/api/solana/price`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: BTC_HEX }),
  })).json();
  if (!posted.ok) throw new Error(`posting failed: ${posted.error}`);
  const priceUpdate = new PublicKey(posted.priceAccount);
  console.log(`posted price account ${posted.priceAccount}`);

  const info = await c.getAccountInfo(priceUpdate);
  const v = new DataView(info!.data.buffer, info!.data.byteOffset, info!.data.byteLength);
  const o = 40 + (v.getUint8(40) === 1 ? 1 : 2);
  const strike = v.getBigInt64(o + 32, true);
  const expo = v.getInt32(o + 48, true);
  console.log(`strike ${(Number(strike) * 10 ** expo).toFixed(2)}, ${Math.floor(Date.now() / 1000) - Number(v.getBigInt64(o + 52, true))}s old`);

  const closesAt = BigInt(Math.ceil((Math.floor(Date.now() / 1000) + 15) / 30) * 30);
  const terms: Terms = { feedId: BTC, strike, expo, closesAt };

  const s1 = await sendAndConfirmTransaction(c, new Transaction().add(stakeIx(alice.publicKey, terms, true, 1_000_000n, priceUpdate)), [alice], { commitment: "confirmed" });
  const s2 = await sendAndConfirmTransaction(c, new Transaction().add(stakeIx(bob.publicKey, terms, false, 2_000_000n, priceUpdate)), [bob], { commitment: "confirmed" });
  console.log(`alice ABOVE ${s1}`);
  console.log(`bob   BELOW ${s2}`);

  const m = await readMarket(c, terms);
  console.log(`market ${marketPda(terms).toBase58()}`);
  console.log(`pools  ${Number(m!.poolAbove) / 1e6} above / ${Number(m!.poolBelow) / 1e6} below`);
  console.log(Number(m!.poolAbove) === 1_000_000 && Number(m!.poolBelow) === 2_000_000
    ? "\nBTC on Solana works against a self-posted price"
    : "\nUNEXPECTED POOLS");
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
