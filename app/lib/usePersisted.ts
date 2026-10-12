"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A preference kept in localStorage, readable during render without a hydration mismatch.
 *
 * The server and the first client render both see `null` (nothing chosen), so the markup
 * agrees; React then re-renders with the saved value. Components treat null as "use the
 * default", which lets CSS pick a different default per screen size (a news panel that is
 * open on a desktop and folded on a phone) while still honouring an explicit choice.
 */
const EVENT = "tick:persisted";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function usePersisted(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null
  );
  const set = useCallback(
    (next: string | null) => {
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        /* blocked storage: the choice just does not outlive this page */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key]
  );
  return [value, set];
}
