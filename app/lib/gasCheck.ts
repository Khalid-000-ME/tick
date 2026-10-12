import { type PublicClient } from "viem";

/**
 * Monad charges the gas LIMIT up front and the RPC rejects a transaction outright
 * ("Missing or invalid parameters") when the balance is below limit x price. Checking for a
 * zero balance is not enough: a wallet with a few cents of MON passes that and then fails
 * with an error that says nothing about gas. Returns a user-facing message when the wallet
 * cannot cover the transactions about to be sent, or null when it can.
 */
export async function gasShortfall(
  pub: PublicClient,
  account: `0x${string}`,
  gasLimits: bigint[]
): Promise<string | null> {
  const [balance, price] = await Promise.all([pub.getBalance({ address: account }), pub.getGasPrice()]);
  const needed = (gasLimits.reduce((a, b) => a + b, 0n) * price * 125n) / 100n;
  if (balance >= needed) return null;
  // Never named in the chain's own token: a trader holds USDC, and the Fund page turns a
  // few cents of it into gas with one button.
  const left = needed > 0n ? Math.min(99, Math.floor((Number(balance) / Number(needed)) * 100)) : 0;
  return `Your gas tank is ${left}% of what this needs. Open Fund and tap Fill gas; it costs a few cents of USDC.`;
}
