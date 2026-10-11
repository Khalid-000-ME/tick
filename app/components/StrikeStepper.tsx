"use client";

import { useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { parseStrike, strikeLadder } from "@/lib/strikes";

/**
 * Pick the price a market is about. The arrows walk a short ladder of round levels around
 * the opening price, which is where other traders are likely to be; "custom" takes any
 * exact price. The opening price is the default and is labelled as such.
 *
 * Used on the board cards and in the terminal, so both offer the same choice.
 */
const fmt = (units: bigint, expo: number) => {
  const v = Number(units) * 10 ** expo;
  const d = v < 1 ? 5 : 2;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

export function StrikeStepper({
  open,
  value,
  expo,
  onChange,
  compact = false,
}: {
  /** The window's opening strike, in feed units. Null while it is still being fetched. */
  open: bigint | null;
  /** The chosen strike, or null for the opening one. */
  value: bigint | null;
  expo: number;
  onChange: (next: bigint | null) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ladder = useMemo(() => (open === null ? [] : strikeLadder(open, expo)), [open, expo]);

  if (open === null) return <span className="strike-stepper is-loading">...</span>;

  const current = value ?? open;
  const idx = ladder.findIndex((v) => v === current);
  const custom = idx === -1;
  // From a custom price, an arrow lands on the nearest ladder level in that direction.
  const step = (dir: 1 | -1) => {
    let next: bigint | undefined;
    if (!custom) next = ladder[idx + dir];
    else next = dir === 1 ? ladder.find((v) => v > current) : [...ladder].reverse().find((v) => v < current);
    if (next !== undefined) onChange(next === open ? null : next);
  };
  const atLow = !custom && idx === 0;
  const atHigh = !custom && idx === ladder.length - 1;

  function apply() {
    const parsed = parseStrike(draft, expo);
    if (parsed !== null) onChange(parsed === open ? null : parsed);
    setEditing(false);
    setDraft("");
  }

  return (
    <span className={`strike-stepper ${compact ? "is-compact" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Lower price" disabled={atLow} onClick={() => step(-1)}><CaretLeft weight="bold" /></button>
      {editing ? (
        <input
          autoFocus
          inputMode="decimal"
          placeholder={fmt(current, expo)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
            if (e.key === "Escape") { setEditing(false); setDraft(""); }
          }}
          onBlur={apply}
        />
      ) : (
        <button type="button" className="strike-value" title="Type an exact price" onClick={() => setEditing(true)}>
          ${fmt(current, expo)}
          <small>{current === open ? "open" : custom ? "custom" : "level"}</small>
        </button>
      )}
      <button type="button" aria-label="Higher price" disabled={atHigh} onClick={() => step(1)}><CaretRight weight="bold" /></button>
    </span>
  );
}
