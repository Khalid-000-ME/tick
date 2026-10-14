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

/**
 * Feeds nobody is keeping alive on devnet, so we post the price ourselves before staking.
 *
 * BTC/USD's sponsored account has been frozen at one price for twenty minutes while ETH and SOL
 * update every few seconds. This is a devnet fact, not a property of the feed, so it is a list to
 * revisit rather than a permanent design.
 */
export const SELF_POSTED_FEEDS = new Set([
  "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", // BTC/USD
]);

export const needsOwnPrice = (feedIdHex: string) => SELF_POSTED_FEEDS.has(feedIdHex.replace(/^0x/, "").toLowerCase());

/** The program's own constants, repeated here so the UI can show them without a round trip. */
export const RULES = {
  windowSeconds: 30,
  minStakeUnits: 100_000n,          // 0.10
  feeBps: 200n,                     // 2% of profit
  acceptMarginSeconds: 10,          // a stake is refused on a price older than this
  settleToleranceSeconds: 20,
  settleWindowSeconds: 600,
};

/**
 * Byte helpers written against Uint8Array and DataView rather than Node's Buffer.
 *
 * The browser's Buffer polyfill has no readBigInt64LE, and an account's `data` arrives as a plain
 * Uint8Array anyway, so anything built on Buffer works in a script and throws in the app. DataView
 * behaves the same in both.
 */
const discriminator = (name: string) => sha256(`global:${name}`).slice(0, 8);

const bytes = (n: number, write: (v: DataView) => void) => {
  const b = new Uint8Array(n);
  write(new DataView(b.buffer));
  return b;
};
const i64 = (n: bigint) => bytes(8, (v) => v.setBigInt64(0, n, true));
const u64 = (n: bigint) => bytes(8, (v) => v.setBigUint64(0, n, true));
const i32 = (n: number) => bytes(4, (v) => v.setInt32(0, n, true));
const u16 = (n: number) => bytes(2, (v) => v.setUint16(0, n, true));

const text = (s: string) => new TextEncoder().encode(s);

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Raw bytes as a lowercase hex string, without 0x. */
export const toHex = (b: Uint8Array) => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");

/** A hex string, with or without 0x, as raw bytes. */
export const hexBytes = (hex: string) => {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export interface Terms {
  feedId: Uint8Array;   // 32 bytes, the Pyth feed id
  strike: bigint;       // in the feed's own exponent
  expo: number;
  closesAt: bigint;     // unix seconds
}

/** `(feedId, strike, closesAt)` names the market, so there is no create-market instruction. */
export function marketPda(t: Terms) {
  return PublicKey.findProgramAddressSync(
    [text("market"), t.feedId, i64(t.strike), i64(t.closesAt)],
    SOLANA.programId,
  )[0];
}

export const vaultPda = (market: PublicKey) =>
  PublicKey.findProgramAddressSync([text("vault"), market.toBuffer()], SOLANA.programId)[0];

/** One account per trader per market: this is what lets the close-of-window burst run in parallel. */
export const positionPda = (market: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [text("position"), market.toBuffer(), owner.toBuffer()],
    SOLANA.programId,
  )[0];

/** The sponsored price account the push oracle keeps updated for a feed. */
export function priceAccount(feedId: Uint8Array, shard = 0) {
  return PublicKey.findProgramAddressSync([u16(shard), feedId], SOLANA.pythPushOracle)[0];
}

export const tokenAccount = (owner: PublicKey) =>
  getAssociatedTokenAddressSync(SOLANA.mint, owner, true);

const termsBytes = (t: Terms) =>
  concat(t.feedId, i64(t.strike), i32(t.expo), i64(t.closesAt));

/**
 * `priceUpdate` overrides which price account the program reads. The default is the sponsored feed
 * account, which is right whenever somebody is keeping that feed alive. Where nobody is, the caller
 * posts one through /api/solana/price and passes it here; the program checks it the same way either
 * way, so this changes who paid for the price, not whether it is trusted.
 */
export function stakeIx(staker: PublicKey, t: Terms, above: boolean, amount: bigint, priceUpdate?: PublicKey) {
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
      { pubkey: priceUpdate ?? priceAccount(t.feedId), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concat(
      discriminator("stake"), termsBytes(t), Uint8Array.of(above ? 1 : 0), u64(amount),
    )),
  });
}

export function settleIx(settler: PublicKey, t: Terms, priceUpdate?: PublicKey) {
  const market = marketPda(t);
  return new TransactionInstruction({
    programId: SOLANA.programId,
    keys: [
      { pubkey: settler, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vaultPda(market), isSigner: false, isWritable: true },
      { pubkey: tokenAccount(settler), isSigner: false, isWritable: true },
      { pubkey: priceUpdate ?? priceAccount(t.feedId), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(discriminator("settle")),
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
    data: Buffer.from(discriminator("claim")),
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
export function decodeMarket(data: Uint8Array): MarketState {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8 + 32 + 8 + 4 + 8 + 32;        // skip feed_id, strike, expo, closes_at, mint
  const poolAbove = v.getBigUint64(o, true); o += 8;
  const poolBelow = v.getBigUint64(o, true); o += 8;
  const fee = v.getBigUint64(o, true); o += 8;
  const settlePrice = v.getBigInt64(o, true); o += 8;
  return {
    poolAbove, poolBelow, fee, settlePrice,
    settled: v.getUint8(o) === 1,
    aboveWon: v.getUint8(o + 1) === 1,
    void: v.getUint8(o + 2) === 1,
  };
}

export interface PositionState { above: bigint; below: bigint; claimed: boolean; }

export function decodePosition(data: Uint8Array): PositionState {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const o = 8 + 32 + 32;                   // skip market, owner
  return {
    above: v.getBigUint64(o, true),
    below: v.getBigUint64(o + 8, true),
    claimed: v.getUint8(o + 16) === 1,
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
  return info ? decodeMarket(info.data) : null;
}

export async function readPosition(c: Connection, t: Terms, owner: PublicKey): Promise<PositionState | null> {
  const info = await c.getAccountInfo(positionPda(marketPda(t), owner));
  return info ? decodePosition(info.data) : null;
}

/** Reads the live price straight out of the sponsored feed account, the same one the program reads. */
export async function readPrice(c: Connection, feedId: Uint8Array) {
  const info = await c.getAccountInfo(priceAccount(feedId));
  if (!info) return null;
  const d = info.data;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const verification = v.getUint8(40);                  // 0 = Partial{n}, 1 = Full
  const o = 40 + (verification === 1 ? 1 : 2);
  return {
    price: v.getBigInt64(o + 32, true),
    expo: v.getInt32(o + 48, true),
    publishTime: Number(v.getBigInt64(o + 52, true)),
    full: verification === 1,
  };
}

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID };
