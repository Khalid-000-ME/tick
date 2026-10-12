"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, SignOut, UserCircle, Wallet } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { openAuth } from "@/lib/authSession";
import { useMyProfile } from "@/lib/profiles";
import type { useTickWallet } from "@/lib/useTickWallet";

type Wallet_ = ReturnType<typeof useTickWallet>;

/**
 * The header wallet control. Signed out it offers Log in and Sign up; signed in it opens a
 * small menu with the profile, the address and Log out.
 *
 * The button always opens the menu. It used to switch networks instead whenever the wallet
 * reported another chain, which left no way to reach the profile from a page whose header is
 * this button: the switch is an item inside the menu now.
 */
export function WalletMenu({ wallet, onCopied }: { wallet: Wallet_; onCopied?: (address: string) => void }) {
  const { status, account, connect, disconnect, switchChain, walletClient } = wallet;
  const { profile } = useMyProfile(account, walletClient);
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
    // With Privy configured, signing in has two front doors. Without it the only way in is
    // a browser wallet, so the single Connect button stays.
    if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
      return (
        <button className="terminal-wallet" type="button" onClick={() => void connect()}>
          <Wallet weight="bold" />Connect
        </button>
      );
    }
    return (
      <div className="auth-buttons">
        <button className="auth-login" type="button" onClick={() => openAuth("login")}>Log in</button>
        <button className="terminal-wallet" type="button" onClick={() => openAuth("signup")}>Sign up</button>
      </div>
    );
  }

  const short = `${account.slice(0, 6)}…${account.slice(-4)}`;
  // Your chosen name once you have one; the address until then.
  const shown = profile?.displayName || (profile?.username ? `@${profile.username}` : short);

  return (
    <div className="wallet-menu" ref={root}>
      <button
        className="terminal-wallet"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar avatar={profile?.avatar} seed={account} name={profile?.displayName || profile?.username} size={22} />
        {shown}
        {status === "wrong-chain" && <i className="wallet-warn" aria-label="Wrong network" />}
      </button>
      {open && (
        <div className="wallet-pop" role="menu">
          {profile?.username && <strong className="wallet-pop-name">@{profile.username}</strong>}
          {status === "wrong-chain" && (
            <button type="button" role="menuitem" className="is-warn" onClick={() => { setOpen(false); void switchChain(); }}>
              <Wallet weight="bold" />Switch to Monad testnet
            </button>
          )}
          <code>{account}</code>
          <Link href="/profile" role="menuitem" className="wallet-pop-link" onClick={() => setOpen(false)}>
            <UserCircle weight="bold" />
            {profile?.username ? "Profile and settings" : "Set up your profile"}
          </Link>
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
            <SignOut weight="bold" />Log out
          </button>
        </div>
      )}
    </div>
  );
}
