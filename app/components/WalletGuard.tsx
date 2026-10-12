"use client";

import { useEffect, useRef } from "react";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { pickWallet } from "@/lib/pickWallet";

/**
 * Makes sure a signed-in account actually has a wallet.
 *
 * Privy only creates an embedded wallet on login when the app's own dashboard setting says
 * so, and ours is currently off (embedded_wallet_config.create_on_login), which is why newer
 * accounts arrived signed in with no wallet at all: no address, no profile name in the
 * header, nothing to stake with. The client can still create one, with no UI of its own, so
 * this asks for it once per sign-in.
 *
 * Harmless if the dashboard setting is turned back on: the wallet is already there and
 * nothing is asked for.
 */
export function WalletGuard() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const tried = useRef(false);

  useEffect(() => {
    if (!authenticated) {
      tried.current = false;
      return;
    }
    if (!ready || tried.current || pickWallet(wallets)) return;
    // A wallet that already exists can take a moment to appear in this list, and creating a
    // second one throws, so wait before concluding there is none.
    const t = setTimeout(() => {
      tried.current = true;
      void createWallet().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [ready, authenticated, wallets, createWallet]);

  return null;
}
