"use client";

import { createPublicClient, formatEther, getAddress, http, isAddress, parseAbi, type WalletClient } from "viem";
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
export const FUND_GAS = { approve: 180_000n, deposit: 280_000n, withdraw: 220_000n, fill: 200_000n, transfer: 120_000n } as const;

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

/* ------------------------------------------------------------------ withdrawals */

/** Contracts that must never be a withdrawal target: USDC sent to one is locked there for good. */
const LOCKED_TARGETS = new Set(Object.values(CONTRACTS).map((a) => a.toLowerCase()));

/**
 * Why this address cannot receive a withdrawal, or null when it can. Checked on every
 * keystroke in the form and again before anything is sent, because a pasted address is the
 * one input here that can lose money: a transfer cannot be recalled.
 */
export function recipientProblem(to: string, self: `0x${string}` | null): string | null {
  const v = to.trim();
  if (!v) return "Paste the wallet address to send to.";
  // viem's strict check also verifies the checksum on a mixed-case address, which catches
  // most typos and bad copies; an all-lowercase address carries no checksum and passes.
  if (!isAddress(v)) return "That is not a valid address. Check it for typos.";
  const addr = v.toLowerCase();
  if (/^0x0{40}$/.test(addr)) return "That is the empty address. Funds sent there are gone.";
  if (self && addr === self.toLowerCase()) return "That is this wallet. Paste a different one.";
  if (LOCKED_TARGETS.has(addr)) return "That is a Tick contract address. Funds sent there would be locked.";
  return null;
}

/**
 * Send USDC out to any address on Monad. Whatever the transfer needs is gathered into the
 * wallet first, from the price and sports balances, so the trader never has to know where
 * their money was parked. Returns the transaction hash so the page can link to it.
 */
export async function sendUsdc(
  walletClient: WalletClient,
  account: `0x${string}`,
  to: string,
  units: bigint,
  step: Step
): Promise<{ ok: boolean; message: string; hash?: `0x${string}` }> {
  const problem = recipientProblem(to, account);
  if (problem) return { ok: false, message: problem };
  if (units <= 0n) return { ok: false, message: "Enter an amount above zero." };
  try {
    step("Checking balance…");
    const f = await readFunds(account);
    if (f.total < units) return { ok: false, message: `You have ${fmt(f.total)} USDC and asked to send ${fmt(units)}.` };

    // Only the contracts that actually need emptying cost a withdrawal's gas.
    const pulls = f.wallet >= units ? 0 : (f.sports > 0n ? 1 : 0) + (f.tick > 0n ? 1 : 0);
    const planned = [FUND_GAS.transfer, ...Array<bigint>(pulls).fill(FUND_GAS.withdraw)];
    let short = await gasShortfall(pub, account, planned);
    if (short) {
      step("Getting starter gas…");
      if (await requestGas(account)) short = await gasShortfall(pub, account, planned);
    }
    if (short) return { ok: false, message: short };

    const moved = await ensureWalletUsdc(walletClient, account, units, f, step);
    if (moved) return { ok: false, message: moved };

    step("Sending…");
    const hash = await walletClient.writeContract({
      address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "transfer",
      args: [getAddress(to.trim()), units], account: walletClient.account ?? account, chain: monadTestnet, gas: FUND_GAS.transfer,
    });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") return { ok: false, message: "The transfer reverted on chain. Nothing was sent.", hash };
    const t = getAddress(to.trim());
    return { ok: true, message: `Sent ${fmt(units)} USDC to ${t.slice(0, 6)}...${t.slice(-4)}.`, hash };
  } catch (e) {
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    if (/user rejected|denied/i.test(msg)) return { ok: false, message: "You rejected the transaction." };
    return { ok: false, message: msg.split("\n")[0] };
  }
}

/* ------------------------------------------------------------------ gas tank */

/** Gas (in wei, the chain's own unit) a fill of `units` USDC returns at the live rate. */
export async function quoteGas(units: bigint): Promise<bigint> {
  if (units <= 0n) return 0n;
  return (await pub.readContract({ address: CONTRACTS.gasStation, abi: GasStationAbi, functionName: "quote", args: [units] })) as bigint;
}

export async function gasStationInfo(): Promise<{ reserve: bigint; maxFill: bigint; gasPrice: bigint; weiPerUsdc: bigint }> {
  const [reserve, maxFill, gasPrice, weiPerUsdc] = await Promise.all([
    pub.getBalance({ address: CONTRACTS.gasStation }),
    pub.readContract({ address: CONTRACTS.gasStation, abi: GasStationAbi, functionName: "maxFill" }) as Promise<bigint>,
    pub.getGasPrice(),
    // The live rate, as one USDC's worth, so a fill can be sized without asking again.
    quoteGas(1_000_000n),
  ]);
  return { reserve, maxFill, gasPrice, weiPerUsdc };
}

/** Gas a stake costs at the limit Monad charges: the unit the tank is measured in. */
export const STAKE_GAS = 300_000n;
export function stakesFor(monWei: bigint, gasPrice: bigint): number {
  if (gasPrice <= 0n) return 0;
  return Number(monWei / (STAKE_GAS * gasPrice));
}

/**
 * The tank, as a percentage.
 *
 * Nobody signing up to call a price wants to learn what MON is, so gas is never shown as a
 * token balance: it is a tank that is some percent full, and it is filled with USDC, which
 * is the only money a trader here holds. A full tank is FULL_TANK trades' worth of gas.
 */
export const FULL_TANK = 40;

export function gasPercent(monWei: bigint, gasPrice: bigint): number {
  const stakes = stakesFor(monWei, gasPrice);
  if (stakes <= 0) return monWei > 0n ? 1 : 0;
  return Math.max(1, Math.min(100, Math.round((stakes / FULL_TANK) * 100)));
}

/**
 * What it costs to fill the tank, in USDC units: the gap to full at the station's live rate,
 * kept inside the per-fill limit and what the trader actually holds. Null when there is
 * nothing to do, or nothing to pay with.
 */
export function planFill(
  f: Funds,
  station: { maxFill: bigint; gasPrice: bigint; weiPerUsdc: bigint }
): { units: bigint; percentNow: number; percentAfter: number } | null {
  const percentNow = gasPercent(f.mon, station.gasPrice);
  if (percentNow >= 100 || station.weiPerUsdc <= 0n || station.gasPrice <= 0n) return null;
  const full = BigInt(FULL_TANK) * STAKE_GAS * station.gasPrice;
  const missing = full - f.mon;
  if (missing <= 0n) return null;
  // Round up to the nearest cent, so a fill always moves the needle.
  let units = ((missing * 1_000_000n + station.weiPerUsdc - 1n) / station.weiPerUsdc / 10_000n + 1n) * 10_000n;
  if (units > station.maxFill) units = station.maxFill;
  if (units > f.total) units = (f.total / 10_000n) * 10_000n;
  if (units <= 0n) return null;
  return { units, percentNow, percentAfter: gasPercent(f.mon + (units * station.weiPerUsdc) / 1_000_000n, station.gasPrice) };
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
    return { ok: true, message: `Gas filled for ${fmt(units)} USDC.` };
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
