/**
 * Price levels a trader can pick instead of the opening price.
 *
 * Any strike is valid on chain (the feeds are listed with a strike step of 1), but every
 * distinct strike is its own pool. If each trader typed an arbitrary number, nobody would
 * meet a counterparty and every market would void and refund. So the choice offered first
 * is a short ladder of ROUND levels near the opening price: two people who both want
 * "a bit above" land on the same number and the same pool. A custom price stays available
 * for anyone who wants an exact one.
 */

/** The smallest 1, 2, 2.5 or 5 x 10^n that is at least `target`. */
function niceStep(target: number): number {
  const exp = Math.floor(Math.log10(target));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= target) return m * base;
  return 10 * base;
}

/**
 * Round levels around the opening strike, ascending, with the opening strike itself
 * included. Spacing is about 0.05% of the price, so a level is a move the market can
 * actually make inside a few minutes.
 *
 * @param open the window's opening strike, in feed units
 * @param expo the feed's exponent
 */
export function strikeLadder(open: bigint, expo: number, each = 2): bigint[] {
  const price = Number(open) * 10 ** expo;
  if (!(price > 0)) return [open];
  const step = niceStep(price * 0.0005);
  const stepUnits = BigInt(Math.max(1, Math.round(step * 10 ** -expo)));
  const base = (open / stepUnits) * stepUnits;
  const levels = new Set<bigint>([open]);
  const half = stepUnits / 2n;
  for (let k = -each; k <= each + 1; k++) {
    const v = base + BigInt(k) * stepUnits;
    // A round level a hair away from the opening price is a different pool that reads the
    // same on screen ($382.80 vs $382.79924), so the opening price stands in for it.
    const gap = v > open ? v - open : open - v;
    if (v > 0n && gap > half) levels.add(v);
  }
  return [...levels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Feed units from a price a person typed. Null when it is not a usable positive number. */
export function parseStrike(input: string, expo: number): bigint | null {
  const v = Number(input.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(v) || v <= 0) return null;
  return BigInt(Math.round(v * 10 ** -expo));
}
