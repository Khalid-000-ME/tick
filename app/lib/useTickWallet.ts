"use client";

import { useCallback, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type WalletClient } from "viem";
import { monadTestnet } from "@/lib/chain/config";
import { clearMarks, openAuth } from "@/lib/authSession";
import { pickWallet } from "@/lib/pickWallet";
import { useWallet, type WalletStatus, readableError } from "@/lib/useWallet";

/**
 * Picks Privy when it's configured and ready, falls back to the raw window.ethereum
 * flow (lib/useWallet.ts) otherwise — so the app works with NEXT_PUBLIC_PRIVY_APP_ID
 * unset (local dev, or before a Privy app id exists) and upgrades automatically once
 * one is set, with no change needed at the call site.
 *
 * Deliberately mirrors useWallet()'s return shape exactly, so a component written
 * against one works unchanged against the other.
 */
export function useTickWallet() {
  const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const raw = useWallet();
  const privy = usePrivyBackedWallet();
  return privyConfigured ? privy : raw;
}

function usePrivyBackedWallet() {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();

  // Prefer an embedded wallet; fall back to whatever the user connected (their own
  // MetaMask, etc.) so "sign in with an existing wallet" still works through Privy.
  const active = useMemo(
    () => pickWallet(wallets),
    [wallets]
  );

  const account = (active?.address as `0x${string}` | undefined) ?? null;
  const chainId = active ? chainIdFromCaip(active.chainId) : null;

  const status: WalletStatus = !ready
    ? "unsupported"
    : !authenticated || !active
      ? "disconnected"
      : chainId !== null && chainId !== monadTestnet.id
        ? "wrong-chain"
        : "ready";

  // Every sign-in entry point (header buttons, a stake button when signed out) opens the one
  // dialog in components/AuthDialog, which then drives Privy.
  const connect = useCallback(async () => {
    openAuth("login");
  }, []);

  // Logging out also forgets "Remember me", so the next visit starts signed out.
  const disconnect = useCallback(async () => {
    clearMarks();
    await logout();
  }, [logout]);

  // Privy's embedded wallet is created directly on the configured chain (see
  // app/providers.tsx), so there is normally nothing to switch. Kept for interface
  // parity with the raw-wallet flow, and in case a user connected an external wallet
  // on the wrong network.
  const switchChain = useCallback(async () => {
    if (!active) return;
    try {
      await active.switchChain(monadTestnet.id);
    } catch {
      /* surfaced to the user via Privy's own UI */
    }
  }, [active]);

  const walletClient: WalletClient | null = useMemo(() => {
    if (!active || !account) return null;
    // getEthereumProvider() returns an EIP-1193 provider exactly like window.ethereum,
    // so it slots into viem's `custom()` transport the same way the raw flow does.
    return createWalletClient({
      account,
      chain: monadTestnet,
      transport: custom({
        request: async (args) => {
          const provider = await active.getEthereumProvider();
          return provider.request(args);
        },
      }),
    });
  }, [active, account]);

  return {
    status,
    account,
    chainId,
    connect,
    switchChain,
    walletClient,
    busy: !ready,
    error: null as string | null,
    setError: () => {},
    /** Privy-specific: lets a "log out" affordance exist without a raw-wallet equivalent. */
    disconnect,
  };
}

function chainIdFromCaip(caip?: string): number | null {
  // Privy reports chainId as "eip155:10143"; window.ethereum reports a hex string
  // (handled separately in lib/useWallet.ts). Different shapes, same meaning.
  if (!caip) return null;
  const id = caip.split(":")[1];
  return id ? Number.parseInt(id, 10) : null;
}

export { readableError };
