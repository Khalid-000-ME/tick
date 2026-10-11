"use client";

import { AccountShell } from "@/components/AccountShell";
import { Leaderboard } from "@/components/Leaderboard";
import { useTickWallet } from "@/lib/useTickWallet";

export function LeaderboardView() {
  const wallet = useTickWallet();
  return (
    <AccountShell active="leaderboard" wallet={wallet}>
      <section className="page-intro">
        <h1>Leaderboard</h1>
        <p>Ranked by settled money: everything claims paid, minus everything staked.</p>
      </section>
      <Leaderboard you={wallet.account} />
    </AccountShell>
  );
}
