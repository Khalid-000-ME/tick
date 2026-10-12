"use client";

/**
 * The window's clock: a ring that drains, with the seconds in the pixel face. It is the one thing in
 * the arena that is always moving, so it is the thing the eye goes back to. It turns ember in the
 * last few seconds, when a stake can still be placed but not for long.
 */
export function CountdownRing({ seconds, of, urgent }: { seconds: number; of: number; urgent: boolean }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const left = Math.max(0, Math.min(1, seconds / of));
  return (
    <div className={`arena-ring ${urgent ? "is-urgent" : ""}`} role="timer" aria-label={`${seconds} seconds left in this window`}>
      <svg viewBox="0 0 112 112" width="112" height="112" aria-hidden="true">
        <circle className="arena-ring-track" cx="56" cy="56" r={r} fill="none" strokeWidth="6" />
        <circle
          className="arena-ring-run"
          cx="56"
          cy="56"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - left)}
          transform="rotate(-90 56 56)"
        />
      </svg>
      <strong>{String(seconds).padStart(2, "0")}</strong>
      <small>sec</small>
    </div>
  );
}
