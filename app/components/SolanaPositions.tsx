"use client";

import { useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { SOLANA } from "@/lib/solana/program";
import { useSolanaStake, useSolanaWallet } from "@/lib/solana/useSolanaStake";
import { useSolanaPositions, termsOf, type SolanaPosition } from "@/lib/solana/useSolanaPositions";

/**
 * The Solana half of the portfolio.
 *
 * Kept as its own section rather than merged into the Monad table, because the two are genuinely
 * different ledgers: different wallet, different token, different settlement. Pretending they are
 * one list would mean inventing a shared unit that does not exist.
 */
export function SolanaPositions() {
  const { address } = useSolanaWallet();
  const positions = useSolanaPositions(address);
  const { claim, busy } = useSolanaStake();
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!address) return null;
  if (positions.rows.length === 0) {
    return (
      <section className="sol-positions">
        <header><h2>Solana</h2><span className="sol-chip">devnet</span></header>
        <p className="sol-empty">No Solana stakes yet. Switch the chain in the navbar and call a window.</p>
      </section>
    );
  }

  async function collect(p: SolanaPosition) {
    setWorking(p.market);
    setNotice(null);
    const r = await claim(termsOf(p));
    setNotice(r.message);
    if (r.ok) positions.markClaimed(p.market, r.signature);
    await positions.refresh();
    setWorking(null);
  }

  const { stats } = positions;

  return (
    <section className="sol-positions">
      <header>
        <h2>Solana</h2>
        <span className="sol-chip">devnet</span>
        <a href={SOLANA.explorer("address", SOLANA.programId.toBase58())} target="_blank" rel="noreferrer">
          program <ArrowSquareOut weight="bold" />
        </a>
      </header>

      <div className="stat-row" aria-label="Solana summary">
        <div className="stat"><span>Record</span><strong>{stats.wins}W · {stats.losses}L</strong></div>
        <div className="stat"><span>Net result</span>
          <strong className={stats.net === 0 ? "" : stats.net > 0 ? "is-up" : "is-down"}>
            {stats.net >= 0 ? "+" : "−"}{Math.abs(stats.net).toFixed(2)}
          </strong>
        </div>
        <div className="stat"><span>Total staked</span><strong>{stats.staked.toFixed(2)}</strong></div>
      </div>

      {positions.claimable.length > 0 && (
        <p className="sol-claimable" role="status">
          {positions.claimable.length} window{positions.claimable.length === 1 ? "" : "s"} waiting to be collected.
        </p>
      )}
      {notice && <p className="sol-notice" role="status">{notice}</p>}

      <table className="sol-table">
        <thead>
          <tr><th>Market</th><th>Side</th><th>Stake</th><th>Result</th><th /></tr>
        </thead>
        <tbody>
          {positions.rows.map((p) => {
            const open = p.outcome === 0;
            const won = !open && (p.payout ?? 0) > p.amount;
            const refunded = p.outcome === 3;
            return (
              <tr key={`${p.market}-${p.side}`}>
                <td>
                  {p.symbol}
                  <small>{new Date(p.closesAt * 1000).toLocaleTimeString()}</small>
                </td>
                <td className={p.side === "ABOVE" ? "is-up" : "is-down"}>{p.side}</td>
                <td>{p.amount.toFixed(2)}</td>
                <td>
                  {open ? <span className="sol-pending">settling</span>
                    : refunded ? <span>refunded</span>
                    : won ? <span className="is-up">+{((p.payout ?? 0) - p.amount).toFixed(2)}</span>
                    : <span className="is-down">−{p.amount.toFixed(2)}</span>}
                </td>
                <td>
                  {!open && !p.claimed && (p.payout ?? 0) > 0 ? (
                    <button type="button" disabled={busy || working === p.market} onClick={() => void collect(p)}>
                      {working === p.market ? "Collecting…" : `Collect ${(p.payout ?? 0).toFixed(2)}`}
                    </button>
                  ) : p.claimed ? (
                    <span className="sol-done">collected</span>
                  ) : p.signature ? (
                    <a href={SOLANA.explorer("tx", p.signature)} target="_blank" rel="noreferrer">
                      tx <ArrowSquareOut weight="bold" />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
