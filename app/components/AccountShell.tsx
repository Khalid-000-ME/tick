"use client";

import Link from "next/link";
import { ArrowLeft, Moon, Sun } from "@phosphor-icons/react";
import { WalletMenu } from "@/components/WalletMenu";
import { ModeSwitch } from "@/components/ModeSwitch";
import { Brand } from "@/components/Brand";
import { TickerStrip } from "@/components/TickerStrip";
import { useTheme } from "@/lib/useTheme";
import { useTickWallet } from "@/lib/useTickWallet";

type Wallet = ReturnType<typeof useTickWallet>;

export function AccountShell({
  active,
  wallet,
  children,
  strip,
  wide = false,
  app = false,
}: {
  active: "feed" | "markets" | "portfolio" | "fund" | "settlers" | "leaderboard" | "profile" | "groups";
  wallet: Wallet;
  children: React.ReactNode;
  /** Overrides the default strip (all markets), e.g. sports on a match page. */
  strip?: React.ReactNode;
  /** A page that lays out its own columns and needs the full width. */
  wide?: boolean;
  /** A page that is itself an app filling the screen under the header (the messenger). */
  app?: boolean;
}) {
  const { theme, toggle } = useTheme();

  return (
    <div className="terminal-shell page-shell">
      {/* The strip, when a page has one, is the very first thing on screen; the header is
          pinned under it, and the two scroll as one. */}
      <div className="page-top">
      {strip ?? <TickerStrip />}
      <header className="terminal-header page-header">
        <Link href="/feed" className="terminal-back" aria-label="Back to the feed"><ArrowLeft /></Link>
        <Brand />
        <nav className="terminal-nav page-nav" aria-label="Account">
          <Link href="/feed" aria-current={active === "feed" ? "page" : undefined}>Feed</Link>
          <Link href="/markets" aria-current={active === "markets" ? "page" : undefined}>Markets</Link>
          <Link href="/groups" aria-current={active === "groups" ? "page" : undefined}>Groups</Link>
          <Link href="/leaderboard" aria-current={active === "leaderboard" ? "page" : undefined}>Leaderboard</Link>
          <Link href="/portfolio" aria-current={active === "portfolio" ? "page" : undefined}>Portfolio</Link>
          <Link href="/fund" aria-current={active === "fund" ? "page" : undefined}>Fund</Link>
        </nav>
        <ModeSwitch />
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
      <main className={`page-main ${wide || app ? "is-wide" : ""} ${app ? "is-app" : ""}`}>{children}</main>
    </div>
  );
}
