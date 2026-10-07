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
} as const;

/** Lists feeds and receives fees. Cannot influence any outcome. */
export const ADMIN = deployed.admin as `0x${string}`;
export const SHARDS = deployed.shards;

/**
 * How stale the on-chain price may be when a stake is accepted. THE residual
 * latency-arbitrage window, so it belongs on screen rather than buried in config.
 */
export const ACCEPT_MARGIN_S = deployed.acceptMarginSeconds;
/** Market windows are aligned to this grid, in seconds. */
export const WINDOW_S = deployed.windowSeconds;
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
