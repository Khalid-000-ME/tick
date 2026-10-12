"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy, Check, XLogo } from "@phosphor-icons/react";

/**
 * Posting a result. The number is the reason for the post, so the text leads with it and the
 * link carries the card that proves it.
 */
export function ShareActions({ address, net, compact = false }: { address: string; net: number; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  // The server has no origin to render, so the link is relative in the server's HTML and
  // absolute once mounted. Read through useSyncExternalStore rather than branching on
  // `window` during render, which would hydrate to different HTML.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );
  const url = `${origin}/w/${address}`;
  const text = net >= 0 ? `Made $${net.toFixed(2)} calling thirty second markets on Tick.` : `Down $${Math.abs(net).toFixed(2)} calling thirty second markets on Tick. Running it back.`;

  return (
    <div className={`share-actions ${compact ? "is-compact" : ""}`}>
      <a className="share-x" href={`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
        <XLogo weight="bold" /> Post it
      </a>
      <button
        type="button"
        className="share-copy"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? <Check weight="bold" /> : <Copy weight="bold" />} {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}
