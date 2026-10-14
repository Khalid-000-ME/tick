"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useCreateWallet } from "@privy-io/react-auth/solana";
import { useChain } from "@/lib/useChain";

/**
 * Makes sure a signed-in account has a Solana wallet once it needs one.
 *
 * The same problem as WalletGuard on the Ethereum side: Privy only creates an embedded wallet on
 * login when the app's own dashboard setting says so, and ours reads
 * `embedded_wallet_config.solana.create_on_login = "off"`, so nobody arrives with one. The client
 * can still ask for it, with no UI of its own.
 *
 * Unlike the Ethereum guard this waits until the trader actually switches to Solana. A wallet they
 * may never use is not worth a key-generation round trip on every login, and asking at the moment
 * they pick the chain is also the moment the request makes sense to them.
 *
 * Harmless if the dashboard setting is turned back on: the wallet is already there and nothing is
 * asked for.
 */
export function SolanaWalletGuard() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { isSolana } = useChain();
  const asked = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || !isSolana) return;
    if (wallets.length > 0) { asked.current = false; return; }
    if (asked.current) return;
    asked.current = true;
    void createWallet().catch(() => {
      // Refused, which on this app means Solana wallets are switched off in the dashboard. The
      // terminal says so in words; retrying here would only spin.
      asked.current = true;
    });
  }, [ready, authenticated, isSolana, wallets.length, createWallet]);

  return null;
}
