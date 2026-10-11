"use client";

import { useCallback, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { Erc20Abi, TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { gasShortfall } from "@/lib/gasCheck";
import { requestGas } from "@/lib/requestGas";

/**
 * Staking a side of a fixture.
 *
 * Simpler than the price path: there is no oracle to keep warm, no strike and no
 * freshness cutoff, because the market closes at kickoff rather than against a moving
 * price. Setup is the same one-time approve and deposit, against the sports contract's
 * own balance — TickSports holds deposits separately from Tick, so funding one does not
 * fund the other.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

/** Measured against Circle USDC; Monad charges the limit, so each is ~2x its estimate. */
const GAS = { approve: 180_000n, deposit: 280_000n, stake: 300_000n } as const;

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
      if (!walletClient || !account) return { ok: false, message: "Connect a wallet first." };
      if (amount <= 0) return { ok: false, message: "Enter an amount above zero." };
      if (BigInt(Math.floor(Date.now() / 1000)) >= terms.closesAt) {
        return { ok: false, message: "That fixture has already kicked off." };
      }

      const units = BigInt(Math.round(amount * 1e6));
      setBusy(true);
      try {
        setStep("Checking balance…");
        const [bal, deposited, allowance] = await Promise.all([
          pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
          pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [account] }) as Promise<bigint>,
          pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [account, CONTRACTS.tickSports] }) as Promise<bigint>,
        ]);

        const planned: bigint[] = [GAS.stake];
        if (deposited < units) planned.push(GAS.deposit, ...(allowance < bal ? [GAS.approve] : []));
        let short = await gasShortfall(pub, account, planned);
        if (short) {
          setStep("Getting starter gas…");
          if (await requestGas(account)) short = await gasShortfall(pub, account, planned);
        }
        if (short) return { ok: false, message: short };

        if (deposited < units) {
          if (bal < units - deposited) {
            return {
              ok: false,
              message: `Not enough USDC: ${Number(bal) / 1e6} in your wallet and ${Number(deposited) / 1e6} in the sports balance, and this needs ${amount}. Add USDC on the Fund page.`,
            };
          }
          if (allowance < bal) {
            setStep("Approving USDC (one time)…");
            const h = await walletClient.writeContract({
              address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve",
              args: [CONTRACTS.tickSports, 2n ** 255n], account, chain: monadTestnet, gas: GAS.approve,
            });
            await pub.waitForTransactionReceipt({ hash: h });
          }
          setStep("Moving USDC in…");
          const h = await walletClient.writeContract({
            address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposit",
            args: [bal], account, chain: monadTestnet, gas: GAS.deposit,
          });
          await pub.waitForTransactionReceipt({ hash: h });
        }

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
