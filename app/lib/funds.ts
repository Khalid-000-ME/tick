"use client";

import { createPublicClient, formatEther, http, parseAbi, type WalletClient } from "viem";
import { Erc20Abi, GasStationAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { gasShortfall } from "@/lib/gasCheck";
import { requestGas } from "@/lib/requestGas";

/**
 * One balance.
 *
 * Price markets and sports markets are separate contracts, and each keeps its own deposit
 * so a stake is a single transaction. A trader should never have to know that. Their
 * balance is the wallet's USDC plus whatever sits in either contract, and when a stake on
 * one side needs money that is parked on the other, it is moved across here, in the same
 * flow as the stake. Nothing about the split reaches the screen.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

/** Tick and TickSports expose the same deposit interface. */
const VaultAbi = parseAbi([
  "function deposits(address) view returns (uint256)",
  "function deposit(uint256)",
  "function withdraw(uint256)",
]);

/** Monad charges the gas limit, so each is ~2x its measured estimate. */
export const FUND_GAS = { approve: 180_000n, deposit: 280_000n, withdraw: 220_000n, fill: 200_000n } as const;

export type Venue = "tick" | "sports";
const ADDRESS: Record<Venue, `0x${string}`> = { tick: CONTRACTS.tick, sports: CONTRACTS.tickSports };
const other = (v: Venue): Venue => (v === "tick" ? "sports" : "tick");

export interface Funds {
  /** USDC sitting in the wallet itself. */
  wallet: bigint;
  tick: bigint;
  sports: bigint;
  /** Everything the trader can stake with, wherever it currently sits. */
  total: bigint;
  /** MON, in wei: the gas tank. */
  mon: bigint;
}

export async function readFunds(account: `0x${string}`): Promise<Funds> {
  const [wallet, tick, sports, mon] = await Promise.all([
    pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
    pub.readContract({ address: CONTRACTS.tick, abi: VaultAbi, functionName: "deposits", args: [account] }),
    pub.readContract({ address: CONTRACTS.tickSports, abi: VaultAbi, functionName: "deposits", args: [account] }),
    pub.getBalance({ address: account }),
  ]);
  return { wallet, tick, sports, total: wallet + tick + sports, mon };
}

type Step = (s: string) => void;

async function send(walletClient: WalletClient, account: `0x${string}`, req: Parameters<WalletClient["writeContract"]>[0]) {
  // The client's own account when it has one (a local signer), else the address (an
  // injected or embedded wallet that signs on its side).
  const hash = await walletClient.writeContract({ ...req, account: walletClient.account ?? account, chain: monadTestnet } as Parameters<WalletClient["writeContract"]>[0]);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("A balance transfer reverted on chain. Nothing was staked.");
}

/** Gas for the moves `ensureStakeable` would make, so the caller can check MON once for all of it. */
export function plannedMoves(f: Funds, venue: Venue, units: bigint, allowance: bigint): bigint[] {
  const have = venue === "tick" ? f.tick : f.sports;
  if (have >= units) return [];
  const gas: bigint[] = [];
  if (f.wallet < units - have) gas.push(FUND_GAS.withdraw);
  gas.push(FUND_GAS.deposit);
  if (allowance < f.total) gas.push(FUND_GAS.approve);
  return gas;
}

export async function allowanceFor(account: `0x${string}`, venue: Venue): Promise<bigint> {
  return (await pub.readContract({
    address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [account, ADDRESS[venue]],
  })) as bigint;
}

/**
 * Make sure `venue` holds at least `units` for this account, drawing on the wallet first and
 * the other contract second. Everything available is consolidated into `venue`, so the next
 * stake there is a single transaction again. Returns a user-facing message when the whole
 * balance is too small, or null once the money is in place.
 */
export async function ensureStakeable(
  walletClient: WalletClient,
  account: `0x${string}`,
  venue: Venue,
  units: bigint,
  f: Funds,
  allowance: bigint,
  step: Step
): Promise<string | null> {
  const have = venue === "tick" ? f.tick : f.sports;
  if (have >= units) return null;
  if (f.total < units) {
    return `Not enough USDC: your balance is ${fmt(f.total)} and this stake is ${fmt(units)}. Add USDC on the Fund page, or stake less.`;
  }

  let wallet = f.wallet;
  const parked = venue === "tick" ? f.sports : f.tick;
  if (wallet < units - have && parked > 0n) {
    step("Moving your balance…");
    await send(walletClient, account, { address: ADDRESS[other(venue)], abi: VaultAbi, functionName: "withdraw", args: [parked], gas: FUND_GAS.withdraw } as never);
    wallet += parked;
  }
  if (allowance < wallet) {
    step("Approving USDC (one time)…");
    await send(walletClient, account, { address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve", args: [ADDRESS[venue], 2n ** 255n], gas: FUND_GAS.approve } as never);
  }
  step("Moving USDC in…");
  await send(walletClient, account, { address: ADDRESS[venue], abi: VaultAbi, functionName: "deposit", args: [wallet], gas: FUND_GAS.deposit } as never);
  return null;
}

/**
 * Bring `units` of USDC into the wallet itself, pulling from the contracts if needed. Used
 * before anything that spends from the wallet directly: a gas fill, or sending funds out.
 */
export async function ensureWalletUsdc(walletClient: WalletClient, account: `0x${string}`, units: bigint, f: Funds, step: Step): Promise<string | null> {
  if (f.wallet >= units) return null;
  if (f.total < units) return `Your balance is ${fmt(f.total)} USDC, short of ${fmt(units)}.`;
  let need = units - f.wallet;
  for (const v of ["sports", "tick"] as Venue[]) {
    const bal = v === "tick" ? f.tick : f.sports;
    if (need <= 0n || bal === 0n) continue;
    const take = bal < need ? bal : need;
    step("Moving your balance…");
    await send(walletClient, account, { address: ADDRESS[v], abi: VaultAbi, functionName: "withdraw", args: [take], gas: FUND_GAS.withdraw } as never);
    need -= take;
  }
  return null;
}

/** Everything back into the wallet, so it can be sent anywhere. */
export async function consolidateToWallet(walletClient: WalletClient, account: `0x${string}`, f: Funds, step: Step) {
  return ensureWalletUsdc(walletClient, account, f.total, f, step);
}

/* ------------------------------------------------------------------ gas tank */

/** MON (wei) a fill of `units` USDC returns at the live rate. */
export async function quoteGas(units: bigint): Promise<bigint> {
  if (units <= 0n) return 0n;
  return (await pub.readContract({ address: CONTRACTS.gasStation, abi: GasStationAbi, functionName: "quote", args: [units] })) as bigint;
}

export async function gasStationInfo(): Promise<{ reserve: bigint; maxFill: bigint; gasPrice: bigint }> {
  const [reserve, maxFill, gasPrice] = await Promise.all([
    pub.getBalance({ address: CONTRACTS.gasStation }),
    pub.readContract({ address: CONTRACTS.gasStation, abi: GasStationAbi, functionName: "maxFill" }) as Promise<bigint>,
    pub.getGasPrice(),
  ]);
  return { reserve, maxFill, gasPrice };
}

/** Gas a stake costs at the limit Monad charges: the unit the tank is measured in. */
export const STAKE_GAS = 300_000n;
export function stakesFor(monWei: bigint, gasPrice: bigint): number {
  if (gasPrice <= 0n) return 0;
  return Number(monWei / (STAKE_GAS * gasPrice));
}

/**
 * Swap `units` USDC for MON through GasStation. The quote is re-read and passed as the
 * minimum, so a rate change between quote and fill reverts instead of short-changing.
 */
export async function fillGas(walletClient: WalletClient, account: `0x${string}`, units: bigint, step: Step): Promise<{ ok: boolean; message: string }> {
  try {
    const f = await readFunds(account);
    const allowance = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [account, CONTRACTS.gasStation] })) as bigint;
    const planned: bigint[] = [FUND_GAS.fill];
    if (allowance < units) planned.push(FUND_GAS.approve);
    if (f.wallet < units) planned.push(FUND_GAS.withdraw, FUND_GAS.withdraw);
    // The very first fill still needs a little MON to send it; the starter drip covers that.
    let short = await gasShortfall(pub, account, planned);
    if (short) {
      step("Getting starter gas…");
      if (await requestGas(account)) short = await gasShortfall(pub, account, planned);
    }
    if (short) return { ok: false, message: short };

    const moved = await ensureWalletUsdc(walletClient, account, units, f, step);
    if (moved) return { ok: false, message: moved };
    if (allowance < units) {
      step("Approving USDC (one time)…");
      await send(walletClient, account, { address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve", args: [CONTRACTS.gasStation, 2n ** 255n], gas: FUND_GAS.approve } as never);
    }
    const quoted = await quoteGas(units);
    step("Filling…");
    await send(walletClient, account, { address: CONTRACTS.gasStation, abi: GasStationAbi, functionName: "fill", args: [units, quoted], gas: FUND_GAS.fill } as never);
    return { ok: true, message: `Filled ${Number(formatEther(quoted)).toFixed(3)} MON for ${fmt(units)} USDC.` };
  } catch (e) {
    const name = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName;
    if (name === "ReserveTooLow") return { ok: false, message: "The platform gas reserve is low right now. Try a smaller fill." };
    if (name === "BadAmount") return { ok: false, message: "That fill is above the per-fill limit." };
    if (name === "Slippage") return { ok: false, message: "The rate changed while filling. Nothing was spent; try again." };
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    if (/user rejected|denied/i.test(msg)) return { ok: false, message: "You rejected the transaction." };
    return { ok: false, message: msg.split("\n")[0] };
  }
}

export function fmt(units: bigint): string {
  return (Number(units) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
