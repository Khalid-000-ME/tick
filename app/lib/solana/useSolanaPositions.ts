"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  SOLANA, RULES, marketPda, readMarket, decodePosition, positionPda, payout as payoutOf, type Terms,
} from "./program";

/**
 * A trader's Solana positions.
 *
 * Same problem as the Monad side: the chain stores a market under the hash of its terms, so once a
 * window is gone the terms cannot be recovered from the chain alone. They are kept in localStorage
 * when the stake is made, and everything else — whether it settled, which side won, what it pays —
 * is read back from the program, never trusted from storage.
 */
export interface SolanaPosition {
  /** The market PDA, which is also the key. */
  market: string;
  feedIdHex: string;
  symbol: string;
  strike: string;
  expo: number;
  closesAt: number;
  side: "ABOVE" | "BELOW";
  amount: number;
  stakedAt: number;
  signature?: string;
  /** 0 unresolved, 1 above, 2 below, 3 void. Read from the Market account. */
  outcome: number;
  payout: number | null;
  settlePrice: number | null;
  claimed: boolean;
  claimSignature?: string;
}

const KEY = "tick.solana.positions.v1";
const MAX_KEPT = 300;

const load = (owner: string | null): SolanaPosition[] => {
  if (!owner || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${KEY}.${owner}`);
    return raw ? (JSON.parse(raw) as SolanaPosition[]) : [];
  } catch { return []; }
};

const save = (owner: string, rows: SolanaPosition[]) => {
  try { window.localStorage.setItem(`${KEY}.${owner}`, JSON.stringify(rows.slice(0, MAX_KEPT))); } catch {}
};

export const termsOf = (p: SolanaPosition): Terms => ({
  feedId: Uint8Array.from(Buffer.from(p.feedIdHex.replace(/^0x/, ""), "hex")),
  strike: BigInt(p.strike),
  expo: p.expo,
  closesAt: BigInt(p.closesAt),
});

export function useSolanaPositions(owner: string | null) {
  const [rows, setRows] = useState<SolanaPosition[]>([]);
  const connection = useMemo(() => new Connection(SOLANA.rpc, "confirmed"), []);
  const refreshing = useRef(false);

  useEffect(() => { setRows(load(owner)); }, [owner]);

  const write = useCallback((next: SolanaPosition[]) => {
    setRows(next);
    if (owner) save(owner, next);
  }, [owner]);

  /** Called the moment a stake is accepted, so the position shows before it settles. */
  const record = useCallback((t: Terms, side: "ABOVE" | "BELOW", amount: number, symbol: string, signature?: string) => {
    if (!owner) return;
    const market = marketPda(t).toBase58();
    const row: SolanaPosition = {
      market,
      feedIdHex: Buffer.from(t.feedId).toString("hex"),
      symbol,
      strike: t.strike.toString(),
      expo: t.expo,
      closesAt: Number(t.closesAt),
      side,
      amount,
      stakedAt: Math.floor(Date.now() / 1000),
      signature,
      outcome: 0,
      payout: null,
      settlePrice: null,
      claimed: false,
    };
    // One row per market per side: staking the same side twice adds to the first.
    const existing = rows.find((r) => r.market === market && r.side === side);
    write(existing
      ? rows.map((r) => (r === existing ? { ...r, amount: r.amount + amount, signature: signature ?? r.signature } : r))
      : [row, ...rows]);
  }, [owner, rows, write]);

  /** Reads the Market and Position accounts for anything unresolved, and fills in what settled. */
  const refresh = useCallback(async () => {
    if (!owner || refreshing.current || rows.length === 0) return;
    const open = rows.filter((r) => r.outcome === 0 || (!r.claimed && r.payout !== 0));
    if (open.length === 0) return;
    refreshing.current = true;
    try {
      const ownerKey = new PublicKey(owner);
      const updated = await Promise.all(rows.map(async (r) => {
        if (r.claimed) return r;
        const t = termsOf(r);
        const m = await readMarket(connection, t).catch(() => null);
        if (!m || !m.settled) return r;

        const outcome = m.void ? 3 : m.aboveWon ? 1 : 2;
        const won = !m.void && ((m.aboveWon && r.side === "ABOVE") || (!m.aboveWon && r.side === "BELOW"));
        const units = BigInt(Math.round(r.amount * 1e6));
        const owed = m.void ? units : won ? payoutOf(m, r.side === "ABOVE", units) : 0n;

        // Whether it has been collected is the Position account's business, not ours.
        const info = await connection.getAccountInfo(positionPda(marketPda(t), ownerKey)).catch(() => null);
        const claimed = info ? decodePosition(Buffer.from(info.data)).claimed : r.claimed;

        return {
          ...r,
          outcome,
          payout: Number(owed) / 1e6,
          settlePrice: Number(m.settlePrice) * 10 ** r.expo,
          claimed,
        };
      }));
      write(updated);
    } finally {
      refreshing.current = false;
    }
  }, [owner, rows, connection, write]);

  // Windows are thirty seconds, so this is frequent enough to feel live and light enough on an RPC
  // that serves everyone.
  useEffect(() => {
    if (!owner) return;
    const t = setInterval(() => { void refresh(); }, 6000);
    void refresh();
    return () => clearInterval(t);
  }, [owner, refresh]);

  const markClaimed = useCallback((market: string, signature?: string) => {
    write(rows.map((r) => (r.market === market ? { ...r, claimed: true, claimSignature: signature } : r)));
  }, [rows, write]);

  const stats = useMemo(() => {
    const settled = rows.filter((r) => r.outcome !== 0);
    const wins = settled.filter((r) => (r.payout ?? 0) > r.amount).length;
    const losses = settled.filter((r) => (r.payout ?? 0) === 0).length;
    const staked = rows.reduce((n, r) => n + r.amount, 0);
    const returned = settled.reduce((n, r) => n + (r.payout ?? 0), 0);
    const open = rows.filter((r) => r.outcome === 0).reduce((n, r) => n + r.amount, 0);
    return { wins, losses, staked, returned, open, net: returned - (staked - open) };
  }, [rows]);

  /** Anything settled, owed something, and not yet collected. */
  const claimable = useMemo(
    () => rows.filter((r) => r.outcome !== 0 && !r.claimed && (r.payout ?? 0) > 0),
    [rows],
  );

  return { rows, record, refresh, markClaimed, stats, claimable, settleWindow: RULES.settleWindowSeconds };
}
