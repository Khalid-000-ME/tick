"use client";

import { useState } from "react";
import Image from "next/image";
import { ASSET_ICONS, ticker } from "@/components/CardBanner";
import { DURATIONS } from "@/lib/chain/config";
import { FEEDS } from "@/lib/pyth";

/**
 * The owner's choice of market: which asset and how long a window. Choosing starts a new round, so the
 * scoreboard counts from that moment. It is one on-chain message (see lib/chatTags), so it costs a
 * transaction and everyone in the room sees it in the chat as well as in the arena.
 */
export function MarketPicker({
  current,
  onPick,
  onCancel,
}: {
  current?: { symbol: string; windowS: number };
  onPick: (symbol: string, windowS: number) => Promise<{ ok: boolean; message: string }>;
  onCancel?: () => void;
}) {
  const [symbol, setSymbol] = useState(current?.symbol ?? "BTC/USD");
  const [windowS, setWindowS] = useState(current?.windowS ?? 30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const same = current?.symbol === symbol && current.windowS === windowS;

  return (
    <div className="mp">
      <p className="mp-label">Market</p>
      <ul className="mp-grid">
        {FEEDS.map((f) => (
          <li key={f.symbol}>
            <button type="button" className={symbol === f.symbol ? "is-on" : ""} onClick={() => setSymbol(f.symbol)} aria-pressed={symbol === f.symbol}>
              {ASSET_ICONS[f.symbol] ? <Image src={ASSET_ICONS[f.symbol]} alt="" width={22} height={22} /> : <span className="mp-dot" />}
              <span><strong>{ticker(f.symbol)}</strong><small>{f.label}</small></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mp-label">Window</p>
      <div className="mp-windows" role="tablist" aria-label="Window length">
        {DURATIONS.map((d) => (
          <button key={d.seconds} type="button" role="tab" aria-selected={windowS === d.seconds} className={windowS === d.seconds ? "is-on" : ""} onClick={() => setWindowS(d.seconds)}>{d.label}</button>
        ))}
      </div>
      <div className="mp-foot">
        <p>Starts a new round: the scoreboard counts from the moment you set it.</p>
        <div>
          {onCancel && <button type="button" className="btn-ghost small" onClick={onCancel}>Cancel</button>}
          <button
            type="button"
            className="btn-solid small"
            disabled={busy || same}
            onClick={() => {
              setBusy(true);
              setNote(null);
              void onPick(symbol, windowS).then((r) => {
                setBusy(false);
                if (!r.ok) setNote(r.message);
              });
            }}
          >
            {busy ? "Setting…" : current ? "Start a new round" : "Start the room"}
          </button>
        </div>
      </div>
      {note && <p className="mp-note">{note}</p>}
    </div>
  );
}
