/**
 * How long a sign-in lasts, and how the sign-in dialog is opened from anywhere.
 *
 * Privy keeps a session in the browser until it expires, which meant opening Tick
 * dropped you straight into a signed-in app, whether or not you wanted that. Now a session
 * lasts for the browser session unless "Remember me" was ticked:
 *
 *   remember me ticked   a flag in localStorage keeps you signed in until you log out
 *   not ticked           a cookie with no expiry lives until the browser is closed, so the
 *                        session survives reloads and new tabs but not a restart
 *
 * A session that arrives with neither (one left over from before this existed) is ended on
 * the next load. The marks are written BEFORE any redirect (Google, X), because the page that
 * comes back is a fresh load that has to find them.
 */
export const REMEMBER_KEY = "tick.remember";
const SESSION_COOKIE = "tick_session";
const OPEN_EVENT = "tick:auth-open";

export type AuthMode = "login" | "signup";

/** Open the sign-in dialog. Safe to call from anywhere; the dialog is mounted once, in Providers. */
export function openAuth(mode: AuthMode = "login") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AuthMode>(OPEN_EVENT, { detail: mode }));
}

export function onAuthOpen(cb: (mode: AuthMode) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<AuthMode>).detail === "signup" ? "signup" : "login");
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}

/** Pure, so it can be tested without a browser: is this signed-in session one to end? */
export function shouldEndSession(s: { authenticated: boolean; remember: boolean; hasSession: boolean }): boolean {
  return s.authenticated && !s.remember && !s.hasSession;
}

export function readMarks(): { remember: boolean; hasSession: boolean } {
  let remember = false;
  try {
    remember = localStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    /* storage can be blocked; that reads as "not remembered", which is the safe side */
  }
  const hasSession = typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === `${SESSION_COOKIE}=1`);
  return { remember, hasSession };
}

/** Called the moment someone commits to a sign-in method, before anything redirects. */
export function markSignIn(remember: boolean) {
  try {
    if (remember) localStorage.setItem(REMEMBER_KEY, "1");
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* without storage there is simply nothing to remember */
  }
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  // No Max-Age or Expires: a session cookie, gone when the browser closes.
  document.cookie = `${SESSION_COOKIE}=1; path=/; SameSite=Lax${secure}`;
}

export function clearMarks() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* nothing to clear */
  }
  if (typeof document !== "undefined") document.cookie = `${SESSION_COOKIE}=; path=/; SameSite=Lax; Max-Age=0`;
}

/**
 * Whether a brand-new account should be walked through setting up its profile.
 * Set when someone commits to a method from the "Sign up" tab, before any redirect, because
 * Google and X leave the page and the page that comes back has to know. Cleared when the
 * walkthrough is finished or skipped.
 */
const ONBOARD_KEY = "tick.onboard.pending";

export function markOnboarding() {
  try {
    localStorage.setItem(ONBOARD_KEY, "1");
  } catch {
    /* no storage, no walkthrough: harmless */
  }
}

export function onboardingPending(): boolean {
  try {
    return localStorage.getItem(ONBOARD_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearOnboarding() {
  try {
    localStorage.removeItem(ONBOARD_KEY);
  } catch {
    /* nothing to clear */
  }
}
