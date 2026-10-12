import { NextResponse } from "next/server";
import { createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Erc20Abi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";
import { linkedAccountsOf, ownsWallet, verifyAccessToken } from "@/lib/server/privyAuth";
import { forgetClaim, hasClaimed, recordClaim, usageToday } from "@/lib/server/welcomeStore";

/**
 * Two testnet USDC for everyone who signs up, once.
 *
 * This spends the operator's own testnet USDC, which cannot be minted (it is Circle's token,
 * refilled by hand at faucet.circle.com), so it is bounded in every direction:
 *   - the caller must be a real Privy user, proven by a verified access token, and may only
 *     claim for a wallet that user owns; the user id claims once however many wallets exist,
 *   - a client address gets a few claims a day, and the whole app a daily total,
 *   - it never spends the operator below a reserve kept for the app's own test scripts.
 * Every refusal is explained, never silent, and a failed transfer is undone so the user can
 * simply try again.
 */
export const dynamic = "force-dynamic";

const AMOUNT_UNITS = Number(process.env.WELCOME_USDC_UNITS ?? 2_000_000);
const PER_IP_PER_DAY = Number(process.env.WELCOME_PER_IP ?? 3);
const DAILY_UNITS = Number(process.env.WELCOME_DAILY_UNITS ?? 60_000_000);
const RESERVE_UNITS = 3_000_000;

const inFlight = new Set<string>();

function operatorKey(): `0x${string}` {
  const key = process.env.OPERATOR_PK ?? process.env.DEPLOYER_PK;
  if (!key) throw new Error("not configured");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

const refuse = (error: string, status: number, code: string) => NextResponse.json({ ok: false, code, error }, { status });

export async function POST(request: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return refuse("The welcome gift is not set up on this server.", 503, "unavailable");

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return refuse("Log in first.", 401, "auth");
  const did = await verifyAccessToken(token, appId);
  if (!did) return refuse("Your session could not be verified. Log in again.", 401, "auth");

  let address: string | undefined;
  try {
    address = ((await request.json()) as { address?: string }).address;
  } catch {
    /* handled below */
  }
  if (!address || !isAddress(address)) return refuse("Expected a wallet address.", 400, "address");

  // Only a wallet this user actually owns. Privy answers from its own records.
  const accounts = await linkedAccountsOf(did, appId, secret);
  if (!accounts) return refuse("Could not check your account right now. Try again shortly.", 503, "unavailable");
  if (!ownsWallet(accounts, address)) return refuse("That wallet is not on your account.", 403, "wallet");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (await hasClaimed(did, address)) return NextResponse.json({ ok: true, claimed: false, code: "already" });

  const lock = `${did}|${address.toLowerCase()}`;
  if (inFlight.has(lock)) return NextResponse.json({ ok: true, claimed: false, code: "already" });

  const usage = await usageToday(ip);
  if (usage.ipCount >= PER_IP_PER_DAY) return refuse("Too many accounts from this network today. Try tomorrow, or use faucet.circle.com.", 429, "limit");
  if (usage.dayUnits + AMOUNT_UNITS > DAILY_UNITS) return refuse("Today's welcome gifts are used up. Use faucet.circle.com.", 503, "empty");

  inFlight.add(lock);
  try {
    const account = privateKeyToAccount(operatorKey());
    const have = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
    if (have < BigInt(AMOUNT_UNITS + RESERVE_UNITS)) return refuse("The welcome pool is empty right now. Use faucet.circle.com.", 503, "empty");

    // Written down BEFORE the transfer, so two quick requests can never both pass.
    await recordClaim(did, address, ip, AMOUNT_UNITS);
    try {
      const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
      const hash = await wallet.writeContract({
        address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "transfer", args: [address, BigInt(AMOUNT_UNITS)], gas: 120_000n, account, chain: monadTestnet,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("transfer reverted");
      return NextResponse.json({ ok: true, claimed: true, amount: AMOUNT_UNITS / 1e6, hash });
    } catch (e) {
      await forgetClaim(did, address, ip, AMOUNT_UNITS);
      throw e;
    }
  } catch (e) {
    console.error(`[welcome] failed: ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]}`);
    return refuse("Could not send the gift right now. It will be tried again next time you log in.", 500, "failed");
  } finally {
    inFlight.delete(lock);
  }
}
