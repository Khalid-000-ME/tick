import { NextResponse } from "next/server";
import { createWalletClient, formatEther, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";

/**
 * Sends a new wallet enough MON for gas to place its first stakes.
 *
 * A fresh embedded wallet has no MON, and every transaction needs it, so without this the
 * first tap fails with an error about gas. Testnet only: this spends the operator's own
 * testnet MON and is bounded so it cannot drain it:
 *   - only wallets under LOW_BELOW get anything,
 *   - one drip per address per cooldown, and per client IP per cooldown,
 *   - a global cap per rolling day.
 */
export const dynamic = "force-dynamic";

const DRIP = parseEther("0.2");
const LOW_BELOW = parseEther("0.05");
const COOLDOWN_MS = 6 * 3600_000;
const DAILY_CAP = parseEther("20");

const byAddress = new Map<string, number>();
const IP_LIMIT = 5;
const byIp = new Map<string, number[]>();
let day = { start: Date.now(), sent: 0n };

function operatorKey(): `0x${string}` {
  const key = process.env.OPERATOR_PK ?? process.env.DEPLOYER_PK;
  if (!key) throw new Error("not configured");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

export async function POST(request: Request) {
  let address: string | undefined;
  try {
    address = ((await request.json()) as { address?: string }).address;
  } catch {
    /* handled below */
  }
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Expected a wallet address." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  if (now - day.start > 24 * 3600_000) day = { start: now, sent: 0n };
  const key = address.toLowerCase();

  const recentIp = (byIp.get(ip) ?? []).filter((t) => t + COOLDOWN_MS > now);
  if ((byAddress.get(key) ?? 0) + COOLDOWN_MS > now || recentIp.length >= IP_LIMIT) {
    return NextResponse.json({ error: "This wallet or network already received gas recently." }, { status: 429 });
  }
  if (day.sent + DRIP > DAILY_CAP) {
    return NextResponse.json({ error: "The gas faucet is empty for today. Use faucet.monad.xyz." }, { status: 503 });
  }

  try {
    const balance = await pub.getBalance({ address });
    if (balance >= LOW_BELOW) {
      return NextResponse.json({ ok: true, skipped: true, balance: formatEther(balance) });
    }

    const account = privateKeyToAccount(operatorKey());
    const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
    byAddress.set(key, now);
    byIp.set(ip, [...recentIp, now]);
    day.sent += DRIP;
    const hash = await wallet.sendTransaction({ to: address, value: DRIP, gas: 21_000n, account, chain: monadTestnet });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("transfer failed");
    return NextResponse.json({ ok: true, sent: formatEther(DRIP), hash });
  } catch (e) {
    byAddress.delete(key);
    byIp.set(ip, recentIp);
    day.sent -= DRIP;
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    console.error(`[gas] failed: ${msg.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not send gas right now." }, { status: 500 });
  }
}
