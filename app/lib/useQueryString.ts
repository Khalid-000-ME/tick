"use client";

import { useSyncExternalStore } from "react";

/**
 * The current query string, read as what it is: state that lives outside React.
 *
 * The board links into the terminal and the match page carrying the exact market it was
 * showing, so those pages have to read `?feed=`, `?window=` and `?strike=`. useSearchParams
 * would opt the whole route out of server rendering and blank the page until hydration,
 * and copying location.search into state inside a mount effect costs a second render for
 * every visitor.
 *
 * useSyncExternalStore is the sanctioned third option. The server snapshot is empty, so
 * the markup renders with defaults; React then reads the real query on the client and
 * re-renders once, with no hydration mismatch because it knows the two differ by design.
 */
function subscribe(onChange: () => void) {
  // Only the back/forward buttons change the query without a full navigation.
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function useQueryString(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => ""
  );
}
