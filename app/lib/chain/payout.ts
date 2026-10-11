import { OUTCOME } from "@/lib/chain/config";

/**
 * What ONE side of a market pays its holder, mirroring Tick.claim exactly.
 *
 * WHY NOT previewClaim. The contract's view is keyed by (market, user) and returns the
 * total across BOTH sides, because a claim settles the whole position in one call. The app
 * tracks a position per side, so handing every side the same figure credits a losing side
 * with the winning side's payout — anyone who took both sides of a market saw a profit on
 * the bet they lost, and the running total counted it twice.
 *
 * The arithmetic below is the contract's, in the same order, with the same integer
 * division, so the number on screen is the number claim() will credit.
 *
 * @param totalAbove Pool totals as STORED in the settlement — already net of the settler's
 *   bounty, which is what payouts are computed from.
 */
export function payoutForSide(
  outcome: number,
  feeBps: number,
  totalAbove: bigint,
  totalBelow: bigint,
  side: "ABOVE" | "BELOW",
  mine: bigint
): bigint {
  if (outcome === OUTCOME.unresolved || mine === 0n) return 0n;
  // A void returns each side's own stake, nothing more.
  if (outcome === OUTCOME.void) return mine;

  const won = (outcome === OUTCOME.above) === (side === "ABOVE");
  if (!won) return 0n;

  const win = side === "ABOVE" ? totalAbove : totalBelow;
  const lose = side === "ABOVE" ? totalBelow : totalAbove;
  if (win === 0n) return 0n;

  const profit = (lose * mine) / win;
  return mine + profit - (profit * BigInt(feeBps)) / 10_000n;
}

/** USDC units from the display amount a position records. */
export const toUnits = (usd: number): bigint => BigInt(Math.round(usd * 1e6));
