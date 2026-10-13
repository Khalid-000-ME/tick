/**
 * The whole market, end to end, against a local validator.
 *
 * Two traders take opposite sides of one window, an outsider settles it with a Pyth update, and
 * everyone claims. What is checked is the money: the settler's bounty, each trader's payout, and
 * that the vault is empty afterwards apart from the fee the house keeps.
 *
 * Run `scripts/localnet.sh`, which starts the validator with the price accounts preloaded and then
 * runs this.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { PRICE_AT_STAKE, PRICE_AT_CLOSE, FEED_ID, CLOSES_AT, STRIKE, EXPO } from "./fixture";

const USDC = 1_000_000;
const ok = (label: string, got: unknown, want: unknown) => {
  const pass = String(got) === String(want);
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}: ${got}${pass ? "" : ` (expected ${want})`}`);
  if (!pass) process.exitCode = 1;
};

async function airdrop(c: Connection, to: PublicKey, sol: number) {
  await c.confirmTransaction(await c.requestAirdrop(to, sol * LAMPORTS_PER_SOL), "confirmed");
}

(async () => {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const idl = JSON.parse(readFileSync(`${__dirname}/../idl/tick.json`, "utf8"));
  const programId = new PublicKey(idl.address);

  const payer = Keypair.generate();
  const alice = Keypair.generate();  // calls ABOVE, and wins
  const bob = Keypair.generate();    // calls BELOW, and loses
  const settler = Keypair.generate();
  for (const k of [payer, alice, bob, settler]) await airdrop(connection, k.publicKey, 5);

  // A stand-in for Circle USDC: same six decimals.
  const mint = await createMint(connection, payer, payer.publicKey, null, 6);
  const accounts: Record<string, PublicKey> = {};
  for (const [name, who] of [["alice", alice], ["bob", bob], ["settler", settler]] as const) {
    const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, who.publicKey);
    accounts[name] = ata.address;
    await mintTo(connection, payer, mint, ata.address, payer, 100 * USDC);
  }

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

  const terms = {
    feedId: Array.from(FEED_ID),
    strike: new anchor.BN(STRIKE.toString()),
    expo: EXPO,
    closesAt: new anchor.BN(CLOSES_AT.toString()),
  };
  const [market] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      FEED_ID,
      Buffer.from(new anchor.BN(STRIKE.toString()).toTwos(64).toArrayLike(Buffer, "le", 8)),
      Buffer.from(new anchor.BN(CLOSES_AT.toString()).toTwos(64).toArrayLike(Buffer, "le", 8)),
    ],
    programId,
  );
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId);
  const position = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), owner.toBuffer()], programId)[0];

  console.log(`market ${market.toBase58()}`);

  // --- stake -------------------------------------------------------------------------------
  const stake = async (who: Keypair, ata: PublicKey, above: boolean, amount: number) =>
    program.methods
      .stake(terms, above, new anchor.BN(amount))
      .accounts({
        staker: who.publicKey,
        market,
        vault,
        position: position(who.publicKey),
        stakerTokens: ata,
        mint,
        priceUpdate: PRICE_AT_STAKE,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([who])
      .rpc();

  await stake(alice, accounts.alice, true, 10 * USDC);
  await stake(bob, accounts.bob, false, 30 * USDC);

  let m: any = await (program.account as any).market.fetch(market);
  ok("pool above", m.poolAbove.toString(), 10 * USDC);
  ok("pool below", m.poolBelow.toString(), 30 * USDC);
  ok("vault holds both stakes", (await getAccount(connection, vault)).amount.toString(), 40 * USDC);

  // --- settle ------------------------------------------------------------------------------
  const waitFor = Number(CLOSES_AT) * 1000 - Date.now();
  if (waitFor > 0) {
    console.log(`waiting ${Math.ceil(waitFor / 1000)}s for the window to close`);
    await new Promise((r) => setTimeout(r, waitFor + 1500));
  }

  const settlerBefore = (await getAccount(connection, accounts.settler)).amount;
  await program.methods
    .settle()
    .accounts({
      settler: settler.publicKey,
      market,
      vault,
      settlerTokens: accounts.settler,
      priceUpdate: PRICE_AT_CLOSE,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([settler])
    .rpc();

  m = await (program.account as any).market.fetch(market);
  // Above won: the close price is over the strike. The fee is 2% of the losing 30 USDC, and the
  // settler takes half of that, under the 2 USDC cap.
  const fee = (30 * USDC * 200) / 10_000;        // 0.60 USDC
  const bounty = Math.min(fee / 2, 2 * USDC);    // 0.30 USDC
  ok("above won", m.aboveWon, true);
  ok("not void", m.void, false);
  ok("fee taken", m.fee.toString(), fee);
  const settlerAfter = (await getAccount(connection, accounts.settler)).amount;
  ok("settler bounty", (settlerAfter - settlerBefore).toString(), bounty);

  // --- claim -------------------------------------------------------------------------------
  const claim = async (who: Keypair, ata: PublicKey) =>
    program.methods
      .claim()
      .accounts({
        owner: who.publicKey,
        market,
        vault,
        position: position(who.publicKey),
        winnerTokens: ata,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([who])
      .rpc();

  const aliceBefore = (await getAccount(connection, accounts.alice)).amount;
  await claim(alice, accounts.alice);
  const aliceAfter = (await getAccount(connection, accounts.alice)).amount;
  // Stake back, plus the whole losing pool less the fee, because Alice is the only winner.
  ok("alice payout", (aliceAfter - aliceBefore).toString(), 10 * USDC + (30 * USDC - fee));

  const bobBefore = (await getAccount(connection, accounts.bob)).amount;
  await claim(bob, accounts.bob);
  ok("bob paid nothing", ((await getAccount(connection, accounts.bob)).amount - bobBefore).toString(), 0);

  // Everything is out except the house's half of the fee.
  ok("vault left with the house fee", (await getAccount(connection, vault)).amount.toString(), fee - bounty);

  let threw = "";
  try { await claim(alice, accounts.alice); } catch (e: any) { threw = e.error?.errorCode?.code ?? "threw"; }
  ok("second claim refused", threw, "AlreadyClaimed");

  console.log(process.exitCode ? "\nFAILED" : "\nall checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
