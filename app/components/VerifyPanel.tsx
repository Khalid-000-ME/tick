"use client";

import { useEffect, useState } from "react";
import { Check, Warning, CircleNotch } from "@phosphor-icons/react";
import { TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, OUTCOME, toUsd } from "@/lib/chain/config";
import { readClient } from "@/lib/useWallet";
import type { Position } from "@/lib/usePositions";

/**
 * Recomputes a settled market's outcome from public data, in the user's own browser.
 *
 * The claim Tick makes is that nobody referees. This is the receipt for it: it fetches
 * Pyth's price when the window opened and the FIRST price Pyth published at or after the
 * close (the only one the contract will accept), reads what the contract stored, and checks
 * that they agree and that the outcome follows from the comparison. The server only relays
 * public Pyth data; the comparison happens here.
 */
interface Check {
  ok: boolean;
  title: string;
  detail: string;
}

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; checks: Check[]; settler: string | null; bountyUsd: number | null; latency: number | null };

const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL;

const fmt = (raw: bigint | number, expo: number) =>
  `$${(Number(raw) * 10 ** expo).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function VerifyPanel({ position }: { position: Position }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [chain, pyth, meta] = await Promise.all([
          readClient.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settlements", args: [position.id] }) as Promise<
            readonly [number, bigint, bigint, number, bigint, bigint]
          >,
          fetch(`/api/verify?feedId=${position.feedId}&closesAt=${position.closesAt}`).then(async (r) => {
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? "Pyth lookup failed");
            return j as { expo: number; open: { price: string; publishTime: number }; close: { price: string; publishTime: number; prevPublishTime: number } };
          }),
          loadSettler(position.id),
        ]);

        const [outcome, , settlePrice, , totalAbove, totalBelow] = chain;
        const strike = BigInt(position.strike);
        const expo = pyth.expo;
        const checks: Check[] = [];

        const open = BigInt(pyth.open.price);
        checks.push({
          ok: open === strike,
          title: "The strike is Pyth's price when the window opened",
          detail: `Strike ${fmt(strike, expo)}; Pyth published ${fmt(open, expo)} at ${stamp(pyth.open.publishTime)}.`,
        });

        if (outcome === OUTCOME.void) {
          const oneSided = totalAbove === 0n || totalBelow === 0n;
          checks.push({
            ok: oneSided,
            title: "The market voided because one side had no money",
            detail: oneSided
              ? `Pools were ABOVE ${toUsd(totalAbove).toFixed(2)} and BELOW ${toUsd(totalBelow).toFixed(2)} USDC: nobody to win from, so every stake is refundable.`
              : "Both sides had stakes, so this void is unexpected.",
          });
        } else {
          const close = BigInt(pyth.close.price);
          checks.push({
            ok: close === settlePrice,
            title: "The settlement price is Pyth's first price at or after the close",
            detail:
              `Contract stored ${fmt(settlePrice, expo)}; Pyth's first price after the close is ${fmt(close, expo)}, ` +
              `published ${pyth.close.publishTime - position.closesAt}s after it (the tick before was ${position.closesAt - pyth.close.prevPublishTime}s earlier).`,
          });
          const expected = settlePrice >= strike ? OUTCOME.above : OUTCOME.below;
          checks.push({
            ok: outcome === expected,
            title: "The outcome follows from price versus strike",
            detail: `${fmt(settlePrice, expo)} is ${settlePrice >= strike ? "at or above" : "below"} the ${fmt(strike, expo)} strike, so ${
              expected === OUTCOME.above ? "ABOVE" : "BELOW"
            } wins. The contract recorded ${outcome === OUTCOME.above ? "ABOVE" : "BELOW"}.`,
          });
        }

        if (!cancelled) {
          setState({
            phase: "done",
            checks,
            settler: meta?.settler ?? null,
            bountyUsd: meta?.bounty != null ? toUsd(BigInt(meta.bounty)) : null,
            latency: meta?.settledAt != null ? meta.settledAt - position.closesAt : null,
          });
        }
      } catch (e) {
        if (!cancelled) setState({ phase: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [position.id, position.feedId, position.closesAt, position.strike]);

  if (state.phase === "loading") {
    return (
      <div className="verify-panel">
        <p className="verify-loading"><CircleNotch className="spin" /> Fetching Pyth&apos;s prices and reading the contract…</p>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="verify-panel">
        <p className="verify-error">Could not verify: {state.message}</p>
      </div>
    );
  }

  const allOk = state.checks.every((c) => c.ok);
  return (
    <div className="verify-panel">
      <ul className="verify-list">
        {state.checks.map((c) => (
          <li key={c.title} className={c.ok ? "is-ok" : "is-bad"}>
            {c.ok ? <Check weight="bold" /> : <Warning weight="bold" />}
            <div>
              <strong>{c.title}</strong>
              <span>{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      {state.settler && (
        <p className="verify-meta">
          Settled by <code>{state.settler.slice(0, 6)}…{state.settler.slice(-4)}</code>
          {state.latency !== null && ` ${state.latency}s after the close`}
          {state.bountyUsd !== null && state.bountyUsd > 0 && `, earning a ${state.bountyUsd.toFixed(2)} USDC bounty`}. Anyone could have.
        </p>
      )}
      <p className="verify-foot">
        {allOk ? "Every check passed." : "A check did not match; treat this market as disputed."} Recomputed in your browser just now
        from Pyth and the contract, not from anything Tick told it.
      </p>
    </div>
  );
}

async function loadSettler(id: string): Promise<{ settler: string | null; bounty: string | null; settledAt: number | null } | null> {
  if (!INDEXER) return null;
  try {
    const res = await fetch(INDEXER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($id:String!){Market(where:{id:{_eq:$id}}){settler bounty settledAt}}`,
        variables: { id },
      }),
    });
    const json = (await res.json()) as { data?: { Market: { settler: string | null; bounty: string | null; settledAt: number | null }[] } };
    return json.data?.Market?.[0] ?? null;
  } catch {
    return null;
  }
}

function stamp(ts: number) {
  return new Date(ts * 1000).toISOString().slice(11, 19) + " UTC";
}
