"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet, toUsd } from "@/lib/chain/config";
import { payoutForSide, toUnits } from "@/lib/chain/payout";

/**
 * Every sports stake this wallet holds, followed to money in hand.
 *
 * The event index only watches the price contract, and changing it costs an indexer
 * redeploy, so sports positions come from two places that need no index:
 *  - a local record of each stake placed here, which is the ONLY place an in-play window's
 *    opening scoreline survives, and settling that window needs it;
 *  - the chain itself, asked what this wallet holds in every fixture currently on the
 *    scoreboard, which finds match-result stakes placed from any device.
 * Outcomes and payouts are always read back from TickSports, never assumed.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });
const KEY = "tick.sports.v1";
const MASK = (1n << 128n) - 1n;

export interface SportsPosition {
  id: `0x${string}`;
  kind: "match" | "micro";
  espnId: string;
  eventId: `0x${string}`;
  closesAt: number;
  side: "HOME" | "AWAY";
  amount: number;
  /** What was backed, e.g. "Hull City" or "HOU, next 2m". */
  label: string;
  /** "EVE @ HUL" */
  fixture: string;
  league: string;
  micro?: { openHome: number; openAway: number };
  stakedAt: number;
  outcome: number;
  payout: number | null;
  claimed: boolean;
}

export type SportsStatus = "open" | "awaiting" | "won" | "lost" | "refunded";

export function sportsStatus(p: SportsPosition): SportsStatus {
  if (p.outcome === 0) return Math.floor(Date.now() / 1000) < p.closesAt ? "open" : "awaiting";
  if (p.outcome === 3) return "refunded";
  return (p.outcome === 1) === (p.side === "HOME") ? "won" : "lost";
}

const keyOf = (p: { id: string; side: string }) => `${p.id}:${p.side}`;

function load(account: string | null): SportsPosition[] {
  if (!account || typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(`${KEY}.${account.toLowerCase()}`) ?? "[]") as SportsPosition[];
  } catch {
    return [];
  }
}

function save(account: string | null, list: SportsPosition[]) {
  if (!account || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${KEY}.${account.toLowerCase()}`, JSON.stringify(list.slice(0, 300)));
  } catch {
    /* a full store costs history, not the session */
  }
}

interface Fixture {
  id: `0x${string}`;
  espnId: string;
  eventId: `0x${string}`;
  kickoff: number;
  league: string;
  completed: boolean;
  home: { short: string; abbr: string };
  away: { short: string; abbr: string };
}

export function useSportsPositions(account: `0x${string}` | null, walletClient: WalletClient | null) {
  const [positions, setPositions] = useState<SportsPosition[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const settleTried = useRef<Map<string, number>>(new Map());
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  // As in usePositions: derived from the account prop, so it is adjusted during render
  // rather than after a second commit.
  const [loadedFor, setLoadedFor] = useState(account);
  if (loadedFor !== account) {
    setLoadedFor(account);
    setPositions(load(account));
  }

  const update = useCallback((fn: (prev: SportsPosition[]) => SportsPosition[]) => {
    setPositions((prev) => {
      const next = fn(prev);
      save(accountRef.current, next);
      return next;
    });
  }, []);

  /** Called by the staking UI the moment a stake is accepted. */
  const record = useCallback(
    (p: Omit<SportsPosition, "outcome" | "payout" | "claimed" | "stakedAt">) => {
      update((prev) => {
        const k = keyOf(p);
        const hit = prev.find((x) => keyOf(x) === k);
        if (hit) return prev.map((x) => (x === hit ? { ...x, amount: x.amount + p.amount } : x));
        return [{ ...p, stakedAt: Math.floor(Date.now() / 1000), outcome: 0, payout: null, claimed: false }, ...prev];
      });
    },
    [update]
  );

  // Discovery and resolution, from the chain.
  useEffect(() => {
    if (!account) return;
    let off = false;

    async function pass() {
      // 0. Recent stakes from the contract's own logs: anything placed on another device,
      //    or before this browser kept a record.
      try {
        const h = (await (await fetch(`/api/sports/history?user=${account}`)).json()) as {
          stakes?: { marketId: `0x${string}`; eventId: `0x${string}`; closesAt: number; side: "HOME" | "AWAY"; amount: number }[];
        };
        if (!off && h.stakes?.length) {
          update((prev) => {
            const have = new Set(prev.map(keyOf));
            const merged = new Map<string, SportsPosition>();
            for (const x of h.stakes!) {
              const k = `${x.marketId}:${x.side}`;
              if (have.has(k)) continue;
              const cur = merged.get(k);
              if (cur) { cur.amount += x.amount; continue; }
              merged.set(k, {
                id: x.marketId, kind: "micro", espnId: "", eventId: x.eventId, closesAt: x.closesAt, side: x.side,
                amount: x.amount, label: `${x.side === "HOME" ? "Home" : "Away"} side`, fixture: "In-play window",
                league: new Date(x.closesAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                stakedAt: x.closesAt, outcome: 0, payout: null, claimed: false,
              });
            }
            return merged.size ? [...merged.values(), ...prev] : prev;
          });
        }
      } catch {
        /* the rest of the pass does not depend on it */
      }

      // 1. Stakes in any fixture on the scoreboard, whichever device placed them.
      let fixtures: Fixture[] = [];
      try {
        fixtures = (((await (await fetch("/api/sports/events")).json()) as { events?: Fixture[] }).events ?? []);
      } catch {
        /* resolution below still runs on what is already known */
      }
      if (fixtures.length) {
        const held = await pub.multicall({
          allowFailure: true,
          contracts: fixtures.map((f) => ({
            address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "stakeOf" as const, args: [f.id, account!] as const,
          })),
        });
        if (off) return;
        const found: SportsPosition[] = [];
        fixtures.forEach((f, i) => {
          const r = held[i];
          if (r?.status !== "success") return;
          const packed = r.result as bigint;
          for (const [side, units] of [["HOME", packed >> 128n], ["AWAY", packed & MASK]] as const) {
            if (units === 0n) continue;
            found.push({
              id: f.id, kind: "match", espnId: f.espnId, eventId: f.eventId, closesAt: f.kickoff, side,
              amount: toUsd(units), label: side === "HOME" ? f.home.short : f.away.short,
              fixture: `${f.away.abbr} @ ${f.home.abbr}`, league: f.league,
              stakedAt: f.kickoff, outcome: 0, payout: null, claimed: false,
            });
          }
        });
        if (found.length) {
          update((prev) => {
            // A stake first seen in the logs gets its proper match name once identified.
            prev = prev.map((x) => {
              const c = found.find((y) => keyOf(y) === keyOf(x));
              return c && !x.espnId ? { ...x, kind: "match", espnId: c.espnId, label: c.label, fixture: c.fixture, league: c.league } : x;
            });
            const have = new Set(prev.map(keyOf));
            const fresh = found.filter((x) => !have.has(keyOf(x)));
            // The chain's figure is the truth for amounts it still holds.
            const synced = prev.map((x) => {
              const c = found.find((y) => keyOf(y) === keyOf(x));
              return c ? { ...x, amount: c.amount } : x;
            });
            return fresh.length || synced.some((x, i) => x.amount !== prev[i].amount) ? [...fresh, ...synced] : prev;
          });
        }
      }

      // 2. Outcomes and payouts for everything known.
      const known = load(account);
      const open = known.filter((p) => !p.claimed);
      if (!open.length) return;
      const ids = [...new Set(open.map((p) => p.id))];
      const [settled, stakes] = await Promise.all([
        pub.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "settlements" as const, args: [id] as const })) }),
        pub.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "stakeOf" as const, args: [id, account!] as const })) }),
      ]);
      if (off) return;
      const byId = new Map(ids.map((id, i) => [id, { s: settled[i], k: stakes[i] }]));

      update((prev) =>
        prev.map((p) => {
          const row = byId.get(p.id);
          if (!row || row.s?.status !== "success") return p;
          const [outcome, , feeBps, totalHome, totalAway] = row.s.result as readonly [number, bigint, number, bigint, bigint];
          if (outcome === 0) return p;
          const stillHeld = row.k?.status === "success" ? (row.k.result as bigint) !== 0n : true;
          const payout = toUsd(payoutForSide(outcome, feeBps, totalHome, totalAway, p.side === "HOME" ? "ABOVE" : "BELOW", toUnits(p.amount)));
          return { ...p, outcome, payout, claimed: !stillHeld };
        })
      );

      // An in-play window is settled from the score caught at its close, and the server only
      // catches it when asked, so keep asking while one of ours is closing.
      const nowS = Math.floor(Date.now() / 1000);
      if (open.some((p) => p.kind === "micro" && p.closesAt > nowS - 30 && p.closesAt < nowS + 400)) {
        void fetch("/api/sports/micro").catch(() => {});
      }

      // 3. Settle what has closed and nobody has settled yet. The server attests from the
      //    public scoreboard; for an in-play window it needs the opening scoreline, which
      //    only this record kept.
      const now = Math.floor(Date.now() / 1000);
      for (const p of open) {
        const row = byId.get(p.id);
        const outcome = row?.s?.status === "success" ? (row.s.result as readonly [number, bigint, number, bigint, bigint])[0] : 0;
        if (outcome !== 0 || now < p.closesAt + 3 || !p.espnId) continue;
        if (Date.now() - (settleTried.current.get(p.id) ?? 0) < 60_000) continue;
        settleTried.current.set(p.id, Date.now());
        void fetch("/api/sports/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            p.kind === "micro" && p.micro
              ? { espnId: p.espnId, micro: { closesAt: p.closesAt, openHome: p.micro.openHome, openAway: p.micro.openAway } }
              : { espnId: p.espnId }
          ),
        }).catch(() => {});
      }
    }

    void pass();
    const t = setInterval(() => void pass(), 6000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [account, update]);

  const claim = useCallback(
    async (id: `0x${string}`): Promise<string> => {
      if (!walletClient || !account) return "Log in first.";
      setClaiming(id);
      try {
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "claim", args: [id],
          account, chain: monadTestnet, gas: 300_000n,
        });
        const rc = await pub.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") return "The claim reverted.";
        update((prev) => prev.map((p) => (p.id === id ? { ...p, claimed: true } : p)));
        return "Added to your sports balance. Withdraw it from the Fund page.";
      } catch (e) {
        return ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0];
      } finally {
        setClaiming(null);
      }
    },
    [walletClient, account, update]
  );

  return { positions, record, claim, claiming };
}
