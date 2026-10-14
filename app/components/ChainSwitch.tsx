"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { CHAIN_LABEL, useChain, type Chain } from "@/lib/useChain";

/**
 * Which chain the next stake executes on.
 *
 * The market is the same on both: the same Pyth feed, the same thirty-second grid, the same
 * parimutuel rules and the same 2% on profit. What changes is where the stake lands, who can settle
 * it and what the fee is paid in. A menu rather than a pair of pills, because this is a choice of
 * venue that wants its full name on screen, not a two-state switch.
 */
const CHAINS: { id: Chain; name: string; note: string }[] = [
  { id: "monad", name: "Monad", note: "testnet · 10143" },
  { id: "solana", name: "Solana", note: "devnet" },
];

export function ChainSwitch() {
  const { chain, setChain } = useChain();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = CHAINS.find((c) => c.id === chain) ?? CHAINS[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="chain-switch" ref={root}>
      <button
        type="button"
        className="chain-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Execution chain: ${CHAIN_LABEL[chain]}`}
        onClick={() => setOpen((v) => !v)}
      >
        <i aria-hidden="true" data-chain={chain} />
        {current.name}
        <CaretDown weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <ul className="chain-menu" role="listbox" aria-label="Execution chain">
          {CHAINS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === chain}
                onClick={() => { setChain(c.id); setOpen(false); }}
              >
                <i aria-hidden="true" data-chain={c.id} />
                <span>
                  {c.name}
                  <small>{c.note}</small>
                </span>
                {c.id === chain && <Check weight="bold" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
