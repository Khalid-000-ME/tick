import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TickAbi, Erc20Abi } from "../../lib/chain/abi.js";
import { PythAbi } from "../../lib/chain/pythAbi.js";
import { CONTRACTS, monadTestnet } from "../../lib/chain/config.js";
import { loadEnv, requireEnv } from "./env.js";

loadEnv();

export const pub = createPublicClient({ chain: monadTestnet, transport: http() });

export const walletFor = (pk: `0x${string}`) =>
  createWalletClient({ account: privateKeyToAccount(pk), chain: monadTestnet, transport: http() });

export const deployerPk = () => requireEnv("DEPLOYER_PK") as `0x${string}`;
export const deployer = () => privateKeyToAccount(deployerPk());
export const deployerWallet = () => walletFor(deployerPk());

export { TickAbi, Erc20Abi, PythAbi, CONTRACTS, monadTestnet };

export interface Terms {
  feedId: `0x${string}`;
  strike: bigint;
  expo: number;
  closesAt: bigint;
}

/**
 * The market id, computed locally. Matches Tick.marketId's
 * keccak256(abi.encode(feedId, strike, expo, closesAt)).
 *
 * Recomputed here rather than read from the contract so a mismatch in the encoding
 * surfaces as a failed stake instead of being silently papered over.
 */
export function marketId(t: Terms): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, int64, int32, uint64"), [
      t.feedId,
      t.strike,
      t.expo,
      t.closesAt,
    ])
  );
}

/** Deterministic demo participants, so funding survives restarts. */
export function participant(i: number) {
  const pk = keccak256(toHex(`tick-participant-${i}`));
  return { pk, account: privateKeyToAccount(pk), wallet: walletFor(pk) };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const txUrl = (hash: string) => `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;

/**
 * Sends and waits, recording how long inclusion actually took.
 *
 * Inclusion latency is not a curiosity here: the acceptance margin can never be tighter
 * than it, so these numbers are what justify the margin we choose.
 */
export async function sendTimed(
  label: string,
  send: () => Promise<`0x${string}`>
): Promise<{ hash: `0x${string}`; ms: number; blockTs: number; ok: boolean }> {
  const t0 = Date.now();
  const hash = await send();
  const rc = await pub.waitForTransactionReceipt({ hash });
  const ms = Date.now() - t0;
  const block = await pub.getBlock({ blockNumber: rc.blockNumber });
  console.log(
    `  ${label.padEnd(34)} ${rc.status === "success" ? "ok " : "REVERTED"} ${String(ms).padStart(5)}ms  ${txUrl(hash)}`
  );
  return { hash, ms, blockTs: Number(block.timestamp), ok: rc.status === "success" };
}

/** Idempotent top-up: computes the shortfall rather than sending a fixed amount, so a
 *  partial failure can simply be re-run without leaving wallets inconsistent. */
export async function ensureFunded(addr: `0x${string}`, minMon: bigint, minUsd: bigint) {
  const w = deployerWallet();
  const acct = deployer();

  const mon = await pub.getBalance({ address: addr });
  if (mon < minMon) {
    const hash = await w.sendTransaction({
      to: addr,
      value: minMon - mon,
      account: acct,
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  const usd = (await pub.readContract({
    address: CONTRACTS.usdc,
    abi: Erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  })) as bigint;
  if (usd < minUsd) {
    // Circle USDC cannot be minted. The deployer holds whatever the Circle faucet gave it
    // and lends it out; if that runs dry, top the deployer up at faucet.circle.com.
    const have = (await pub.readContract({
      address: CONTRACTS.usdc,
      abi: Erc20Abi,
      functionName: "balanceOf",
      args: [deployer().address],
    })) as bigint;
    if (have < minUsd - usd) {
      throw new Error(
        `deployer holds ${Number(have) / 1e6} USDC but ${Number(minUsd - usd) / 1e6} is needed — claim more at https://faucet.circle.com`
      );
    }
    const hash = await w.writeContract({
      address: CONTRACTS.usdc,
      abi: Erc20Abi,
      functionName: "transfer",
      args: [addr, minUsd - usd],
      account: acct,
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  const allowance = (await pub.readContract({
    address: CONTRACTS.usdc,
    abi: Erc20Abi,
    functionName: "allowance",
    args: [addr, CONTRACTS.tick],
  })) as bigint;
  if (allowance < minUsd) {
    const wallet = walletFor(participantPkFor(addr) ?? deployerPk());
    const hash = await wallet.writeContract({
      address: CONTRACTS.usdc,
      abi: Erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.tick, 2n ** 255n],
      account: wallet.account!,
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash });
  }
}

/** Reverse lookup so ensureFunded can approve as the participant itself. */
const pkIndex = new Map<string, `0x${string}`>();
export function registerParticipantPk(addr: string, pk: `0x${string}`) {
  pkIndex.set(addr.toLowerCase(), pk);
}
function participantPkFor(addr: string): `0x${string}` | undefined {
  return pkIndex.get(addr.toLowerCase());
}
