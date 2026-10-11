"use client";

import { useState } from "react";

/** Stake sizes offered everywhere. Small on purpose: testers should feel free to tap. */
export const STAKE_PRESETS = [0.1, 0.25, 0.5, 1, 2, 3] as const;

/**
 * Presets plus a custom field. The field keeps what was typed as text, so "0." and "0.0"
 * survive mid-entry instead of collapsing to 0 on every keystroke; the parent only hears
 * numbers.
 */
export function AmountPicker({
  value,
  onChange,
  presets = STAKE_PRESETS,
  label = "Stake",
  compact = false,
}: {
  value: number;
  onChange: (n: number) => void;
  presets?: readonly number[];
  label?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  // Show what is being typed while it parses to the current value; otherwise the value.
  const shown = text !== null && Number(text) === value ? text : String(value);

  return (
    <div className={`amount-picker ${compact ? "is-compact" : ""}`}>
      <div className="amount-presets" role="group" aria-label={`${label} presets`}>
        {presets.map((p) => (
          <button key={p} type="button" className={value === p ? "is-active" : ""} onClick={() => { setText(null); onChange(p); }}>
            ${p}
          </button>
        ))}
      </div>
      <label className="amount-custom">
        <span>$</span>
        <input
          inputMode="decimal"
          aria-label={`${label} amount in USDC`}
          value={shown}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
            setText(t);
            const n = Number(t);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
      </label>
    </div>
  );
}
