"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * In-site preferences. Kept on this device, so changing one is instant and costs no
 * transaction; the profile itself (name, avatar) is what lives on chain.
 *
 * Every component reading these sees a change at once, in this tab via a custom event and
 * in other tabs via the storage event.
 */
export type StakeMode = "tap" | "confirm" | "slide";

export interface Settings {
  /** How a tap on a side becomes a stake. */
  stakeMode: StakeMode;
  /** USDC pre-filled in every stake form. */
  defaultAmount: number;
  /** Window the terminal opens on, in seconds. */
  defaultWindow: number;
}

export const DEFAULT_SETTINGS: Settings = { stakeMode: "confirm", defaultAmount: 1, defaultWindow: 30 };

const KEY = "tick.settings.v1";
const EVENT = "tick:settings";

function read(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      stakeMode: raw.stakeMode === "tap" || raw.stakeMode === "slide" || raw.stakeMode === "confirm" ? raw.stakeMode : DEFAULT_SETTINGS.stakeMode,
      // Stake sizes moved to $0.10-$3; an older default above that is dropped, not carried over.
      defaultAmount: typeof raw.defaultAmount === "number" && raw.defaultAmount > 0 && raw.defaultAmount <= 3 ? raw.defaultAmount : DEFAULT_SETTINGS.defaultAmount,
      defaultWindow: typeof raw.defaultWindow === "number" && raw.defaultWindow >= 30 ? raw.defaultWindow : DEFAULT_SETTINGS.defaultWindow,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const sync = () => setSettings(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...read(), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* blocked storage: the change still applies for this page */
    }
    setSettings(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { settings, update };
}
