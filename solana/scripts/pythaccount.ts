/**
 * Build a Pyth `PriceUpdateV2` account the local validator can preload.
 *
 * The real thing is written by the Pyth receiver program once it has checked the guardian
 * signatures. A local validator has no such update to clone with a publish time in the present, so
 * the bytes are written here and loaded with `--account`, owned by the receiver program id. The
 * layout is the one `programs/tick/src/pyth.rs` reads, and nothing in the program treats this
 * account differently from a real one: it is read for its owner, discriminator, verification level
 * and feed id exactly the same way.
 */
import { PublicKey } from "@solana/web3.js";

export const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const DISCRIMINATOR = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

export function priceUpdateData(opts: {
  feedId: Buffer;
  price: bigint;
  expo: number;
  publishTime: bigint;
  conf?: bigint;
  slot?: bigint;
}): Buffer {
  const { feedId, price, expo, publishTime, conf = 1n, slot = 1n } = opts;
  if (feedId.length !== 32) throw new Error("feed id must be 32 bytes");

  const b = Buffer.alloc(8 + 32 + 1 + 84 + 8);
  let o = 0;
  DISCRIMINATOR.copy(b, o); o += 8;
  PublicKey.default.toBuffer().copy(b, o); o += 32; // write_authority
  b.writeUInt8(1, o); o += 1;                       // VerificationLevel::Full
  feedId.copy(b, o); o += 32;
  b.writeBigInt64LE(price, o); o += 8;
  b.writeBigUInt64LE(conf, o); o += 8;
  b.writeInt32LE(expo, o); o += 4;
  b.writeBigInt64LE(publishTime, o); o += 8;
  b.writeBigInt64LE(publishTime - 1n, o); o += 8;   // prev_publish_time
  b.writeBigInt64LE(price, o); o += 8;              // ema_price
  b.writeBigUInt64LE(conf, o); o += 8;              // ema_conf
  b.writeBigUInt64LE(slot, o); o += 8;
  return b;
}

/** The JSON shape `solana-test-validator --account <pubkey> <file>` expects. */
export function accountJson(pubkey: PublicKey, data: Buffer, lamports = 10_000_000) {
  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports,
      data: [data.toString("base64"), "base64"],
      owner: PYTH_RECEIVER.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
}
