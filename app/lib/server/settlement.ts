import { createWalletClient, http, type Account } from "viem";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, SETTLE_TOLERANCE_S, monadTestnet } from "@/lib/chain/config";
import { fetchUpdateForWindow } from "@/lib/pyth";
import { pub } from "@/lib/server/oracle";

/**
 * Settles one market via Tick.settleWithUpdate and collects the settler bounty.
 *
 * Anyone can do exactly this: fetch Hermes' update for the close, call the contract,
 * keep the bounty. The app's server does it so a demo never waits on a stranger, but it
 * is deliberately the SAME code path an outside bot would run (scripts/settler.ts is one),
 * which is what makes settlement permissionless in practice and not only on paper.
 */
export interface MarketTerms {
  feedId: `0x${string}`;
  strike: bigint;
  expo: number;
  closesAt: bigint;
}

export class NothingToSettle extends Error {}

export async function settleMarket(account: Account, terms: MarketTerms, id: `0x${string}`) {
  const [aboveTotal, belowTotal] = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "pools",
    args: [id],
  })) as readonly [bigint, bigint];
  // An empty market has no one to pay and nothing to refund; settling it only burns gas.
  if (aboveTotal === 0n && belowTotal === 0n) throw new NothingToSettle("No stakes in this market.");

  const { updateData } = await fetchUpdateForWindow(terms.feedId, Number(terms.closesAt), SETTLE_TOLERANCE_S);

  // Simulated first: a revert here is free, a reverted transaction is not (Monad charges
  // the gas limit, and settle is the most expensive call in the system).
  const { request } = await pub.simulateContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "settleWithUpdate",
    args: [terms, updateData],
    // Pyth's update fee. The contract refunds anything above it.
    value: 10n,
    account,
  });

  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });

  const settled = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "settlements",
    args: [id],
  })) as readonly [number, bigint, bigint, number, bigint, bigint];

  return { hash, receipt, outcome: settled[0], aboveTotal, belowTotal };
}
