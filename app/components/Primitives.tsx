"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────── smooth numeric interpolation ───────────────────────────
   The odds must glide, never jump. Interpolating on rAF keeps it on the compositor
   and lets us read velocity, which drives the directional tint. */

export function useGlide(target: number, stiffness = 0.12) {
  const [display, setDisplay] = useState({ value: target, velocity: 0 });
  const raf = useRef<number | null>(null);
  const current = useRef(target);

  useEffect(() => {
    const step = () => {
      const delta = target - current.current;
      if (Math.abs(delta) < 0.00015 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        current.current = target;
        setDisplay({ value: target, velocity: 0 });
        raf.current = null;
        return;
      }
      const velocity = delta * stiffness;
      current.current += velocity;
      setDisplay({ value: current.current, velocity });
      raf.current = requestAnimationFrame(step);
    };

    if (raf.current === null) raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
  }, [target, stiffness]);

  return display;
}

/** A state-backed clock keeps lock states current even when crowd updates pause. */
export function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* ─────────────────────────────── ultra-light iconography ───────────────────────────── */

export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M7 17 17 7M17 7H9M17 7v8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export function Spark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function LiveDot({ locked }: { locked: boolean }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span
        className={`absolute inset-0 rounded-full ${locked ? "" : "live-dot"}`}
        style={{ background: locked ? "var(--fg-faint)" : "var(--no)" }}
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full"
        style={{ background: locked ? "var(--fg-faint)" : "var(--no)" }} />
    </span>
  );
}

/* ──────────────────────────────── the hero readout ────────────────────────────────
   Tabular figures so the number never changes width as it ticks. */

export function OddsReadout({ probability, locked }: { probability: number; locked: boolean }) {
  const { value, velocity } = useGlide(probability);
  const pct = value * 100;
  const rising = velocity > 0.0004;
  const falling = velocity < -0.0004;

  const tint = locked
    ? "var(--fg-dim)"
    : rising
      ? "var(--yes)"
      : falling
        ? "var(--no)"
        : "var(--fg)";

  return (
    <div className="flex items-end gap-3">
      <div
        className="tnum text-[5.5rem] leading-[0.82] font-medium tracking-[-0.055em] transition-colors duration-700 md:text-[7rem]"
        style={{
          color: tint,
          transitionTimingFunction: "var(--ease-out-soft)",
        }}
      >
        {pct.toFixed(1)}
        <span className="text-[2.25rem] tracking-tight align-super md:text-[2.75rem]" style={{ color: "var(--fg-faint)" }}>
          %
        </span>
      </div>

      <div className="pb-3 flex flex-col gap-1">
        <span className="text-[0.6875rem] uppercase tracking-[0.18em]" style={{ color: "var(--fg-faint)" }}>
          YES chance
        </span>
        <span
          className="text-[0.6875rem] uppercase tracking-[0.18em] transition-opacity duration-500"
          style={{
            color: rising ? "var(--yes)" : falling ? "var(--no)" : "var(--fg-faint)",
            opacity: rising || falling ? 1 : 0.35,
          }}
        >
          {rising ? "rising" : falling ? "falling" : "steady"}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── pool split — the room, made visible ───────────────────────── */

export function PoolBar({
  poolYes,
  poolNo,
  locked,
}: {
  poolYes: number;
  poolNo: number;
  locked: boolean;
}) {
  const total = poolYes + poolNo || 1;
  const { value: share } = useGlide(poolYes / total);

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative h-[3px] w-full overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.07)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${share * 100}%`,
            background: locked ? "var(--fg-faint)" : "var(--yes)",
            boxShadow: locked ? "none" : "0 0 14px var(--yes-glow)",
            transform: "translateZ(0)",
          }}
        />
      </div>

      <div className="tnum flex items-center justify-between text-[0.6875rem] tracking-wide">
        <span style={{ color: locked ? "var(--fg-faint)" : "var(--yes)" }}>
          {Math.round(poolYes)} yes
        </span>
        <span style={{ color: "var(--fg-faint)" }}>{Math.round(total)} in pool</span>
        <span style={{ color: locked ? "var(--fg-faint)" : "var(--no)" }}>
          no {Math.round(poolNo)}
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────── countdown ──────────────────────────────── */

export function Countdown({
  opensAt,
  closesAt,
  lockLeadMs,
}: {
  opensAt: number;
  closesAt: number;
  lockLeadMs: number;
}) {
  const clock = useNow();
  const now = clock || opensAt;

  const span = Math.max(closesAt - opensAt, 1);
  const remaining = Math.max(closesAt - now, 0);
  const progress = Math.min(Math.max((now - opensAt) / span, 0), 1);
  const locked = remaining <= lockLeadMs;
  const seconds = remaining / 1000;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-9 w-9 shrink-0">
        <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke={locked ? "var(--no)" : "var(--fg)"}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 16}
            strokeDashoffset={2 * Math.PI * 16 * progress}
            opacity={locked ? 1 : 0.6}
          />
        </svg>
      </div>
      <div className="flex flex-col">
        <span className="tnum text-xl font-medium leading-none tracking-tight">
          {seconds.toFixed(1)}
          <span className="text-xs ml-0.5" style={{ color: "var(--fg-faint)" }}>s</span>
        </span>
        <span
          className="text-[0.625rem] uppercase tracking-[0.18em] mt-1"
          style={{ color: locked ? "var(--no)" : "var(--fg-faint)" }}
        >
          {locked ? "pool locked" : "open"}
        </span>
      </div>
    </div>
  );
}
