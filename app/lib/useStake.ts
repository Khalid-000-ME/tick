"use client";

import { useCallback, useRef, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickAbi, Erc20Abi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import type { MarketView } from "@/lib/useMarket";
import type { Terms } from "@/lib/chain/market";
import type { FeedSpec } from "@/lib/pyth";
import { gasShortfall } from "@/lib/gasCheck";

// viem polls for receipts every 4s by default; Monad blocks are ~0.4s, so that default alone
// adds seconds to every confirmation.
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

// Monad charges the gas LIMIT, not gas used, and a limit below the real need reverts and
// still pays. Estimated on chain against Circle USDC: stakeOn 158k, approve 88k (first
// time), deposit 137k. Each limit is roughly 2x its estimate: enough headroom to never
// revert, still well under a wallet's own padded estimate.
const GAS = { approve: 180_000n, deposit: 280_000n, stake: 300_000n } as const;

/**
 * Sends the real stake: approve -> deposit -> stakeOn, skipping whichever
 * steps are already satisfied.
 *
 * Tick holds an internal balance, so the approve+deposit pair is a one-time setup and
 * every later stake is a single transaction. That is worth saying in the UI, because it
 * is the difference between a 30-second market being usable and not.
 *
 * Every failure is simulated first so the user sees the contract's own custom error
 * (PriceTooStale, NotOpen, OffStrikeGrid) rather than "transaction reverted". For this
 * product that distinction matters: a refused late stake is the mechanism working, and
 * the UI should say so rather than looking broken.
 */
export interface StakeResult {
  ok: boolean;
  message: string;
  /**
   * The exact terms staked and the id they hash to, returned so the caller can follow
   * the position to settlement. The chain never stores the terms — only their hash — so
   * if these are dropped here, there is no way to ask later what happened.
   */
  terms?: Terms;
  id?: `0x${string}`;
  hash?: `0x${string}`;
  /** Resolves when the stake is mined; present when ok is true. */
  confirm?: Promise<{ ok: boolean; message: string }>;
}

export function useStake({
  walletClient,
  account,
  market,
  feed,
}: {
  walletClient: WalletClient | null;
  account: `0x${string}` | null;
  market: MarketView;
  feed: FeedSpec;
}) {
  // The market rolls every 30 seconds. `submit` can run for several of those on a first
  // stake (approve + deposit + price post), so it must read the CURRENT window at the
  // moment it stakes rather than the one captured when the button was pressed.
  const marketRef = useRef(market);
  marketRef.current = market;

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [lastHash, setLastHash] = useState<`0x${string}` | null>(null);

  const submit = useCallback(
    async (side: "ABOVE" | "BELOW", amount: number, beforeStake?: () => Promise<void>): Promise<StakeResult> => {
      if (!walletClient || !account) return { ok: false, message: "Connect a wallet first." };
      if (!market.terms || !market.id) return { ok: false, message: "Waiting for a live price from Pyth." };
      if (amount <= 0) return { ok: false, message: "Enter an amount above zero." };

      // The exact terms the user is agreeing to, frozen here. Everything below either
      // stakes THESE or stakes nothing.
      const terms = market.terms;
      const id = market.id;

      const units = BigInt(Math.round(amount * 1e6));
      setBusy(true);
      try {
        // The reads are independent, so they go out together instead of one by one.
        setStep("Checking balance…");
        const [bal, deposited, allowance] = await Promise.all([
          pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
          pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account] }) as Promise<bigint>,
          pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [account, CONTRACTS.tick] }) as Promise<bigint>,
        ]);

        // The setup transactions are only sent when needed, so only count those.
        const planned: bigint[] = [GAS.stake];
        if (deposited < units) planned.push(GAS.deposit, ...(allowance < bal ? [GAS.approve] : []));
        const short = await gasShortfall(pub, account, planned);
        if (short) return { ok: false, message: short };

        if (deposited < units) {
          const shortfall = units - deposited;

          if (bal < shortfall) {
            return {
              ok: false,
              message: `Not enough USDC: you have ${Number(bal) / 1e6} in your wallet and ${Number(deposited) / 1e6} deposited, and this stake needs ${amount}. Add USDC on the Fund page, or try a smaller stake.`,
            };
          }

          // One-time setup. Approve once for good, and move the WHOLE wallet balance into
          // Tick rather than just this stake, so every later stake is a single transaction
          // with nothing to approve or deposit. It stays withdrawable from the Fund page.
          if (allowance < bal) {
            setStep("Approving USDC (one time)…");
            const approveHash = await walletClient.writeContract({
              address: CONTRACTS.usdc,
              abi: Erc20Abi,
              functionName: "approve",
              args: [CONTRACTS.tick, 2n ** 255n],
              account,
              chain: monadTestnet,
              gas: GAS.approve,
            });
            await pub.waitForTransactionReceipt({ hash: approveHash });
          }

          setStep("Moving USDC into Tick…");
          const depositHash = await walletClient.writeContract({
            address: CONTRACTS.tick,
            abi: TickAbi,
            functionName: "deposit",
            args: [bal],
            account,
            chain: monadTestnet,
            gas: GAS.deposit,
          });
          await pub.waitForTransactionReceipt({ hash: depositHash });
        }

        // --- the stake. Simulated first, so a refusal is explained rather than raw.
        // Post a fresh price only now, right before the stake. Keeping the oracle warm
        // all day costs MON on every post whether or not anyone trades; doing it here
        // costs one post per stake and nothing otherwise.
        if (beforeStake) {
          setStep("Fetching price…");
          await beforeStake();
        }

        // Re-read the window. If approving and depositing took long enough for it to
        // roll, the terms the user agreed to no longer exist: closesAt has passed and
        // the strike has been re-struck. Staking the NEW terms would quietly move their
        // bet to a different strike, so stop and let them confirm the new one. Their
        // wallet is set up now, so the next attempt is a single transaction that
        // comfortably fits inside one window.
        const live = marketRef.current;
        if (!live.terms || !live.id) return { ok: false, message: "Waiting for a live price from Pyth." };
        if (live.terms.closesAt !== terms.closesAt || live.terms.strike !== terms.strike) {
          return {
            ok: false,
            message:
              "Your wallet is set up, but the 30-second window rolled while that was " +
              "confirming — and the next one has its own strike. Nothing was staked. " +
              "Tap Stake again and it goes through in one transaction.",
          };
        }

        // No pre-send simulation: with the price kept warm it almost never fails, and a
        // simulation is a full extra round trip on the critical path. A failure is still
        // explained from the contract's own error below.
        setStep("Staking…");
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tick,
          abi: TickAbi,
          functionName: "stakeOn",
          args: [terms, side === "ABOVE", units],
          account,
          chain: monadTestnet,
          gas: GAS.stake,
        });
        setLastHash(hash);

        // Report as soon as the transaction is accepted. Confirmation takes ~1s more and
        // the caller follows it, so a stake that does revert is taken back out of the UI.
        const confirm = pub.waitForTransactionReceipt({ hash }).then(
          (rc): { ok: boolean; message: string } => {
            market.refetch();
            return rc.status === "success"
              ? { ok: true, message: `Staked ${amount} USDC ${side} on ${feed.symbol}. Settles when the window closes — anyone can settle it.` }
              : {
                  ok: false,
                  message:
                    "The stake reverted on chain, most likely because the price went stale or the window closed first. Nothing was taken from your balance.",
                };
          },
          () => ({ ok: false, message: "Could not confirm the stake. Check the Portfolio page." })
        );

        return {
          ok: true,
          message: `Staking ${amount} USDC ${side} on ${feed.symbol}…`,
          terms,
          id,
          hash,
          confirm,
        };
      } catch (e) {
        return { ok: false, message: explain(e, market, feed) };
      } finally {
        setBusy(false);
        setStep("");
      }
    },
    [walletClient, account, market, feed]
  );

  return { submit, busy, step, lastHash };
}

/**
 * Turns a revert into something that explains the mechanism. PriceTooStale in particular
 * is not a failure — it is the cutoff doing its job, and the copy should read that way.
 */
function explain(e: unknown, market: MarketView, feed: FeedSpec): string {
  const data = (e as { cause?: { data?: { errorName?: string; args?: unknown[] } } }).cause?.data;
  const name = data?.errorName;

  switch (name) {
    case "PriceTooStale": {
      const age = market.priceAge ?? "?";
      return `Refused: the on-chain ${feed.symbol} price is ${age}s old, past the ${market.acceptMargin}s acceptance margin. This is the cutoff working — a stake placed against a stale price is exactly what it exists to stop. It reopens the moment the price is refreshed.`;
    }
    case "NotOpen":
      return "This window has already closed. The next one is loading.";
    case "AlreadySettled":
      return "This market has already settled. Pick the next window.";
    case "OffStrikeGrid":
      return "That strike is off the feed's grid. Strikes are quantised so everyone lands in the same pool instead of each sitting alone on one side.";
    case "OffWindowGrid":
      return "That close time is off the 30-second window grid.";
    case "ExpoMismatch":
      return `The ${feed.symbol} feed changed its exponent. Reload to pick it up — the contract refuses rather than guessing at a redenominated strike.`;
    case "FeedNotListed":
      return `${feed.symbol} is not listed on this deployment.`;
    case "InsufficientDeposit":
      return "Your deposited balance is short. Try a smaller amount.";
    default: {
      const msg =
        (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "Something went wrong.";
      if (/user rejected|denied/i.test(msg)) return "You rejected the transaction in your wallet.";
      return msg.split("\n")[0];
    }
  }
}
