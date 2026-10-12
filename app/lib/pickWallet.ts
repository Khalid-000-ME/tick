/**
 * Which of Privy's connected wallets is "your" wallet.
 *
 * The embedded wallet if there is one. Otherwise only an external wallet that is LINKED to
 * the account. Privy also lists an extension that merely sits in the browser (MetaMask)
 * as connected, and falling back to wallets[0] meant a Google sign-in could end up sending
 * its transactions, and its network switch, to MetaMask while the embedded wallet was still
 * being created.
 */
export function pickWallet<T extends { walletClientType?: string; linked?: boolean }>(wallets: readonly T[]): T | undefined {
  // Embedded wallets are "privy", or "privy-v2" for the newer kind; matching only the first
  // hid every new embedded wallet and left signed-in users with no wallet at all.
  return wallets.find((w) => w.walletClientType === "privy" || w.walletClientType === "privy-v2") ?? wallets.find((w) => w.linked);
}
