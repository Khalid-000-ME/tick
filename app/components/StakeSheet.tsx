"use client";

import { useEffect } from "react";
import { SlideToConfirm } from "@/components/SlideToConfirm";

/**
 * The confirmation step before a stake, in whichever form the trader chose in settings:
 * a Confirm button, or a slide. ("One tap" never opens this at all.) Shared by the
 * terminal, the match page and the in-play windows, so the choice applies everywhere.
 */
export function StakeSheet({
  mode,
  tone,
  eyebrow,
  title,
  detail,
  confirmLabel,
  onCancel,
  onConfirm,
  onAlwaysTap,
}: {
  mode: "confirm" | "slide";
  tone: "up" | "down";
  eyebrow: string;
  title: React.ReactNode;
  detail: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** "Don't ask again": switches the saved setting to one tap. */
  onAlwaysTap: () => void;
}) {
  // Escape always cancels. Enter confirms only in Confirm mode: the slide exists so that a
  // stray key or tap cannot place a stake.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && mode === "confirm") onConfirm();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel, onConfirm, mode]);

  return (
    <div className="confirm-scrim" role="dialog" aria-modal="true" aria-labelledby="stake-sheet-title" onClick={onCancel}>
      <div className={`confirm-card tone-${tone}`} onClick={(e) => e.stopPropagation()}>
        <span className="confirm-eyebrow">{eyebrow}</span>
        <strong id="stake-sheet-title" className="confirm-title">{title}</strong>
        <p className="confirm-detail">{detail}</p>
        {mode === "slide" ? (
          <>
            <SlideToConfirm label={`Slide to ${confirmLabel.toLowerCase()}`} tone={tone} onConfirm={onConfirm} />
            <button type="button" className="confirm-cancel slide-cancel" onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <div className="confirm-actions">
            <button type="button" className="confirm-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" className="confirm-go" onClick={onConfirm} autoFocus>{confirmLabel}</button>
          </div>
        )}
        <button type="button" className="confirm-skip" onClick={onAlwaysTap}>Don&apos;t ask again, stake in one tap</button>
      </div>
    </div>
  );
}
