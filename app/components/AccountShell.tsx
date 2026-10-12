"use client";

import Link from "next/link";
import { ArrowLeft, Moon, Sun } from "@phosphor-icons/react";
import { WalletMenu } from "@/components/WalletMenu";
import { Brand } from "@/components/Brand";
import { useTheme } from "@/lib/useTheme";
import { useTickWallet } from "@/lib/useTickWallet";

type Wallet = ReturnType<typeof useTickWallet>;

export function AccountShell({
  active,
  wallet,
  children,
  strip,
}: {
  active: "markets" | "portfolio" | "fund" | "settlers" | "leaderboard" | "profile";
  wallet: Wallet;
  children: React.ReactNode;
  /** A running strip under the header, as the board and terminal have. */
  strip?: React.ReactNode;
}) {
  const { theme, toggle } = useTheme();

  return (
    <div className="terminal-shell page-shell">
      {/* The strip, when a page has one, is the very first thing on screen; the header is
          pinned under it, and the two scroll as one. */}
      <div className="page-top">
      {strip}
      <header className="terminal-header page-header">
        <Link href="/markets" className="terminal-back" aria-label="Back to the markets"><ArrowLeft /></Link>
        <Brand />
        <nav className="terminal-nav page-nav" aria-label="Account">
          <Link href="/markets" aria-current={active === "markets" ? "page" : undefined}>Markets</Link>
          <Link href="/portfolio" aria-current={active === "portfolio" ? "page" : undefined}>Portfolio</Link>
          <Link href="/leaderboard" aria-current={active === "leaderboard" ? "page" : undefined}>Leaderboard</Link>
          <Link href="/fund" aria-current={active === "fund" ? "page" : undefined}>Fund</Link>
        </nav>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun weight="bold" /> : <Moon weight="bold" />}
        </button>
        <WalletMenu wallet={wallet} />
      </header>
      </div>
      <main className="page-main">{children}</main>
    </div>
  );
}
