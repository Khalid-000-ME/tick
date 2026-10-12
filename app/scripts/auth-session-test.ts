// Stand-ins for the browser: a cookie jar that honours Max-Age=0 and a localStorage.
const jar = new Map<string, string>();
const stub = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
stub("document", {
  get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join("; "); },
  set cookie(raw: string) {
    const [pair, ...attrs] = raw.split("; ");
    const [k, v] = pair.split("=");
    if (attrs.some((a) => a === "Max-Age=0")) jar.delete(k); else jar.set(k, v);
    if (!attrs.some((a) => /^(Max-Age|Expires)=/.test(a))) lastWasSessionCookie = true; else lastWasSessionCookie = false;
  },
});
let lastWasSessionCookie = false;
const store = new Map<string, string>();
stub("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
stub("location", { protocol: "http:" });

import { clearMarks, markSignIn, readMarks, shouldEndSession } from "../lib/authSession.js";
let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? "✓" : "✗ FAILED"} ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

console.log("shouldEndSession truth table");
eq("signed out: nothing to end", shouldEndSession({ authenticated: false, remember: false, hasSession: false }), false);
eq("leftover session, no marks: END IT", shouldEndSession({ authenticated: true, remember: false, hasSession: false }), true);
eq("signed in this browser session: keep", shouldEndSession({ authenticated: true, remember: false, hasSession: true }), false);
eq("remembered: keep, even after a restart", shouldEndSession({ authenticated: true, remember: true, hasSession: false }), false);
eq("remembered and in session: keep", shouldEndSession({ authenticated: true, remember: true, hasSession: true }), false);

console.log("\nmarks");
eq("fresh browser: no marks", readMarks(), { remember: false, hasSession: false });
markSignIn(false);
eq("signed in without remember: session only", readMarks(), { remember: false, hasSession: true });
eq("that cookie has no expiry (dies with the browser)", lastWasSessionCookie, true);
markSignIn(true);
eq("signed in with remember: both", readMarks(), { remember: true, hasSession: true });
markSignIn(false);
eq("signing in again without remember revokes the old remember", readMarks(), { remember: false, hasSession: true });
markSignIn(true); clearMarks();
eq("logging out clears everything", readMarks(), { remember: false, hasSession: false });

console.log("\na browser restart (session cookie gone, remember kept)");
markSignIn(true); jar.clear();
eq("remembered user survives a restart", shouldEndSession({ authenticated: true, ...readMarks() }), false);
clearMarks(); markSignIn(false); jar.clear();
eq("un-remembered user is signed out after a restart", shouldEndSession({ authenticated: true, ...readMarks() }), true);

console.log(failed ? `\n${failed} FAILED` : "\nAll passed.");
process.exit(failed ? 1 : 0);
