"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The drag handle on the left edge of the trade panel, for making it wider or narrower.
 *
 * The width lives in a CSS variable on the layout (--rail-w), written straight to the element
 * while dragging so the page does not re-render on every pixel. It is remembered in
 * localStorage and restored on load. Keyboard users get the arrow keys, and a double click
 * puts it back to the default.
 */
const KEY = "tick.terminal.rail";
const MIN = 300;
const MAX = 560;
const DEFAULT = 360;
const clamp = (w: number) => Math.min(MAX, Math.max(MIN, Math.round(w)));

export function RailGrip() {
  const grip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [now, setNow] = useState(DEFAULT);

  const layout = () => grip.current?.closest<HTMLElement>(".terminal-main") ?? null;
  const apply = (w: number, save: boolean) => {
    const next = clamp(w);
    layout()?.style.setProperty("--rail-w", `${next}px`);
    setNow(next);
    if (save) {
      try {
        localStorage.setItem(KEY, String(next));
      } catch {
        /* the width just does not outlive this page */
      }
    }
  };

  useEffect(() => {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem(KEY));
    } catch {
      /* default width */
    }
    if (saved >= MIN && saved <= MAX) {
      layout()?.style.setProperty("--rail-w", `${saved}px`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the stored width into the handle's aria value, once, after the layout exists
      setNow(saved);
    }
  }, []);

  return (
    <div
      ref={grip}
      className="rail-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the trade panel"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={now}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: grip.current?.parentElement?.getBoundingClientRect().width ?? now };
        document.body.classList.add("is-resizing");
      }}
      onPointerMove={(e) => {
        // The panel is on the right, so dragging left makes it wider.
        if (drag.current) apply(drag.current.w + (drag.current.x - e.clientX), false);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        document.body.classList.remove("is-resizing");
        apply(now, true);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") { e.preventDefault(); apply(now + step, true); }
        else if (e.key === "ArrowRight") { e.preventDefault(); apply(now - step, true); }
        else if (e.key === "Home") { e.preventDefault(); apply(MIN, true); }
        else if (e.key === "End") { e.preventDefault(); apply(MAX, true); }
      }}
      onDoubleClick={() => apply(DEFAULT, true)}
      title="Drag to resize. Double click to reset."
    />
  );
}
