"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { monadTestnet } from "@/lib/chain/config";

export type WalletStatus = "unsupported" | "disconnected" | "wrong-chain" | "ready";

/** Read-only client. Always available, so markets render before anyone connects. */
export const readClient = createPublicClient({ chain: monadTestnet, transport: http() });

export function useWallet() {
  const [provider] = useState<EIP1193Provider | null>(() =>
    typeof window !== "undefined"
      ? (window as Window & { ethereum?: EIP1193Provider }).ethereum ?? null
      : null
  );
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) return;
    const eth = provider;

    // Restore an existing authorisation without prompting.
    void (async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as `0x${string}`[];
        if (accounts.length > 0) setAccount(accounts[0]);
        const id = (await eth.request({ method: "eth_chainId" })) as string;
        setChainId(Number.parseInt(id, 16));
      } catch {
        /* provider refused silent read — user must connect explicitly */
      }
    })();

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as `0x${string}`[];
      setAccount(accounts.length > 0 ? accounts[0] : null);
    };
    const onChain = (...args: unknown[]) => {
      setChainId(Number.parseInt(args[0] as string, 16));
    };

    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const status: WalletStatus = !provider
    ? "unsupported"
    : !account
      ? "disconnected"
      : chainId !== monadTestnet.id
        ? "wrong-chain"
        : "ready";

  const connect = useCallback(async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      setAccount(accounts[0] ?? null);
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(id, 16));
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }, [provider]);

  /** Switch to Monad testnet, adding the network if the wallet does not know it. */
  const switchChain = useCallback(async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    const hexId = `0x${monadTestnet.id.toString(16)}`;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      });
    } catch (e) {
      const code = (e as { code?: number }).code;
      // 4902 = unrecognised chain. Also seen as -32603 on some wallets.
      if (code === 4902 || code === -32603) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: monadTestnet.name,
                nativeCurrency: monadTestnet.nativeCurrency,
                rpcUrls: [...monadTestnet.rpcUrls.default.http],
                blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
              },
            ],
          });
        } catch (addErr) {
          setError(readableError(addErr));
        }
      } else {
        setError(readableError(e));
      }
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const walletClient: WalletClient | null = useMemo(() => {
    if (!provider || !account || chainId !== monadTestnet.id) return null;
    return createWalletClient({
      account,
      chain: monadTestnet,
      transport: custom(provider),
    });
  }, [provider, account, chainId]);

  return { status, account, chainId, connect, switchChain, walletClient, busy, error, setError };
}

/** Wallet errors are verbose and user-hostile. Surface the useful line only. */
export function readableError(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const err = e as { shortMessage?: string; details?: string; message?: string; code?: number };
    if (err.code === 4001) return "You rejected the request in your wallet.";
    if (err.shortMessage) return err.shortMessage;
    if (err.details) return err.details;
    if (err.message) return err.message.split("\n")[0];
  }
  return "Something went wrong.";
}
