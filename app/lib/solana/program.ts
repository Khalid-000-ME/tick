/**
 * Talking to the Tick program on Solana, without Anchor's client.
 *
 * Anchor's TypeScript client drags in a provider, a wallet adapter and its own version of web3.js,
 * none of which fit an app that already has a wallet and already knows how to sign. What it does is
 * small enough to do directly: an instruction is an 8-byte discriminator, sha256("global:<name>"),
 * followed by its arguments in Borsh, and every account it touches is a PDA we can derive.
 *
 * The rules here mirror `solana/programs/tick/src/lib.rs` exactly. Anything that disagrees with the
 * program is a bug in this file.
 */
import {
  Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2";

export const SOLANA = {
  cluster: "devnet" as const,
  rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com",
  programId: new PublicKey("5adXZ1k5eYzyzsnAEkHsEjTfQdg1QMv53H9Ltjj9vV2v"),
  /** Pyth's receiver, which owns every price update account we read. */
  pythReceiver: new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"),
  /** The push oracle that maintains the sponsored feed accounts on devnet. */
  pythPushOracle: new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"),
  /** Our devnet stake token. Six decimals, like the USDC the EVM side uses. */
  mint: new PublicKey(process.env.NEXT_PUBLIC_SOLANA_MINT || "BwfDBd4SJyBsstSRNp2b9EZZ1gATb1qrywiDNKDNL7jA"),
  explorer: (kind: "tx" | "address", id: string) =>
    `https://explorer.solana.com/${kind}/${id}?cluster=devnet`,
};

/** The program's own constants, repeated here so the UI can show them without a round trip. */
export const RULES = {
  windowSeconds: 30,
  minStakeUnits: 100_000n,          // 0.10
  feeBps: 200n,                     // 2% of profit
  acceptMarginSeconds: 10,          // a stake is refused on a price older than this
  settleToleranceSeconds: 20,
  settleWindowSeconds: 600,
};

const discriminator = (name: string) => Buffer.from(sha256(`global:${name}`).slice(0, 8));

const i64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };

export interface Terms {
  feedId: Uint8Array;   // 32 bytes, the Pyth feed id
  strike: bigint;       // in the feed's own exponent
  expo: number;
  closesAt: bigint;     // unix seconds
}

/** `(feedId, strike, closesAt)` names the market, so there is no create-market instruction. */
export function marketPda(t: Terms) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(t.feedId), i64(t.strike), i64(t.closesAt)],
    SOLANA.programId,
  )[0];
}

export const vaultPda = (market: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], SOLANA.programId)[0];

/** One account per trader per market: this is what lets the close-of-window burst run in parallel. */
export const positionPda = (market: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    SOLANA.programId,
  )[0];

/** The sponsored price account the push oracle keeps updated for a feed. */
export function priceAccount(feedId: Uint8Array, shard = 0) {
  const s = Buffer.alloc(2); s.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([s, Buffer.from(feedId)], SOLANA.pythPushOracle)[0];
}

export const tokenAccount = (owner: PublicKey) =>
  getAssociatedTokenAddressSync(SOLANA.mint, owner, true);

const termsBytes = (t: Terms) =>
  Buffer.concat([Buffer.from(t.feedId), i64(t.strike), i32(t.expo), i64(t.closesAt)]);

export function stakeIx(staker: PublicKey, t: Terms, above: boolean, amount: bigint) {
  const market = marketPda(t);
  return new TransactionInstruction({
    programId: SOLANA.programId,
    keys: [
      { pubkey: staker, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vaultPda(market), isSigner: false, isWritable: true },
      { pubkey: positionPda(market, staker), isSigner: false, isWritable: true },
      { pubkey: tokenAccount(staker), isSigner: false, isWritable: true },
      { pubkey: SOLANA.mint, isSigner: false, isWritable: false },
      { pubkey: priceAccount(t.feedId), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      discriminator("stake"), termsBytes(t), Buffer.from([above ? 1 : 0]), u64(amount),
    ]),
  });
}

export function settleIx(settler: PublicKey, t: Terms) {
  const market = marketPda(t);
  return new TransactionInstruction({
    programId: SOLANA.programId,
    keys: [
      { pubkey: settler, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vaultPda(market), isSigner: false, isWritable: true },
      { pubkey: tokenAccount(settler), isSigner: false, isWritable: true },
      { pubkey: priceAccount(t.feedId), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator("settle"),
  });
}

export function claimIx(owner: PublicKey, t: Terms) {
  const market = marketPda(t);
  return new TransactionInstruction({
    programId: SOLANA.programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: vaultPda(market), isSigner: false, isWritable: true },
      { pubkey: positionPda(market, owner), isSigner: false, isWritable: true },
      { pubkey: tokenAccount(owner), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator("claim"),
  });
}

/* ------------------------------------------------------------------ reads */

export interface MarketState {
  poolAbove: bigint;
  poolBelow: bigint;
  fee: bigint;
  settlePrice: bigint;
  settled: boolean;
  aboveWon: boolean;
  void: boolean;
}

/** Decodes the `Market` account: 8-byte discriminator, then the struct in declaration order. */
export function decodeMarket(data: Buffer): MarketState {
  let o = 8 + 32 + 8 + 4 + 8 + 32;        // skip feed_id, strike, expo, closes_at, mint
  const poolAbove = data.readBigUInt64LE(o); o += 8;
  const poolBelow = data.readBigUInt64LE(o); o += 8;
  const fee = data.readBigUInt64LE(o); o += 8;
  const settlePrice = data.readBigInt64LE(o); o += 8;
  return {
    poolAbove, poolBelow, fee, settlePrice,
    settled: data.readUInt8(o) === 1,
    aboveWon: data.readUInt8(o + 1) === 1,
    void: data.readUInt8(o + 2) === 1,
  };
}

export interface PositionState { above: bigint; below: bigint; claimed: boolean; }

export function decodePosition(data: Buffer): PositionState {
  const o = 8 + 32 + 32;                   // skip market, owner
  return {
    above: data.readBigUInt64LE(o),
    below: data.readBigUInt64LE(o + 8),
    claimed: data.readUInt8(o + 16) === 1,
  };
}

/** What a side pays right now, by the same arithmetic the program uses on settlement. */
export function payout(m: MarketState, above: boolean, stake: bigint): bigint {
  const winning = above ? m.poolAbove : m.poolBelow;
  const losing = above ? m.poolBelow : m.poolAbove;
  if (stake === 0n || winning === 0n) return 0n;
  const fee = (losing * RULES.feeBps) / 10_000n;
  return stake + ((losing - fee) * stake) / winning;
}

export async function readMarket(c: Connection, t: Terms): Promise<MarketState | null> {
  const info = await c.getAccountInfo(marketPda(t));
  return info ? decodeMarket(Buffer.from(info.data)) : null;
}

export async function readPosition(c: Connection, t: Terms, owner: PublicKey): Promise<PositionState | null> {
  const info = await c.getAccountInfo(positionPda(marketPda(t), owner));
  return info ? decodePosition(Buffer.from(info.data)) : null;
}

/** Reads the live price straight out of the sponsored feed account, the same one the program reads. */
export async function readPrice(c: Connection, feedId: Uint8Array) {
  const info = await c.getAccountInfo(priceAccount(feedId));
  if (!info) return null;
  const d = Buffer.from(info.data);
  const verification = d.readUInt8(40);                 // 0 = Partial{n}, 1 = Full
  const o = 40 + (verification === 1 ? 1 : 2);
  return {
    price: d.readBigInt64LE(o + 32),
    expo: d.readInt32LE(o + 48),
    publishTime: Number(d.readBigInt64LE(o + 52)),
    full: verification === 1,
  };
}

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID };
