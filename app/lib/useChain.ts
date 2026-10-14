"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Which chain a trade executes on.
 *
 * The same market exists on both: thirty-second windows, the same Pyth feed, the same parimutuel
 * rules. What differs is where the stake lands and who settles it. The choice is per browser rather
 * than per account, because it is a preference about execution, not something worth writing on
 * chain, and it has to be readable before React renders so the terminal never flips after paint.
 */
export type Chain = "monad" | "solana";

const KEY = "tick.chain";
const listeners = new Set<() => void>();
let current: Chain | null = null;

function read(): Chain {
  if (current) return current;
  try {
    const saved = localStorage.getItem(KEY);
    current = saved === "solana" ? "solana" : "monad";
  } catch {
    current = "monad";
  }
  return current;
}

export function setChain(next: Chain) {
  current = next;
  try { localStorage.setItem(KEY, next); } catch {}
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useChain() {
  // Monad on the server, so the first paint matches the markup; the real choice arrives on hydrate.
  const chain = useSyncExternalStore(subscribe, read, () => "monad" as Chain);
  const toggle = useCallback(() => setChain(chain === "monad" ? "solana" : "monad"), [chain]);
  return { chain, setChain, toggle, isSolana: chain === "solana" };
}

export const CHAIN_LABEL: Record<Chain, string> = {
  monad: "Monad testnet",
  solana: "Solana devnet",
};
