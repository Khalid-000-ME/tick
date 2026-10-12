"use client";

import { useCallback, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { allowanceFor, ensureStakeable, plannedMoves, readFunds } from "@/lib/funds";
import { gasShortfall } from "@/lib/gasCheck";
import { requestGas } from "@/lib/requestGas";

/**
 * Staking a side of a fixture.
 *
 * Simpler than the price path: there is no oracle to keep warm, no strike and no
 * freshness cutoff, because the market closes at kickoff rather than against a moving
 * price. Funding goes through the shared balance in lib/funds, so the trader has one
 * balance for sports and price markets alike.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

/** Measured against Circle USDC; Monad charges the limit, so each is ~2x its estimate. */
const GAS = { stake: 300_000n } as const;

export interface SportsTerms {
  eventId: `0x${string}`;
  closesAt: bigint;
}

export interface SportsStakeResult {
  ok: boolean;
  message: string;
  hash?: `0x${string}`;
  confirm?: Promise<{ ok: boolean; message: string }>;
}

export function useSportsStake(walletClient: WalletClient | null, account: `0x${string}` | null) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const submit = useCallback(
    async (terms: SportsTerms, home: boolean, amount: number, label: string): Promise<SportsStakeResult> => {
      if (!walletClient || !account) return { ok: false, message: "Log in first." };
      if (amount <= 0) return { ok: false, message: "Enter an amount above zero." };
      if (BigInt(Math.floor(Date.now() / 1000)) >= terms.closesAt) {
        return { ok: false, message: "That fixture has already kicked off." };
      }

      const units = BigInt(Math.round(amount * 1e6));
      setBusy(true);
      try {
        setStep("Checking balance…");
        const [funds, allowance] = await Promise.all([readFunds(account), allowanceFor(account, "sports")]);

        const planned: bigint[] = [GAS.stake, ...plannedMoves(funds, "sports", units, allowance)];
        let short = await gasShortfall(pub, account, planned);
        if (short) {
          setStep("Getting starter gas…");
          if (await requestGas(account)) short = await gasShortfall(pub, account, planned);
        }
        if (short) return { ok: false, message: short };

        // Same single balance as price markets: whatever is in the wallet or parked in the
        // price contract is moved across when this contract is short.
        const moved = await ensureStakeable(walletClient, account, "sports", units, funds, allowance, setStep);
        if (moved) return { ok: false, message: moved };

        setStep("Staking…");
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "stakeOn",
          args: [terms, home, units], account, chain: monadTestnet, gas: GAS.stake,
        });

        // Reported on acceptance; the receipt follows and corrects it if it reverted.
        const confirm = pub.waitForTransactionReceipt({ hash }).then(
          (rc): { ok: boolean; message: string } =>
            rc.status === "success"
              ? { ok: true, message: `Staked ${amount} USDC on ${label}. Settles once the result is in.` }
              : { ok: false, message: "The stake reverted, most likely because the fixture kicked off first. Nothing was taken." },
          () => ({ ok: false, message: "Could not confirm the stake." })
        );

        return { ok: true, message: `Staking ${amount} USDC on ${label}…`, hash, confirm };
      } catch (e) {
        const data = (e as { cause?: { data?: { errorName?: string } } }).cause?.data;
        if (data?.errorName === "NotOpen") return { ok: false, message: "That fixture has already kicked off." };
        if (data?.errorName === "AlreadySettled") return { ok: false, message: "That market has already settled." };
        const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
        if (/user rejected|denied/i.test(msg)) return { ok: false, message: "You rejected the transaction." };
        return { ok: false, message: msg.split("\n")[0] };
      } finally {
        setBusy(false);
        setStep("");
      }
    },
    [walletClient, account]
  );

  return { submit, busy, step };
}
