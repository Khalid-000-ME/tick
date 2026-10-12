"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Testnet or Mainnet, in the navbar.
 *
 * Only testnet is live: the contracts are deployed on Monad testnet and nowhere else, so
 * Mainnet cannot be switched to yet. Rather than a dead button or a mode that quietly keeps
 * showing testnet funds, tapping Mainnet says plainly that it is coming and that what you
 * see now is practice money. The switch is where the real mode will live: when mainnet
 * contracts exist, this is the one place that needs to change the active network.
 */
export function ModeSwitch() {
  const [note, setNote] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!note) return;
    const away = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setNote(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setNote(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [note]);

  return (
    <div className="mode-switch" ref={root}>
      <div className="mode-pills" role="group" aria-label="Network">
        <button type="button" className="is-active" aria-pressed="true" aria-expanded={note} onClick={() => setNote((v) => !v)}>
          <i aria-hidden="true" /> Testnet
        </button>
        <button type="button" aria-pressed="false" aria-expanded={note} onClick={() => setNote((v) => !v)}>
          Mainnet
        </button>
      </div>
      {note && (
        <div className="mode-note" role="status">
          <strong>Mainnet is coming.</strong>
          <p>Real USDC and card checkout launch there. You are on testnet, so everything here is practice money.</p>
        </div>
      )}
    </div>
  );
}
