/**
 * The checks that stand between the welcome gift and a drained faucet. Tokens are signed
 * with a key generated here and verified through a local key set, so what is under test is
 * exactly lib/server/privyAuth's rules (signature, issuer, audience, expiry, user id), not
 * Privy's network.
 *
 *   npx tsx scripts/welcome-test.ts
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type KeyLike } from "jose";
import { ownsWallet, verifyAccessToken } from "../lib/server/privyAuth.js";

const APP = "app_test_123";
let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗ FAILED"} ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

async function main() {
  const real = await generateKeyPair("ES256");
  const forger = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(real.publicKey)), alg: "ES256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (key: KeyLike | Uint8Array, claims: { iss?: string; aud?: string; sub?: string; exp?: string | number }) =>
    new SignJWT({}).setProtectedHeader({ alg: "ES256" }).setIssuer(claims.iss ?? "privy.io").setAudience(claims.aud ?? APP).setSubject(claims.sub ?? "did:privy:abc123").setIssuedAt().setExpirationTime(claims.exp ?? "1h").sign(key);

  console.log("access token");
  eq("a genuine token yields the user id", await verifyAccessToken(await sign(real.privateKey, {}), APP, keys), "did:privy:abc123");
  eq("signed by someone else: refused", await verifyAccessToken(await sign(forger.privateKey, {}), APP, keys), null);
  eq("meant for another app: refused", await verifyAccessToken(await sign(real.privateKey, { aud: "app_other" }), APP, keys), null);
  eq("from another issuer: refused", await verifyAccessToken(await sign(real.privateKey, { iss: "evil.example" }), APP, keys), null);
  eq("expired: refused", await verifyAccessToken(await sign(real.privateKey, { exp: Math.floor(Date.now() / 1000) - 60 }), APP, keys), null);
  eq("a subject that is not a Privy user id: refused", await verifyAccessToken(await sign(real.privateKey, { sub: "someone" }), APP, keys), null);
  eq("garbage: refused", await verifyAccessToken("not.a.token", APP, keys), null);
  eq("empty: refused", await verifyAccessToken("", APP, keys), null);

  console.log("\nwallet ownership");
  const mine = "0x8d4E3f2A9c1B7e5D6a0F4b3C2d1E9f8A7b6C0A72";
  const accounts = [{ type: "email", address: "a@b.co" }, { type: "wallet", address: mine, chain_type: "ethereum" }, { type: "wallet", address: "SoLaNaAddr", chain_type: "solana" }];
  eq("their own wallet is accepted", ownsWallet(accounts, mine), true);
  eq("matched without regard to case", ownsWallet(accounts, mine.toLowerCase()), true);
  eq("someone else's wallet is refused", ownsWallet(accounts, "0x0000000000000000000000000000000000000001"), false);
  eq("an email is not a wallet", ownsWallet(accounts, "a@b.co"), false);
  eq("a Solana wallet does not count", ownsWallet(accounts, "SoLaNaAddr"), false);
  eq("no linked accounts: refused", ownsWallet([], mine), false);

  console.log(failed ? `\n${failed} FAILED` : "\nAll passed.");
  process.exit(failed ? 1 : 0);
}
main();
