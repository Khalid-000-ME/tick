"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowSquareOut, Info } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { ShareActions } from "@/components/ShareActions";
import { VerifyPanel } from "@/components/VerifyPanel";
import { SportsPortfolio } from "@/components/SportsPortfolio";
import { useTickWallet } from "@/lib/useTickWallet";
import { useIndexedPositions } from "@/lib/useIndexedPositions";
import { isRefundPending, statusOf, usePositions, type Position, type PositionStatus } from "@/lib/usePositions";
import { SolanaPositions } from "@/components/SolanaPositions";
import { explorerTx } from "@/lib/chain/config";

type Filter = "all" | "wins" | "losses" | "refunds" | "open";

const LABEL: Record<PositionStatus, string> = {
  live: "Live",
  awaiting: "Settling",
  won: "Won",
  lost: "Lost",
  refunded: "Refund",
};

function matches(p: Position, f: Filter): boolean {
  const s = statusOf(p);
  switch (f) {
    case "wins": return s === "won";
    case "losses": return s === "lost";
    case "refunds": return s === "refunded";
    case "open": return s === "live" || s === "awaiting";
    default: return true;
  }
}

export function PortfolioView() {
  const wallet = useTickWallet();
  const { account, walletClient, status } = wallet;
  const local = usePositions(account, walletClient);
  const { claiming } = local;
  const indexed = useIndexedPositions(account);
  const [claimedHere, setClaimedHere] = useState<Set<string>>(new Set());

  // This browser's own record is fresher (it settles and reads back in seconds); the
  // indexer fills in everything it has not seen, such as stakes from another device.
  const positions = useMemo(() => {
    const seen = new Set(local.positions.map((p) => `${p.id}-${p.side}`));
    const extra = indexed.positions
      .filter((p) => !seen.has(`${p.id}-${p.side}`))
      .map((p) => (claimedHere.has(p.id) ? { ...p, claimed: true } : p));
    return [...local.positions, ...extra].sort((a, b) => b.stakedAt - a.stakedAt);
  }, [local.positions, indexed.positions, claimedHere]);

  const claim = async (id: `0x${string}`) => {
    const res = await local.claim(id);
    if (res.ok) setClaimedHere((prev) => new Set(prev).add(id));
    return res;
  };
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: positions.length, wins: 0, losses: 0, refunds: 0, open: 0 };
    for (const p of positions) {
      for (const f of ["wins", "losses", "refunds", "open"] as const) if (matches(p, f)) c[f]++;
    }
    return c;
  }, [positions]);

  const stats = useMemo(() => {
    const decided = positions.filter((p) => ["won", "lost"].includes(statusOf(p)));
    const wins = decided.filter((p) => statusOf(p) === "won").length;
    const net = decided.reduce((sum, p) => sum + ((p.payout ?? 0) - p.amount), 0);
    const staked = positions.reduce((sum, p) => sum + p.amount, 0);
    return { wins, losses: decided.length - wins, net, staked, rate: decided.length ? (wins / decided.length) * 100 : null };
  }, [positions]);

  const pendingRefunds = useMemo(() => positions.filter(isRefundPending), [positions]);
  const refundTotal = pendingRefunds.reduce((sum, p) => sum + p.amount, 0);
  const visible = positions.filter((p) => matches(p, filter));

  async function claimOne(p: Position) {
    const res = await claim(p.id);
    setMessage(res.message);
  }

  async function claimAll() {
    setClaimingAll(true);
    let ok = 0;
    for (const p of pendingRefunds) {
      const res = await claim(p.id);
      if (!res.ok) { setMessage(res.message); break; }
      ok++;
    }
    if (ok === pendingRefunds.length) setMessage(`Refunded ${ok} stake${ok === 1 ? "" : "s"} to your Tick balance.`);
    setClaimingAll(false);
  }

  function showRefunds() {
    setFilter("refunds");
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AccountShell active="portfolio" wallet={wallet}>
      <section className="page-intro">
        <h1>Portfolio</h1>
        <p>Every stake, and how it ended.</p>
      </section>

      {status !== "ready" || !account ? (
        <div className="page-empty">Log in to see your stakes.</div>
      ) : (
        <>
          <section className="stat-row" aria-label="Summary">
            <Stat label="Record" value={`${stats.wins}W · ${stats.losses}L`} />
            <Stat label="Win rate" value={stats.rate === null ? "-" : `${stats.rate.toFixed(0)}%`} />
            <Stat
              label="Net result"
              value={`${stats.net >= 0 ? "+" : "−"}${Math.abs(stats.net).toFixed(2)}`}
              tone={stats.net === 0 ? undefined : stats.net > 0 ? "up" : "down"}
            />
            <Stat label="Total staked" value={stats.staked.toFixed(2)} />
          </section>

          <div className="portfolio-share">
            <ShareActions address={account} net={stats.net} compact />
            <small>Your card shows what the chain says you made. Anyone can open it.</small>
          </div>

          {/* The Solana ledger is its own section: different wallet, different token, its own
              settlement. Merging the two totals would invent a shared unit that does not exist. */}
          <SolanaPositions />

          {pendingRefunds.length > 0 && (
            <section className="refund-bar" role="status">
              <div>
                <strong>
                  {pendingRefunds.length} refund{pendingRefunds.length === 1 ? "" : "s"} waiting · {refundTotal.toFixed(2)} USDC
                </strong>
                <span>These markets had no opposing stakes, so they were voided and your money is returned in full.</span>
              </div>
              <div className="refund-actions">
                <button type="button" className="btn-ghost" onClick={showRefunds}>Show them</button>
                <button type="button" className="btn-solid" disabled={claimingAll || claiming !== null} onClick={() => void claimAll()}>
                  {claimingAll ? "Claiming…" : "Claim all"}
                </button>
              </div>
            </section>
          )}

          {message && (
            <div className="page-note" role="status">
              <Info weight="bold" />
              <p>{message}</p>
              <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          <div ref={listRef} className="filter-row" role="tablist" aria-label="Filter stakes">
            {(
              [
                ["all", "All"],
                ["wins", "Wins"],
                ["losses", "Losses"],
                ["refunds", "Refunds"],
                ["open", "Open"],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? "is-active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
                <em>{counts[key]}</em>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="page-empty">
              {positions.length === 0 ? "No stakes yet. Take a side on the market and it will show up here." : "Nothing matches this filter."}
            </div>
          ) : (
            <div className="stake-table" role="table">
              <div className="stake-head" role="row">
                <span>Market</span>
                <span>Side</span>
                <span>Strike</span>
                <span>Settled at</span>
                <span>Staked</span>
                <span>Result</span>
                <span />
              </div>
              {visible.map((p) => {
                const s = statusOf(p);
                const pnl = p.payout === null ? null : p.payout - p.amount;
                const rowKey = `${p.id}-${p.side}`;
                return (
                  <div key={rowKey} className="stake-group">
                  <div className={`stake-row tone-${s}`} role="row">
                    <span className="stake-market">
                      <strong>{p.symbol}</strong>
                      <small>{new Date(p.stakedAt * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
                    </span>
                    <span className={p.side === "ABOVE" ? "side-up" : "side-down"}>{p.side}</span>
                    <span className="mono">${fmt(p.strikeNumber)}</span>
                    <span className="mono">{p.settlePrice === null ? "-" : `$${fmt(p.settlePrice)}`}</span>
                    <span className="mono">{p.amount.toFixed(2)}</span>
                    <span className="stake-result">
                      <b className="pill">{LABEL[s]}</b>
                      <span className="mono pnl">
                        {s === "refunded"
                          ? p.claimed ? "returned" : "pending"
                          // A loss is the stake, whether or not the payout has been read back
                          // yet: there is nothing to read, and a blank cell reads as a bug.
                          : s === "lost" ? `−${p.amount.toFixed(2)}`
                          : pnl === null ? "" : `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}`}
                        {s === "won" && p.payout !== null && <small>{p.payout.toFixed(2)} back, profit after the 2% fee</small>}
                        {s === "lost" && <small>your {p.amount.toFixed(2)} stake went to the other side</small>}
                      </span>
                    </span>
                    <span className="stake-actions">
                      {isRefundPending(p) && (
                        <button type="button" className="btn-solid small" disabled={claiming === p.id || claimingAll} onClick={() => void claimOne(p)}>
                          {claiming === p.id ? "Claiming…" : "Claim refund"}
                        </button>
                      )}
                      {p.outcome !== 0 && (
                        <button type="button" className="btn-ghost small" aria-expanded={verifying === rowKey} onClick={() => setVerifying(verifying === rowKey ? null : rowKey)}>
                          {verifying === rowKey ? "Hide" : "Verify"}
                        </button>
                      )}
                      {p.stakeHash && (
                        <a href={explorerTx(p.stakeHash)} target="_blank" rel="noreferrer" aria-label="View on the explorer"><ArrowSquareOut /></a>
                      )}
                    </span>
                  </div>
                  {verifying === rowKey && <VerifyPanel position={p} />}
                  </div>
                );
              })}
            </div>
          )}
          <SportsPortfolio account={account} walletClient={walletClient} onNotice={setMessage} />
          <p className="page-foot">{indexed.state === "ready" ? "History is read from the on-chain event index, so it follows this wallet to any device." : indexed.state === "error" ? "The history index is unreachable; showing this browser's record only." : "History is kept in this browser, up to the last 500 stakes."} Every result shown was read back from the contract.</p>
        </>
      )}
    </AccountShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : ""}>{value}</strong>
    </div>
  );
}

function fmt(value: number) {
  const big = Math.abs(value) > 1000;
  return value.toLocaleString("en-US", { minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 });
}
