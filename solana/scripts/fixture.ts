/**
 * The window and the two price accounts the local test runs against.
 *
 * Run as a script it writes the account files for the validator; imported it hands the same values
 * to the test, so both sides agree on the feed, the strike and the second the window closes.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { priceUpdateData, accountJson } from "./pythaccount";

/** Pyth's BTC/USD feed id, the same one the EVM app uses. */
export const FEED_ID = Buffer.from(
  "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "hex",
);
export const EXPO = -8;

/** $81,000.00000000 at stake time, $81,500.00000000 at the close: ABOVE wins. */
const PRICE_WHEN_STAKED = 8_100_000_000_000n;
const PRICE_WHEN_CLOSED = 8_150_000_000_000n;
/** The strike sits at the price when the window opened, as `/api/strike` serves it. */
export const STRIKE = PRICE_WHEN_STAKED;

const STATE = `${__dirname}/../.localnet.json`;

function load() {
  if (!existsSync(STATE)) throw new Error("run scripts/fixture.ts first (localnet.sh does)");
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  return {
    closesAt: BigInt(s.closesAt),
    stake: new PublicKey(s.stake),
    close: new PublicKey(s.close),
  };
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: fixture.ts <dir>");

  // Far enough ahead that the validator is up and both stakes land before the window closes.
  const closesAt = BigInt(Math.floor(Date.now() / 1000) + 45);
  const stake = Keypair.generate().publicKey;
  const close = Keypair.generate().publicKey;

  // Fresh now, so the stake passes the 10-second cutoff.
  const stakeData = priceUpdateData({
    feedId: FEED_ID, price: PRICE_WHEN_STAKED, expo: EXPO,
    publishTime: BigInt(Math.floor(Date.now() / 1000)),
  });
  // Published at the close, which is what settlement demands.
  const closeData = priceUpdateData({
    feedId: FEED_ID, price: PRICE_WHEN_CLOSED, expo: EXPO, publishTime: closesAt,
  });

  writeFileSync(`${out}/stake.json`, JSON.stringify(accountJson(stake, stakeData)));
  writeFileSync(`${out}/close.json`, JSON.stringify(accountJson(close, closeData)));
  writeFileSync(`${out}/stake.pubkey`, stake.toBase58());
  writeFileSync(`${out}/close.pubkey`, close.toBase58());
  writeFileSync(STATE, JSON.stringify({
    closesAt: closesAt.toString(), stake: stake.toBase58(), close: close.toBase58(),
  }));
  console.log(`window closes at ${closesAt} (in 45s)`);
}

const state = require.main === module ? null : load();
export const CLOSES_AT = state ? state.closesAt : 0n;
export const PRICE_AT_STAKE = state ? state.stake : PublicKey.default;
export const PRICE_AT_CLOSE = state ? state.close : PublicKey.default;
