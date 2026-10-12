"use client";

import { useEffect } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { AuthDialog } from "@/components/AuthDialog";
import { Onboarding } from "@/components/Onboarding";
import { WelcomeGift } from "@/components/WelcomeGift";
import { clearMarks, readMarks, shouldEndSession } from "@/lib/authSession";
import { monadTestnet } from "@/lib/chain/config";

/**
 * Privy: email/passkey login -> an embedded wallet on Monad testnet, no extension
 * required. Monad is an explicitly supported chain per Privy's own docs; passing our
 * existing `monadTestnet` (defined with viem's defineChain) as both defaultChain and
 * the sole supportedChains entry is Privy's documented way to configure a chain that
 * isn't in their built-in list.
 *
 * NEXT_PUBLIC_PRIVY_APP_ID is intentionally public — Privy app IDs are not secrets,
 * unlike OPERATOR_PK and PYTH_API_KEY which stay server-only. Get one at
 * https://dashboard.privy.io, then set it in app/.env.local.
 *
 * `createOnLogin: "users-without-wallets"` means someone who already has a wallet
 * connects that instead of getting a redundant embedded one — important for the
 * "show which wallet actually signed" rule in FRONTEND_BRIEF.md §4.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // No app id configured: render children directly rather than a broken provider.
  // useTickWallet() falls back to the raw-wallet flow in this case (see that file).
  if (!appId) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "NEXT_PUBLIC_PRIVY_APP_ID is not set. Privy login is disabled and the app " +
          "will fall back to raw window.ethereum. Get an app id at dashboard.privy.io " +
          "and set it in app/.env.local to enable email/passkey onboarding."
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "light",
          walletChainType: "ethereum-only",
        },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        embeddedWallets: {
          // No confirmation modal on every transaction. The embedded wallet signs
          // silently, which is what makes a stake one tap. External wallets such as
          // MetaMask still prompt, because their extension owns that UI.
          showWalletUIs: false,
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        // Each social method must also be switched on under Login methods in the Privy
        // dashboard, or Privy rejects it. Any of these can be linked to one account later
        // from the profile page, so a trader is one person across all of them.
        loginMethods: ["google", "passkey", "email", "twitter", "wallet"],
      }}
    >
      <SessionGuard />
      <AuthDialog />
      <WelcomeGift />
      <Onboarding />
      {children}
    </PrivyProvider>
  );
}

/**
 * Ends a signed-in session that nobody asked to keep. Privy restores its session on every
 * load, so without this opening Tick put you straight into a signed-in app. A session is
 * kept only if it was started in this browser session or with "Remember me"
 * (lib/authSession); anything else, such as one left over from before, is ended here.
 */
function SessionGuard() {
  const { ready, authenticated, logout } = usePrivy();
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (shouldEndSession({ authenticated, ...readMarks() })) {
      clearMarks();
      void logout();
    }
  }, [ready, authenticated, logout]);
  return null;
}
