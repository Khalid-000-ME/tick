"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, DiceFive, UploadSimple, X } from "@phosphor-icons/react";
import { AVATAR_STYLES, Avatar, genAvatar, type AvatarStyle } from "@/components/Avatar";
import { clearOnboarding, onboardingPending } from "@/lib/authSession";
import { DURATIONS } from "@/lib/chain/config";
import { useMyProfile } from "@/lib/profiles";
import { useAvatarUpload } from "@/lib/useAvatarUpload";
import { useSettings, type StakeMode } from "@/lib/useSettings";
import { useTheme } from "@/lib/useTheme";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * A short walkthrough for someone who has just signed up: a face, a name, how they like to
 * trade, and a look. Every step can be skipped, and the whole thing can be left at any time;
 * nothing is required to start trading.
 *
 * Preferences apply the moment they are chosen (they live on this device). The profile is
 * saved on chain once, on the last step, and only when there is a username: the contract
 * keys a profile by its unique username.
 */
const STEPS = ["photo", "name", "trade", "finish"] as const;
const MODES: { id: StakeMode; title: string; detail: string }[] = [
  { id: "tap", title: "One tap", detail: "Tap a side. You are in." },
  { id: "confirm", title: "Confirm", detail: "Review, then confirm." },
  { id: "slide", title: "Slide", detail: "Slide to stake." },
];
const AMOUNTS = [0.1, 0.25, 0.5, 1, 2, 3];
const WINDOWS = DURATIONS.filter((d) => [30, 60, 120, 300].includes(d.seconds));

export function Onboarding() {
  const { ready, authenticated } = usePrivy();
  const wallet = useTickWallet();
  const { account, walletClient } = wallet;
  const { profile, save, saving, available } = useMyProfile(account, walletClient);
  const [closed, setClosed] = useState(false);

  // Only a person who chose "Sign up" and has no username yet. Someone who signs up with a
  // method they already used has a profile, so there is nothing to set up.
  const hasProfile = Boolean(profile?.username);
  useEffect(() => {
    if (ready && authenticated && hasProfile && onboardingPending()) clearOnboarding();
  }, [ready, authenticated, hasProfile]);

  if (closed || !ready || !authenticated || !account || !profile || hasProfile || !onboardingPending()) return null;

  function leave() {
    clearOnboarding();
    setClosed(true);
  }

  return <Walkthrough account={account} save={save} saving={saving} available={available} onLeave={leave} />;
}

function Walkthrough({
  account,
  save,
  saving,
  available,
  onLeave,
}: {
  account: `0x${string}`;
  save: (p: { username: string; displayName: string; avatar: string }) => Promise<{ ok: boolean; message: string }>;
  saving: boolean;
  available: (u: string) => Promise<boolean>;
  onLeave: () => void;
}) {
  const [step, setStep] = useState(0);
  const [avatar, setAvatar] = useState(genAvatar("beam", account));
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [check, setCheck] = useState<{ name: string; free: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { settings, update } = useSettings();
  const { theme, toggle } = useTheme();
  const { upload, uploading, note: uploadNote } = useAvatarUpload(setAvatar);

  const validFormat = /^[a-z0-9_]{3,20}$/.test(username);
  useEffect(() => {
    if (!validFormat) return;
    let off = false;
    const t = setTimeout(() => void available(username).then((free) => { if (!off) setCheck({ name: username, free }); }), 350);
    return () => { off = true; clearTimeout(t); };
  }, [username, validFormat, available]);
  const free: boolean | null = !username ? null : !validFormat ? false : check?.name === username ? check.free : null;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onLeave();
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onLeave]);

  const style = avatar.startsWith("gen:") ? (avatar.split(":")[1] as AvatarStyle) : null;
  const seed = avatar.split(":")[2] || account;
  const last = step === STEPS.length - 1;
  const canSave = Boolean(username) && free === true;

  async function finish() {
    setError(null);
    if (!canSave) return onLeave();
    const res = await save({ username, displayName, avatar });
    if (res.ok) onLeave();
    else setError(res.message);
  }

  return (
    <div className="auth-backdrop">
      <div className="auth-panel ob-panel" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <button type="button" className="auth-close" aria-label="Close" onClick={onLeave}><X weight="bold" /></button>
        <div className="ob-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => <i key={s} className={i <= step ? "is-on" : ""} />)}
        </div>

        <div className="ob-body" key={STEPS[step]}>
          {step === 0 && (
            <>
              <h2 id="ob-title">Add a face.</h2>
              <p className="ob-sub">Upload a photo or pick a pattern.</p>
              <div className="ob-avatar"><Avatar avatar={avatar} seed={account} name={displayName || username} size={104} /></div>
              <div className="ob-row">
                <label className="ob-btn">
                  <UploadSimple weight="bold" /> {uploading ? "Uploading..." : "Upload photo"}
                  <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                </label>
              </div>
              {uploadNote && <p className="auth-error">{uploadNote}</p>}
              <div className="ob-styles">
                {AVATAR_STYLES.map((s) => (
                  <button key={s} type="button" aria-label={`${s} pattern`} className={style === s ? "is-active" : ""} onClick={() => setAvatar(genAvatar(s, seed))}>
                    <Avatar avatar={genAvatar(s, seed)} seed={account} size={40} />
                  </button>
                ))}
                <button type="button" aria-label="New pattern" onClick={() => setAvatar(genAvatar(style ?? "beam", Math.random().toString(36).slice(2, 10)))}><DiceFive weight="bold" /></button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 id="ob-title">What should we call you?</h2>
              <p className="ob-sub">Shown on the leaderboard. Saved on chain.</p>
              <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
                <label>
                  <span>Username</span>
                  <input value={username} maxLength={20} placeholder="your_name" autoComplete="off" onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} />
                  {username && <small className={`ob-hint ${free ? "is-ok" : free === false ? "is-bad" : ""}`}>{free === null ? "Checking..." : free ? "Available" : validFormat ? "Taken" : "3 to 20 of a-z, 0-9, _"}</small>}
                </label>
                <label>
                  <span>Display name</span>
                  <input value={displayName} maxLength={40} placeholder="How you appear" onChange={(e) => setDisplayName(e.target.value)} />
                </label>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h2 id="ob-title">How do you like to trade?</h2>
              <p className="ob-sub">Change any of this later in Profile.</p>
              <div className="ob-modes">
                {MODES.map((m) => (
                  <button key={m.id} type="button" className={settings.stakeMode === m.id ? "is-active" : ""} onClick={() => update({ stakeMode: m.id })}>
                    <strong>{m.title}</strong><span>{m.detail}</span>
                  </button>
                ))}
              </div>
              <p className="ob-label">Usual stake</p>
              <div className="ob-chips">
                {AMOUNTS.map((a) => <button key={a} type="button" className={settings.defaultAmount === a ? "is-active" : ""} onClick={() => update({ defaultAmount: a })}>${a}</button>)}
              </div>
              <p className="ob-label">Usual window</p>
              <div className="ob-chips">
                {WINDOWS.map((d) => <button key={d.seconds} type="button" className={settings.defaultWindow === d.seconds ? "is-active" : ""} onClick={() => update({ defaultWindow: d.seconds })}>{d.label}</button>)}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 id="ob-title">Almost there.</h2>
              <p className="ob-sub">{canSave ? `You will be @${username}.` : "Add a username to keep your name and photo. Without one, only your preferences are kept."}</p>
              <p className="ob-label">Theme</p>
              <div className="ob-chips">
                <button type="button" className={theme === "light" ? "is-active" : ""} onClick={() => theme !== "light" && toggle()}>Light</button>
                <button type="button" className={theme === "dark" ? "is-active" : ""} onClick={() => theme !== "dark" && toggle()}>Dark</button>
              </div>
              {error && <p className="auth-error">{error}</p>}
            </>
          )}
        </div>

        <div className="ob-foot">
          {step > 0 ? (
            <button type="button" className="auth-back" onClick={() => setStep(step - 1)}><ArrowLeft weight="bold" /> Back</button>
          ) : (
            <button type="button" className="auth-back" onClick={onLeave}>Skip for now</button>
          )}
          {last ? (
            <button type="button" className="auth-primary ob-next" disabled={saving} onClick={() => void finish()}>{saving ? "Saving..." : canSave ? "Save and start" : "Start trading"}</button>
          ) : (
            <button type="button" className="auth-primary ob-next" onClick={() => setStep(step + 1)}>Next</button>
          )}
        </div>
        {step > 0 && !last && <button type="button" className="ob-skip" onClick={onLeave}>Skip the rest</button>}
      </div>
    </div>
  );
}
