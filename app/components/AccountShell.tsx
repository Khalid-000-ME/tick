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
}: {
  active: "portfolio" | "fund" | "settlers";
  wallet: Wallet;
  children: React.ReactNode;
}) {
  const { theme, toggle } = useTheme();

  return (
    <div className="terminal-shell page-shell">
      <header className="terminal-header page-header">
        <Link href="/trade" className="terminal-back" aria-label="Back to the market"><ArrowLeft /></Link>
        <Brand />
        <nav className="terminal-nav page-nav" aria-label="Account">
          <Link href="/markets">Markets</Link>
          <Link href="/trade">Terminal</Link>
          <Link href="/portfolio" aria-current={active === "portfolio" ? "page" : undefined}>Portfolio</Link>
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
      <main className="page-main">{children}</main>
    </div>
  );
}
