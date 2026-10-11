"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "tick.theme";
const EVENT = "tick:theme";

/**
 * Light/dark, remembered per browser.
 *
 * The preference is written to <html data-theme> rather than to React state alone, so
 * the CSS can key off a single attribute and nothing has to thread a prop through the
 * tree. The initial value is applied by a blocking script in the root layout — reading it
 * here first would paint the light theme for a frame before swapping, which is the flash
 * everyone notices.
 *
 * Light is the default. A viewer's system setting is deliberately ignored; only an
 * explicit choice made with the toggle switches the theme.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  // Another tab switching theme should switch this one too.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
/** Light on the server, which is what the bootstrap script also falls back to. */
const readOnServer = (): Theme => "light";

export function useTheme() {
  // Subscribed to the attribute rather than mirrored into state, so every component
  // using this hook sees the same value the CSS is keyed off, at the same moment.
  const theme = useSyncExternalStore(subscribe, read, readOnServer);

  const apply = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* blocked storage costs the memory of the choice, not the choice itself */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const toggle = useCallback(() => apply(read() === "dark" ? "light" : "dark"), [apply]);

  return { theme, setTheme: apply, toggle };
}

/**
 * Runs before first paint, from the root layout. Inlined as a string because it has to
 * execute ahead of React hydration — anything that waits for the client bundle is already
 * a frame too late.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t!=="dark"&&t!=="light"){t="light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;
