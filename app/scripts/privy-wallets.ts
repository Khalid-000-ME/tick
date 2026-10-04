/**
 * Finds the embedded wallet addresses Privy created for your app, and tells you whether
 * each can actually pay gas.
 *
 *   npm run wallets                      # every user in the app
 *   npm run wallets -- you@example.com   # one user, looked up by email
 *
 * Needs, in app/.env.local:
 *   NEXT_PUBLIC_PRIVY_APP_ID   (already set — public, it is in the browser bundle)
 *   PRIVY_APP_SECRET           (NOT set yet — Dashboard > Configuration > App settings
 *                               > Basics > App secret. SERVER ONLY. Never prefix it
 *                               NEXT_PUBLIC_, and never commit it.)
 *
 * The REST API authenticates with HTTP Basic over `app_id:app_secret`, plus a
 * `privy-app-id` header. The wallet_id form in Privy's docs needs an id you do not have
 * yet, which is the chicken-and-egg this script exists to solve: it lists users and
 * reads the wallet off each one.
 */
import { formatEther } from "viem";
import { pub } from "./lib/chain.js";
import { loadEnv, requireEnv } from "./lib/env.js";

loadEnv();

const API = "https://api.privy.io/v1";

interface PrivyAccount {
  type: string;
  address?: string;
  wallet_client_type?: string;
  chain_type?: string;
  verified_at?: number;
}
interface PrivyUser {
  id: string;
  created_at?: number;
  linked_accounts?: PrivyAccount[];
}

function authHeaders() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? requireEnv("PRIVY_APP_ID");
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) {
    throw new Error(
      "PRIVY_APP_SECRET is not set.\n\n" +
        "  1. https://dashboard.privy.io -> your app -> Configuration -> App settings -> Basics\n" +
        "  2. Copy the App secret (it is shown once; regenerate if you have lost it)\n" +
        "  3. Add to app/.env.local, WITHOUT a NEXT_PUBLIC_ prefix:\n" +
        "       PRIVY_APP_SECRET=...\n\n" +
        "It is a server credential: anything with it can act on your app's users."
    );
  }
  return {
    Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
    "privy-app-id": appId,
    "Content-Type": "application/json",
  };
}

async function byEmail(email: string): Promise<PrivyUser[]> {
  const res = await fetch(`${API}/users/email/address`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ address: email }),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Privy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return [(await res.json()) as PrivyUser];
}

async function allUsers(): Promise<PrivyUser[]> {
  const res = await fetch(`${API}/users`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Privy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: PrivyUser[] } | PrivyUser[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

async function main() {
  const email = process.argv[2];
  const users = email ? await byEmail(email) : await allUsers();

  if (users.length === 0) {
    console.log(email ? `No Privy user with email ${email}.` : "No users in this Privy app yet.");
    console.log("Log in through the app once, then run this again.");
    return;
  }

  console.log(`\n${users.length} Privy user${users.length === 1 ? "" : "s"}\n`);

  for (const user of users) {
    const accounts = user.linked_accounts ?? [];
    const emails = accounts.filter((a) => a.type === "email").map((a) => a.address).filter(Boolean);
    const wallets = accounts.filter(
      (a) => a.type === "wallet" && a.chain_type !== "solana" && a.address
    );

    console.log(`user ${user.id}${emails.length ? `  ${emails.join(", ")}` : ""}`);

    if (wallets.length === 0) {
      console.log("  no EVM wallet linked yet\n");
      continue;
    }

    for (const w of wallets) {
      const address = w.address as `0x${string}`;
      const kind = w.wallet_client_type === "privy" ? "embedded" : (w.wallet_client_type ?? "external");
      let balance = "unknown";
      try {
        balance = `${Number(formatEther(await pub.getBalance({ address }))).toFixed(4)} MON`;
      } catch {
        /* RPC hiccup — the address is still the useful part */
      }
      const broke = balance.startsWith("0.0000");
      console.log(`  ${address}  ${kind.padEnd(9)} ${balance}${broke ? "   <- cannot pay gas" : ""}`);
    }
    console.log();
  }

  console.log("An embedded wallet starts with no MON and cannot send a transaction.");
  console.log("Fund one at https://faucet.monad.xyz, then stake from the app.\n");
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
