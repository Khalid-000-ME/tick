/**
 * Locks the page's scrolling while a modal is open, and gives it back reliably.
 *
 * Each modal used to save body.style.overflow, set it to hidden and restore what it saved. That breaks
 * the moment two overlap, or a modal that is open but not drawn still holds its lock: the second one
 * "restores" hidden, and the page stays frozen with nothing on screen to explain it. A count fixes
 * this: the original value is remembered by the first lock and put back only when the last one lets go,
 * and each lock can be released only once.
 */
let count = 0;
let saved = "";

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (count === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count -= 1;
    if (count === 0) document.body.style.overflow = saved;
  };
}

/** For tests: how many locks are held. */
export const locksHeld = () => count;
