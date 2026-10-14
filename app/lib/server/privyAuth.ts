import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Proving that a request comes from a real, signed-in Privy user, on the server.
 *
 * Anything that hands out money cannot trust an address in a request body: anyone can post
 * a thousand made-up addresses. So the browser sends its Privy access token, and the server
 *   1. verifies the token's signature against Privy's published keys, its issuer and its
 *      audience (this app), which yields the user's id; and
 *   2. asks Privy which wallets that user owns, and only accepts one of those.
 * The user id is then the thing that can claim once, however many wallets they create.
 *
 * Nothing is ever accepted on a failure to check: every path here ends in a refusal.
 */
const API = "https://auth.privy.io";

let keys: JWTVerifyGetKey | null = null;
function remoteKeys(appId: string): JWTVerifyGetKey {
  keys ??= createRemoteJWKSet(new URL(`${API}/api/v1/apps/${appId}/jwks.json`));
  return keys;
}

/** The Privy user id (a did:privy:... string) behind a valid access token, or null. */
export async function verifyAccessToken(token: string, appId: string, getKey: JWTVerifyGetKey = remoteKeys(appId)): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getKey, { issuer: "privy.io", audience: appId });
    return typeof payload.sub === "string" && payload.sub.startsWith("did:privy:") ? payload.sub : null;
  } catch {
    return null;
  }
}

interface LinkedAccount {
  type?: string;
  address?: string;
  chain_type?: string;
}

/**
 * Pure, so it can be tested: is this address one of the user's own wallets?
 *
 * The comparison is case-insensitive for Ethereum, where an address is hex and case only carries a
 * checksum, and exact for Solana, where the address is base58 and case is part of the value.
 */
export function ownsWallet(accounts: LinkedAccount[], address: string, chain: "ethereum" | "solana" = "ethereum"): boolean {
  const same = chain === "solana"
    ? (a?: string) => a === address
    : (a?: string) => a?.toLowerCase() === address.toLowerCase();
  return accounts.some((a) => a.type === "wallet" && (a.chain_type ?? "ethereum") === chain && same(a.address));
}

/** The user's linked accounts, from Privy's API with the app secret. Null when Privy cannot say. */
export async function linkedAccountsOf(did: string, appId: string, secret: string): Promise<LinkedAccount[] | null> {
  try {
    const res = await fetch(`${API}/api/v1/users/${encodeURIComponent(did)}`, {
      headers: { "privy-app-id": appId, Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { linked_accounts?: LinkedAccount[] };
    return Array.isArray(body.linked_accounts) ? body.linked_accounts : null;
  } catch {
    return null;
  }
}
