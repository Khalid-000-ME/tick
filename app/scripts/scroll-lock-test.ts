/** The scroll lock must survive overlapping modals and double releases, or a page can freeze for good. */
const body = { style: { overflow: "" } };
(globalThis as unknown as { document: unknown }).document = { body };
import { lockScroll, locksHeld } from "../lib/scrollLock";

let bad = 0;
const is = (what: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${JSON.stringify(got)}${ok ? "" : ` (wanted ${JSON.stringify(want)})`}`);
};

const a = lockScroll();
is("one lock hides overflow", body.style.overflow, "hidden");
a();
is("releasing restores it", body.style.overflow, "");

// The bug: two modals overlap and the second saw "hidden" as the value to restore.
const first = lockScroll();
const second = lockScroll();
first();
is("still locked while one modal is open", body.style.overflow, "hidden");
second();
is("unlocked once the last lets go", body.style.overflow, "");
is("no locks held", locksHeld(), 0);

// A modal that is torn down twice must not unlock someone else's lock.
const x = lockScroll();
const y = lockScroll();
x();
x();
is("a double release does not steal the other lock", body.style.overflow, "hidden");
y();
is("and the page is free after", body.style.overflow, "");

// A page that arrives with its own overflow value gets it back.
body.style.overflow = "scroll";
const z = lockScroll();
z();
is("an existing value is restored", body.style.overflow, "scroll");
process.exit(bad ? 1 : 0);
