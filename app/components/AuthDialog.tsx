"use client";

import { useEffect, useRef, useState } from "react";
import { useCreateWallet, useLoginWithEmail, useLoginWithOAuth, useLoginWithPasskey, usePrivy, useSignupWithPasskey, useWallets } from "@privy-io/react-auth";
import { ArrowLeft, EnvelopeSimple, Fingerprint, GoogleLogo, Wallet, X, XLogo } from "@phosphor-icons/react";
import { pickWallet } from "@/lib/pickWallet";
import { clearMarks, markOnboarding, markSignIn, onAuthOpen, type AuthMode } from "@/lib/authSession";

/**
 * The one place anyone signs in or signs up. Every "Log in", "Sign up" and "Connect" in the
 * app opens this (see lib/authSession.openAuth), so there is a single flow.
 *
 * Privy still does the authentication; this is its own front door. Choosing a method first
 * records whether "Remember me" was ticked, because Google and X leave the page and the
 * page that comes back must already know (lib/authSession explains how a session ends).
 */
type Step = "choose" | "email" | "code";

function explain(e: unknown): string {
  const code = String((e as { privyErrorCode?: string })?.privyErrorCode ?? "");
  const msg = String((e as { message?: string })?.message ?? e ?? "");
  if (/invalid|incorrect|wrong/i.test(code + msg)) return "That code is not right. Try again.";
  if (/cancel|not.?allowed|abort|dismiss/i.test(code + msg)) return "Cancelled.";
  if (/email/i.test(code) && /invalid/i.test(msg)) return "Check that email address.";
  return "That did not work. Try again.";
}

export function AuthDialog() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const stuck = authenticated && !pickWallet(wallets);
  const stuckRef = useRef(false);
  useEffect(() => {
    stuckRef.current = stuck;
  }, [stuck]);
  const { initOAuth } = useLoginWithOAuth();
  const { createWallet } = useCreateWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { loginWithPasskey } = useLoginWithPasskey();
  const { signupWithPasskey } = useSignupWithPasskey();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [step, setStep] = useState<Step>("choose");
  const [remember, setRemember] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Opened from anywhere. Starts fresh each time, so a half-finished email step never lingers.
  useEffect(
    () =>
      onAuthOpen((m) => {
        // Signed in without a wallet: this dialog never shows for an authenticated user, so
        // the button would do nothing. Make the missing wallet; only if that fails is the
        // session cleared, so the dialog can open on a clean slate.
        if (stuckRef.current) {
          void createWallet().catch(() => {
            clearMarks();
            return logout().catch(() => {});
          });
        }
        setMode(m);
        setStep("choose");
        setEmail("");
        setCode("");
        setError(null);
        setBusy(null);
        setOpen(true);
      }),
    [logout, createWallet]
  );

  // Signing in closes the dialog. Adjusted during render so a later sign-out cannot find it
  // still "open" and pop it back up.
  const [wasAuthed, setWasAuthed] = useState(authenticated);
  if (wasAuthed !== authenticated) {
    setWasAuthed(authenticated);
    if (authenticated) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || authenticated) return null;

  async function run(label: string, fn: () => Promise<unknown>, { commit = true }: { commit?: boolean } = {}) {
    setError(null);
    setBusy(label);
    // The marks go down before the attempt, not after it succeeds: OAuth leaves the page.
    if (commit) {
      markSignIn(remember);
      if (mode === "signup") markOnboarding();
    }
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
      setBusy(null);
      return false;
    }
    setBusy(null);
    return true;
  }

  const signup = mode === "signup";
  const disabled = !ready || busy !== null;

  return (
    <div className="auth-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title" ref={panel}>
        <button type="button" className="auth-close" aria-label="Close" onClick={() => setOpen(false)}>
          <X weight="bold" />
        </button>

        <div className="auth-tabs" role="tablist" aria-label="Log in or sign up">
          {(["login", "signup"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-active" : ""} onClick={() => { setMode(m); setError(null); }}>
              {m === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <h2 id="auth-title">{signup ? "Create your account" : "Welcome back"}</h2>

        {step === "choose" && (
          <div className="auth-methods">
            <button type="button" disabled={disabled} onClick={() => void run("google", () => initOAuth({ provider: "google" }))}>
              <GoogleLogo weight="bold" /> Continue with Google
            </button>
            <button type="button" disabled={disabled} onClick={() => void run("x", () => initOAuth({ provider: "twitter" }))}>
              <XLogo weight="bold" /> Continue with X
            </button>
            <button type="button" disabled={disabled} onClick={() => { setError(null); setStep("email"); }}>
              <EnvelopeSimple weight="bold" /> Continue with email
            </button>
            <button type="button" disabled={disabled} onClick={() => void run("passkey", () => (signup ? signupWithPasskey() : loginWithPasskey()))}>
              <Fingerprint weight="bold" /> {signup ? "Create a passkey" : "Log in with a passkey"}
            </button>
            <button type="button" disabled={disabled} onClick={() => void run("wallet", async () => { setOpen(false); await login({ loginMethods: ["wallet"] }); })}>
              <Wallet weight="bold" /> Use a wallet
            </button>
          </div>
        )}

        {step === "email" && (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("email", () => sendCode({ email: email.trim() })).then((ok) => ok && setStep("code"));
            }}
          >
            <label>
              <span>Email</span>
              <input type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className="auth-primary" disabled={disabled || !email.trim()}>{busy === "email" ? "Sending..." : "Send code"}</button>
            <button type="button" className="auth-back" onClick={() => { setStep("choose"); setError(null); }}><ArrowLeft weight="bold" /> Back</button>
          </form>
        )}

        {step === "code" && (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("code", () => loginWithCode({ code: code.trim() }), { commit: true });
            }}
          >
            <p className="auth-sent">Code sent to <strong>{email}</strong></p>
            <label>
              <span>6-digit code</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button type="submit" className="auth-primary" disabled={disabled || code.length < 6}>{busy === "code" ? "Checking..." : signup ? "Create account" : "Log in"}</button>
            <button type="button" className="auth-back" onClick={() => { setStep("email"); setCode(""); setError(null); }}><ArrowLeft weight="bold" /> Use a different email</button>
          </form>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}

        <label className="auth-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember me</span>
        </label>

        <p className="auth-switch">
          {signup ? "Have an account?" : "New here?"}{" "}
          <button type="button" onClick={() => { setMode(signup ? "login" : "signup"); setError(null); }}>{signup ? "Log in" : "Sign up"}</button>
        </p>
      </div>
    </div>
  );
}
