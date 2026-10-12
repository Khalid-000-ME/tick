"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowSquareOut, CaretDown, X } from "@phosphor-icons/react";
import { ShareActions } from "@/components/ShareActions";
import { isRefundPending, statusOf, type Position, type PositionStatus } from "@/lib/usePositions";
import { explorerTx } from "@/lib/chain/config";

/**
 * The outcome of every window this wallet took a side in, bottom-right.
 *
 * A 30-second market that closes in silence reads as one that kept the money, so the
 * result has to arrive on its own rather than waiting to be looked up. The newest
 * resolution is raised to a card; everything before it stays as a running log, because
 * the point of a fast market is the record over many windows, not any single one.
 *
 * Every number here came back from the contract — payout is previewClaim(), outcome is
 * settlements(). Nothing is predicted from the last price on screen.
 */

const VERDICT: Record<PositionStatus, { label: string; tone: string }> = {
  live: { label: "Live", tone: "neutral" },
  awaiting: { label: "Settling", tone: "neutral" },
  won: { label: "Won", tone: "win" },
  lost: { label: "Lost", tone: "loss" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export function PositionsDock({
  positions,
  account,
  justResolved,
  dismiss,
  claim,
  claiming,
}: {
  positions: Position[];
  account?: string | null;
  justResolved: Position | null;
  dismiss: () => void;
  claim: (id: `0x${string}`) => Promise<{ ok: boolean; message: string }>;
  claiming: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (positions.length === 0) return null;

  const settled = positions.filter((p) => p.outcome !== 0);
  const wins = settled.filter((p) => {
    return statusOf(p) === "won";
  }).length;
  const losses = settled.filter((p) => statusOf(p) === "lost").length;
  // Realised only against settled markets: a live stake has no result to count yet.
  const net = settled.reduce((sum, p) => sum + ((p.payout ?? 0) - p.amount), 0);

  return (
    <div className="dock">
      {justResolved && <ResultCard position={justResolved} account={account} dismiss={dismiss} claim={claim} claiming={claiming} />}

      <div className={`dock-panel ${open ? "is-open" : ""}`}>
        <button className="dock-head" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="dock-title">Your windows</span>
          <span className="dock-record">
            <strong>{wins}W</strong>
            <em>·</em>
            <strong>{losses}L</strong>
          </span>
          <span className={`dock-net ${net >= 0 ? "is-up" : "is-down"}`}>
            {net >= 0 ? "+" : "−"}
            {Math.abs(net).toFixed(2)}
          </span>
          <CaretDown weight="bold" className="dock-caret" />
        </button>

        {open && (
          <ul className="dock-list">
            {positions.map((p) => {
              const status = statusOf(p);
              const pnl = p.payout === null ? null : p.payout - p.amount;
              return (
                <li key={`${p.id}-${p.side}`} className={`dock-row tone-${VERDICT[status].tone}`}>
                  <div className="dock-row-main">
                    <strong>{p.symbol}</strong>
                    <span className={p.side === "ABOVE" ? "side-up" : "side-down"}>{p.side}</span>
                    <small>${formatStrike(p.strikeNumber)}</small>
                  </div>
                  <div className="dock-row-meta">
                    <span className="dock-verdict">{VERDICT[status].label}</span>
                    <span className="dock-pnl">
                      {status === "refunded"
                        ? `${p.amount.toFixed(2)} back`
                        : status === "lost"
                          ? `−${p.amount.toFixed(2)}`
                          : pnl === null
                            ? `${p.amount.toFixed(2)} staked`
                            : `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}`}
                    </span>
                  </div>
                  {isRefundPending(p) && (
                    <button
                      type="button"
                      className="dock-claim"
                      disabled={claiming === p.id}
                      onClick={() => void claim(p.id)}
                    >
                      {claiming === p.id ? "Claiming…" : `Claim refund ${p.amount.toFixed(2)}`}
                    </button>
                  )}
                  {p.stakeHash && (
                    <a className="dock-link" href={explorerTx(p.stakeHash)} target="_blank" rel="noreferrer" aria-label="View stake on the explorer">
                      <ArrowSquareOut />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {open && (
          <Link className="dock-all" href="/portfolio">Full history →</Link>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  position,
  account,
  dismiss,
  claim,
  claiming,
}: {
  position: Position;
  account?: string | null;
  dismiss: () => void;
  claim: (id: `0x${string}`) => Promise<{ ok: boolean; message: string }>;
  claiming: string | null;
}) {
  const status = statusOf(position);
  const pnl = (position.payout ?? 0) - position.amount;

  const headline =
    status === "refunded"
      ? "Refunded"
      : status === "won"
        ? "You won"
        : "You lost";

  return (
    <div className={`result-card tone-${VERDICT[status].tone}`} role="status">
      <button className="result-dismiss" type="button" onClick={dismiss} aria-label="Dismiss"><X /></button>
      <span className="result-eyebrow">
        {position.symbol} · {position.side} ${formatStrike(position.strikeNumber)}
      </span>
      <strong className="result-headline">{headline}</strong>
      <span className="result-amount">
        {status === "refunded"
          ? `${position.amount.toFixed(2)} returned`
          : status === "lost"
            ? `−${position.amount.toFixed(2)}`
            : `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}`}{status === "refunded" ? "" : " USDC"}
      </span>
      {status === "lost" && (
        <span className="result-detail">Your {position.amount.toFixed(2)} USDC stake went to the side that called it right.</span>
      )}
      {position.settlePrice !== null && (
        <span className="result-detail">
          Settled at ${formatStrike(position.settlePrice)} against a ${formatStrike(position.strikeNumber)} strike.
        </span>
      )}
      {status === "refunded" && (
        <span className="result-detail">Only one side had money, so the market voided and every stake is returned.</span>
      )}
      {status === "won" && account && (
        // The win is the reason to post, so the share sits on the win itself rather than
        // somewhere a trader would have to go looking for it.
        <ShareActions address={account} net={pnl} compact />
      )}
      {isRefundPending(position) && (
        <button
          type="button"
          className="result-claim"
          disabled={claiming === position.id}
          onClick={() => void claim(position.id)}
        >
          {claiming === position.id ? "Claiming…" : `Claim refund ${position.amount.toFixed(2)} USDC`}
        </button>
      )}
      {status === "won" && (
        <span className="result-detail">
          {position.claimed ? "Credited to your Tick balance." : "Crediting to your Tick balance…"}
        </span>
      )}
    </div>
  );
}

function formatStrike(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value > 1000 ? 0 : 2,
    maximumFractionDigits: value > 1000 ? 0 : 2,
  });
}
