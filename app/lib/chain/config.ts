import { defineChain } from "viem";
import deployed from "./deployed.json";

/** Monad testnet. Verified live: cast chain-id returns 10143. */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [deployed.rpc] },
  },
  blockExplorers: {
    default: { name: "Monadscan", url: deployed.explorer },
  },
  contracts: {
    // Canonical Multicall3, verified deployed on Monad testnet — batches the market
    // reads so a list page is one RPC round trip instead of two per market.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const CONTRACTS = {
  tick: deployed.contracts.Tick as `0x${string}`,
  usdc: deployed.contracts.USDC as `0x${string}`,
  pyth: deployed.contracts.Pyth as `0x${string}`,
  tickSports: deployed.contracts.TickSports as `0x${string}`,
  tickProfiles: deployed.contracts.TickProfiles as `0x${string}`,
} as const;

/** Lists feeds and receives fees. Cannot influence any outcome. */
export const ADMIN = deployed.admin as `0x${string}`;
/** Signs sports results for TickSports. Public by design: every attestation names it. */
export const ATTESTOR = deployed.attestor as `0x${string}`;
export const SHARDS = deployed.shards;

/**
 * How stale the on-chain price may be when a stake is accepted. THE residual
 * latency-arbitrage window, so it belongs on screen rather than buried in config.
 */
export const ACCEPT_MARGIN_S = deployed.acceptMarginSeconds;
/** Market windows are aligned to this grid, in seconds. */
export const WINDOW_S = deployed.windowSeconds;

/**
 * Window lengths a market can run for.
 *
 * The contract only asks that closesAt falls on its 30-second grid and has not passed, so
 * every multiple of 30 is a valid close — a "three minute market" is simply a close three
 * minutes out rather than thirty seconds out. No redeploy, no new feed config. Each
 * duration snaps to its OWN grid (a 2-minute close is always on a 120-second boundary) so
 * two people choosing the same duration land in the same pool instead of two lonely ones.
 */
/**
 * Durations share close instants by construction — a 5-minute boundary is also a 30s, 1m
 * and 2.5m boundary — so several cards often count down together. Staggering each onto
 * its own phase was tried and barely helped (4.3 to 4.7 distinct countdowns out of 8),
 * because the 30s market closes on EVERY grid boundary and so always collides with
 * whichever duration is next. What distinguishes these markets is not when they close but
 * when they OPENED, since that is what sets the strike, so the cards show the span.
 */
export const DURATIONS = [
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1m" },
  { seconds: 90, label: "1.5m" },
  { seconds: 120, label: "2m" },
  { seconds: 150, label: "2.5m" },
  { seconds: 180, label: "3m" },
  { seconds: 210, label: "3.5m" },
  { seconds: 300, label: "5m" },
] as const;

export type Duration = (typeof DURATIONS)[number];

/**
 * The close of the market a given duration is currently running.
 *
 * It is the next boundary of that duration, never the one after. Rolling forward to give
 * a card more time on the clock would put the market's OPENING instant in the future, and
 * a strike is Pyth's price at that instant — which has not been published yet, so the
 * market could not be priced at all. A pool you join is already running, as it is on any
 * parimutuel board: the window length names the market, and the clock shows what is
 * actually left of it.
 */
export function closeFor(seconds: number, now = Math.floor(Date.now() / 1000)): number {
  return (Math.floor(now / seconds) + 1) * seconds;
}
/** Settlement price must be published within this long after close. */
export const SETTLE_TOLERANCE_S = deployed.settleToleranceSeconds;
/** After this long with no settlement price, anyone may void and refund. */
export const SETTLE_WINDOW_S = deployed.settleWindowSeconds;

/** Circle USDC has 6 decimals. */
export const USD_DECIMALS = 6;
export const FEE_BPS = deployed.feeBps;

export const OUTCOME = { unresolved: 0, above: 1, below: 2, void: 3 } as const;

export function explorerTx(hash: string) {
  return `${deployed.explorer}/tx/${hash}`;
}

export function explorerAddress(addr: string) {
  return `${deployed.explorer}/address/${addr}`;
}

export function toUsd(raw: bigint): number {
  return Number(raw) / 10 ** USD_DECIMALS;
}

export function fromUsd(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USD_DECIMALS));
}

export function fmtUsd(raw: bigint, digits = 2): string {
  return toUsd(raw).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * The window grid. Markets exist only at these boundaries, which is what makes
 * independent stakers converge on the same pool instead of inventing their own and
 * each ending up alone on one side.
 */
export function nextWindowClose(now = Math.floor(Date.now() / 1000), window = WINDOW_S): number {
  return (Math.floor(now / window) + 1) * window;
}

export function secondsUntil(ts: number, now = Math.floor(Date.now() / 1000)): number {
  return ts - now;
}
