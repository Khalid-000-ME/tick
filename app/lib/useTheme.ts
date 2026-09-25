"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "tick.theme";

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
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "dark" || current === "light") {
      setTheme(current);
      return;
    }
    setTheme("light");
  }, []);

  const apply = useCallback((next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* blocked storage costs the memory of the choice, not the choice itself */
    }
  }, []);

  const toggle = useCallback(() => apply(theme === "dark" ? "light" : "dark"), [apply, theme]);

  return { theme, setTheme: apply, toggle };
}

/**
 * Runs before first paint, from the root layout. Inlined as a string because it has to
 * execute ahead of React hydration — anything that waits for the client bundle is already
 * a frame too late.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t!=="dark"&&t!=="light"){t="light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;
