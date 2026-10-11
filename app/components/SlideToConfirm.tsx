"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDoubleRight } from "@phosphor-icons/react";

/**
 * Slide the thumb to the end to confirm. A deliberate gesture a stray tap cannot make,
 * which is the point of choosing this mode in settings. Works with mouse, touch and pen,
 * and from the keyboard (focus it and press the right arrow or End), since a gesture
 * nobody can perform without a pointer would lock keyboard users out of staking.
 */
export function SlideToConfirm({ label, tone, onConfirm, disabled = false }: { label: string; tone: "up" | "down"; onConfirm: () => void; disabled?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const start = useRef(0);
  const THUMB = 44;
  // The travel available to the thumb, measured rather than read off the DOM during
  // render, which could be stale.
  const [max, setMax] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMax(Math.max(0, el.clientWidth - THUMB - 8)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function finish() {
    setDone(true);
    setX(max);
    onConfirm();
  }

  return (
    <div
      ref={track}
      className={`slide-confirm tone-${tone} ${done ? "is-done" : ""}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((x / (max || 1)) * 100)}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled || done) return;
        if (e.key === "ArrowRight" || e.key === "End") { e.preventDefault(); finish(); }
      }}
    >
      <span className="slide-fill" style={{ width: x + THUMB }} />
      <span className="slide-label">{done ? "Staking..." : label}</span>
      <span
        className="slide-thumb"
        style={{ transform: `translateX(${x}px)`, transition: dragging ? "none" : "transform 220ms cubic-bezier(.2,.9,.3,1)" }}
        onPointerDown={(e) => {
          if (disabled || done) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = e.clientX - x;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          setX(Math.min(max, Math.max(0, e.clientX - start.current)));
        }}
        onPointerUp={() => {
          if (!dragging) return;
          setDragging(false);
          // Most of the way counts; anything less springs back.
          if (max > 0 && x >= max * 0.9) finish();
          else setX(0);
        }}
      >
        <CaretDoubleRight weight="bold" />
      </span>
    </div>
  );
}
