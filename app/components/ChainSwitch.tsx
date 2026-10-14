"use client";

import { useChain } from "@/lib/useChain";

/**
 * Which chain the next stake executes on.
 *
 * The market is the same on both: the same Pyth feed, the same thirty-second grid, the same
 * parimutuel rules and the same 2% on profit. What changes is where the stake lands, who can settle
 * it and what the fee is paid in. Unlike the Testnet/Mainnet switch beside it, both sides of this
 * one are live, so it switches immediately rather than explaining itself.
 */
export function ChainSwitch() {
  const { chain, setChain } = useChain();

  return (
    <div className="mode-switch">
      <div className="mode-pills" role="group" aria-label="Execution chain">
        <button
          type="button"
          className={chain === "monad" ? "is-active" : ""}
          aria-pressed={chain === "monad"}
          onClick={() => setChain("monad")}
          title="Monad testnet"
        >
          Monad
        </button>
        <button
          type="button"
          className={chain === "solana" ? "is-active" : ""}
          aria-pressed={chain === "solana"}
          onClick={() => setChain("solana")}
          title="Solana devnet"
        >
          Solana
        </button>
      </div>
    </div>
  );
}
