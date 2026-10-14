"use client";

import { useCallback, useMemo, useState } from "react";
import { useWallets, useCreateWallet, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import {
  SOLANA, RULES, stakeIx, claimIx, tokenAccount, readMarket, readPrice, needsOwnPrice, toHex, type Terms,
} from "./program";

/**
 * Staking on Solana from the browser, through the Privy embedded Solana wallet.
 *
 * Mirrors the Monad path in lib/useStake.ts: one call, the same steps reported the same way, so the
 * terminal does not care which chain it is on. What differs underneath is that the token account
 * may not exist yet, so it is created in the same transaction as the stake rather than in a
 * separate approval the way an ERC-20 needs.
 */
export type SolanaStatus = "no-wallet" | "ready";

export function useSolanaWallet() {
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const wallet = wallets[0] ?? null;
  const address = wallet?.address ?? null;
  return {
    wallet,
    address,
    status: (address ? "ready" : "no-wallet") as SolanaStatus,
    create: createWallet,
  };
}

export function useSolanaStake() {
  const { wallet, address } = useSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const connection = useMemo(() => new Connection(SOLANA.rpc, "confirmed"), []);

  const submit = useCallback(
    async (terms: Terms, above: boolean, amountUnits: bigint) => {
      if (!wallet || !address) return { ok: false, message: "No Solana wallet yet." };
      if (amountUnits < RULES.minStakeUnits) return { ok: false, message: "Below the ten cent minimum." };

      const owner = new PublicKey(address);
      setBusy(true);
      try {
        // The program refuses a price older than the margin, so say so here rather than letting the
        // transaction fail with a code nobody can read.
        // Feeds nobody maintains on devnet need a price posting before the stake will be accepted.
        // The receiver verifies the Wormhole signatures, so this buys freshness, not trust.
        let priceUpdate: PublicKey | undefined;
        if (needsOwnPrice(toHex(terms.feedId))) {
          setStep("Posting a fresh price");
          const res = await fetch("/api/solana/price", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedId: toHex(terms.feedId) }),
          }).then((r) => r.json()).catch(() => null);
          if (!res?.ok || !res.priceAccount) {
            return { ok: false, message: res?.error ?? "Could not post a price for that market." };
          }
          priceUpdate = new PublicKey(res.priceAccount);
        } else {
          setStep("Checking the price");
          const price = await readPrice(connection, terms.feedId);
          if (!price) return { ok: false, message: "No Pyth price account for that feed." };
          const age = Math.floor(Date.now() / 1000) - price.publishTime;
          if (age > RULES.acceptMarginSeconds) {
            return { ok: false, message: `The posted price is ${age}s old. Wait for the next update.` };
          }
        }

        setStep("Checking your balance");
        const ata = tokenAccount(owner);
        const tx = new Transaction();
        let balance = 0n;
        try {
          balance = (await getAccount(connection, ata)).amount;
        } catch {
          // No token account yet: make it in the same transaction, so this is still one signature.
          tx.add(createAssociatedTokenAccountInstruction(owner, ata, owner, SOLANA.mint));
        }
        if (balance > 0n && balance < amountUnits) {
          return { ok: false, message: `Not enough: you hold ${(Number(balance) / 1e6).toFixed(2)}.` };
        }

        setStep("Staking");
        tx.add(stakeIx(owner, terms, above, amountUnits, priceUpdate));
        tx.feePayer = owner;
        tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

        // Privy signs bytes, not a Transaction object, and the cluster is named per call.
        const { signature } = await signAndSendTransaction({
          transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
          wallet,
          chain: "solana:devnet",
        });

        // Privy hands back the raw signature bytes; everything else wants base58.
        const sig = bs58.encode(signature);
        setStep("Confirming");
        await connection.confirmTransaction(sig, "confirmed");
        return { ok: true, message: "Staked on Solana.", signature: sig };
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (/insufficient|0x1$/i.test(msg)) return { ok: false, message: "Not enough SOL for fees." };
        if (/User rejected|denied/i.test(msg)) return { ok: false, message: "Cancelled." };
        return { ok: false, message: msg.split("\n")[0].slice(0, 140) };
      } finally {
        setBusy(false);
        setStep("");
      }
    },
    [wallet, address, connection, signAndSendTransaction],
  );

  const claim = useCallback(
    async (terms: Terms) => {
      if (!address || !wallet) return { ok: false, message: "No Solana wallet yet." };
      const owner = new PublicKey(address);
      setBusy(true);
      try {
        setStep("Claiming");
        const tx = new Transaction().add(claimIx(owner, terms));
        tx.feePayer = owner;
        tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
        const { signature } = await signAndSendTransaction({
          transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
          wallet,
          chain: "solana:devnet",
        });
        const sig = bs58.encode(signature);
        await connection.confirmTransaction(sig, "confirmed");
        return { ok: true, message: "Claimed.", signature: sig };
      } catch (e) {
        return { ok: false, message: ((e as Error).message ?? "").split("\n")[0].slice(0, 140) };
      } finally {
        setBusy(false);
        setStep("");
      }
    },
    [address, wallet, connection, signAndSendTransaction],
  );

  return { submit, claim, busy, step, address, connection, readMarket };
}
