"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, SignOut, Wallet } from "@phosphor-icons/react";
import type { useTickWallet } from "@/lib/useTickWallet";

type Wallet_ = ReturnType<typeof useTickWallet>;

/**
 * The header wallet control. Disconnected it connects, on the wrong network it switches,
 * and once connected it opens a small menu with the full address and a Disconnect action.
 */
export function WalletMenu({ wallet, onCopied }: { wallet: Wallet_; onCopied?: (address: string) => void }) {
  const { status, account, connect, disconnect, switchChain } = wallet;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const connected = status !== "disconnected" && status !== "unsupported" && account;

  if (!connected) {
    return (
      <button className="terminal-wallet" type="button" onClick={() => void connect()}>
        <Wallet weight="bold" />Connect
      </button>
    );
  }

  const short = `${account.slice(0, 6)}…${account.slice(-4)}`;

  return (
    <div className="wallet-menu" ref={root}>
      <button
        className="terminal-wallet"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (status === "wrong-chain" ? void switchChain() : setOpen((v) => !v))}
      >
        <Wallet weight="bold" />
        {status === "wrong-chain" ? "Switch to Monad" : short}
      </button>
      {open && (
        <div className="wallet-pop" role="menu">
          <code>{account}</code>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard?.writeText(account);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              onCopied?.(account);
            }}
          >
            {copied ? <Check weight="bold" /> : <Copy weight="bold" />}
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            <SignOut weight="bold" />Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
