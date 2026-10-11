"use client";

import Link from "next/link";
import { sportsStatus, useSportsPositions } from "@/lib/useSportsPositions";
import type { WalletClient } from "viem";

/**
 * Sports stakes in the portfolio: match results and in-play windows, with what each paid
 * and a claim button for anything owed. Read from this browser's record and from the
 * chain, so it does not wait on the event index, which covers price markets only.
 */
const LABEL = { open: "Open", awaiting: "Settling", won: "Won", lost: "Lost", refunded: "Refund" } as const;

export function SportsPortfolio({
  account,
  walletClient,
  onNotice,
}: {
  account: `0x${string}` | null;
  walletClient: WalletClient | null;
  onNotice: (m: string) => void;
}) {
  const { positions, claim, claiming } = useSportsPositions(account, walletClient);
  if (positions.length === 0) return null;

  return (
    <section className="sports-portfolio">
      <h2 className="section-title">Sports</h2>
      <div className="stake-table sp-table" role="table">
        <div className="stake-head" role="row">
          <span>Match</span><span>Pick</span><span>Staked</span><span>Result</span><span />
        </div>
        {positions.map((p) => {
          const s = sportsStatus(p);
          const owed = !p.claimed && (s === "won" || s === "refunded") && (p.payout ?? 0) > 0;
          return (
            <div key={`${p.id}:${p.side}`} className={`stake-row tone-${s === "refunded" ? "refunded" : s}`} role="row">
              <span className="stake-market">
                <Link href={`/sports/${p.espnId}`}><strong>{p.fixture}</strong></Link>
                <small>{p.league}{p.kind === "micro" ? " · in play" : ""}</small>
              </span>
              <span>{p.label}</span>
              <span className="mono">{p.amount.toFixed(2)}</span>
              <span className="stake-result">
                <b className="pill">{LABEL[s]}</b>
                <span className="mono pnl">
                  {s === "won" && p.payout !== null ? `+${(p.payout - p.amount).toFixed(2)}` : s === "lost" ? `-${p.amount.toFixed(2)}` : ""}
                </span>
              </span>
              <span className="stake-actions">
                {owed && (
                  <button type="button" className="btn-solid small" disabled={claiming === p.id} onClick={async () => onNotice(await claim(p.id))}>
                    {claiming === p.id ? "Claiming..." : `Claim ${p.payout!.toFixed(2)}`}
                  </button>
                )}
                {p.claimed && (s === "won" || s === "refunded") && <span className="match-meta">collected</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
