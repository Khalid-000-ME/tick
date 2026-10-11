"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Check, DiceFive, EnvelopeSimple, Fingerprint, GoogleLogo, Wallet, XLogo } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { AVATAR_STYLES, Avatar, genAvatar, isAllowedAvatarUrl, type AvatarStyle } from "@/components/Avatar";
import { DURATIONS } from "@/lib/chain/config";
import { useMyProfile } from "@/lib/profiles";
import { useSettings, type StakeMode } from "@/lib/useSettings";
import { useTheme } from "@/lib/useTheme";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * Who you are on Tick, how you sign in, and how the site behaves for you.
 *
 * The profile (username, display name, avatar) is saved on chain: one transaction, unique
 * usernames enforced by the contract, readable anywhere your address appears. Sign-in
 * methods are Privy's, and linking several makes them one account. Settings stay on this
 * device and apply instantly.
 */
const MODES: { id: StakeMode; title: string; detail: string }[] = [
  { id: "tap", title: "One tap", detail: "Tapping a side stakes immediately." },
  { id: "confirm", title: "Confirm", detail: "A sheet shows the terms; confirm to stake." },
  { id: "slide", title: "Slide", detail: "Slide to stake, so a stray tap never trades." },
];

export function ProfileView() {
  const wallet = useTickWallet();
  const { account, walletClient, status } = wallet;
  const { profile, save, saving, available } = useMyProfile(account, walletClient);
  const { settings, update } = useSettings();
  const { theme, toggle } = useTheme();

  const [note, setNote] = useState<string | null>(null);

  if (status !== "ready" || !account) {
    return (
      <AccountShell active="profile" wallet={wallet}>
        <section className="page-intro"><h1>Profile</h1></section>
        <div className="page-empty">Sign in to set up your profile.</div>
      </AccountShell>
    );
  }

  return (
    <AccountShell active="profile" wallet={wallet}>
      <section className="page-intro">
        <h1>Profile</h1>
        <p>Saved on chain, so your name shows up anywhere your address does.</p>
      </section>

      <div className="profile-grid">
        {profile ? (
          <IdentityForm
            key={`${profile.username}|${profile.displayName}|${profile.avatar}`}
            account={account}
            saved={profile}
            saving={saving}
            available={available}
            onSave={async (next) => setNote((await save(next)).message)}
            note={note}
          />
        ) : (
          <section className="match-panel"><p className="match-meta">Loading your profile...</p></section>
        )}

        <div className="profile-col">
          <SignInMethods onNote={setNote} />

          <section className="match-panel">
            <header className="match-panel-head"><h2>Staking</h2></header>
            <div className="profile-modes">
              {MODES.map((m) => (
                <button key={m.id} type="button" className={settings.stakeMode === m.id ? "is-active" : ""} onClick={() => update({ stakeMode: m.id })}>
                  <strong>{m.title}</strong>
                  <span>{m.detail}</span>
                  {settings.stakeMode === m.id && <Check weight="bold" />}
                </button>
              ))}
            </div>
            <div className="profile-row">
              <span>Default stake</span>
              <div className="match-amounts">
                {[2, 5, 10, 25, 50].map((v) => (
                  <button key={v} type="button" className={settings.defaultAmount === v ? "is-active" : ""} onClick={() => update({ defaultAmount: v })}>{v} USDC</button>
                ))}
              </div>
            </div>
            <div className="profile-row">
              <span>Default window</span>
              <div className="match-amounts">
                {DURATIONS.map((d) => (
                  <button key={d.seconds} type="button" className={settings.defaultWindow === d.seconds ? "is-active" : ""} onClick={() => update({ defaultWindow: d.seconds })}>{d.label}</button>
                ))}
              </div>
            </div>
            <div className="profile-row">
              <span>Theme</span>
              <div className="match-amounts">
                <button type="button" className={theme === "light" ? "is-active" : ""} onClick={() => theme !== "light" && toggle()}>Light</button>
                <button type="button" className={theme === "dark" ? "is-active" : ""} onClick={() => theme !== "dark" && toggle()}>Dark</button>
              </div>
            </div>
            <p className="match-note">Settings are kept on this device and apply straight away.</p>
          </section>
        </div>
      </div>
    </AccountShell>
  );
}

/**
 * The editable identity. Mounted fresh (by key) whenever the saved profile changes, so it
 * starts from what is on chain without copying it into state inside an effect.
 */
function IdentityForm({
  account,
  saved,
  saving,
  available,
  onSave,
  note,
}: {
  account: `0x${string}`;
  saved: { username: string; displayName: string; avatar: string };
  saving: boolean;
  available: (u: string) => Promise<boolean>;
  onSave: (p: { username: string; displayName: string; avatar: string }) => void;
  note: string | null;
}) {
  const [username, setUsername] = useState(saved.username);
  const [displayName, setDisplayName] = useState(saved.displayName);
  const [avatar, setAvatar] = useState(saved.avatar || genAvatar("beam", account));
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<{ name: string; free: boolean } | null>(null);

  const validFormat = /^[a-z0-9_]{3,20}$/.test(username);
  // Availability, from the contract, for the name currently typed. Only the async answer is
  // stored; the format check and "is this my own name" are derived.
  useEffect(() => {
    if (!validFormat || username === saved.username) return;
    let off = false;
    const t = setTimeout(() => void available(username).then((free) => { if (!off) setCheck({ name: username, free }); }), 350);
    return () => { off = true; clearTimeout(t); };
  }, [username, validFormat, saved.username, available]);

  const free: boolean | null = !username
    ? null
    : !validFormat
      ? false
      : username === saved.username
        ? true
        : check?.name === username
          ? check.free
          : null;
  const dirty = username !== saved.username || displayName !== saved.displayName || avatar !== saved.avatar;
  const style = avatar.startsWith("gen:") ? (avatar.split(":")[1] as AvatarStyle) : null;

  return (
    <section className="match-panel">
      <header className="match-panel-head"><h2>Identity</h2></header>
      <div className="profile-id">
        <Avatar avatar={avatar} seed={account} name={displayName || username} size={72} />
        <div className="profile-avatar-tools">
          <div className="profile-styles">
            {AVATAR_STYLES.map((s) => (
              <button key={s} type="button" className={style === s ? "is-active" : ""} onClick={() => setAvatar(genAvatar(s, avatar.split(":")[2] || account))}>
                <Avatar avatar={genAvatar(s, avatar.split(":")[2] || account)} seed={account} name={displayName || username} size={34} />
              </button>
            ))}
            <button type="button" className="profile-shuffle" title="New pattern" onClick={() => setAvatar(genAvatar(style ?? "beam", Math.random().toString(36).slice(2, 10)))}>
              <DiceFive weight="bold" />
            </button>
          </div>
          <div className="profile-url">
            <input placeholder="or an image URL (X, GitHub, Google, Imgur)" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="button" className="btn-ghost small" disabled={!isAllowedAvatarUrl(url)} onClick={() => { setAvatar(url); setUrl(""); }}>Use</button>
          </div>
        </div>
      </div>

      <label className="profile-field">
        <span>Username</span>
        <div className="profile-input">
          <em>@</em>
          <input value={username} maxLength={20} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="your_name" />
          {username && (
            <small className={free ? "is-ok" : "is-bad"}>
              {free === null ? "checking" : username === saved.username ? "yours" : free ? "available" : validFormat ? "taken" : "3-20 of a-z, 0-9, _"}
            </small>
          )}
        </div>
      </label>
      <label className="profile-field">
        <span>Display name</span>
        <input className="profile-plain" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} placeholder="How you appear" />
      </label>

      <button type="button" className="btn-solid" disabled={!dirty || saving || !free} onClick={() => onSave({ username, displayName, avatar })}>
        {saving ? "Saving..." : "Save profile"}
      </button>
      {note && <p className="match-note">{note}</p>}
    </section>
  );
}

/** Privy's linked accounts, with a button to add any method not yet linked. */
function SignInMethods({ onNote }: { onNote: (m: string) => void }) {
  const { user, linkGoogle, linkPasskey, linkEmail, linkTwitter, linkWallet } = usePrivy();
  const linked = user?.linkedAccounts ?? [];
  const has = (type: string) => linked.some((a) => a.type === type);
  const google = linked.find((a) => a.type === "google_oauth") as { email?: string } | undefined;
  const email = linked.find((a) => a.type === "email") as { address?: string } | undefined;
  const x = linked.find((a) => a.type === "twitter_oauth") as { username?: string | null } | undefined;
  const wallets = linked.filter((a) => a.type === "wallet") as { address: string; walletClientType?: string }[];

  const rows = [
    { key: "google", icon: <GoogleLogo weight="bold" />, label: "Google", value: google?.email, linked: has("google_oauth"), link: linkGoogle },
    { key: "passkey", icon: <Fingerprint weight="bold" />, label: "Passkey", value: has("passkey") ? "This device or a synced key" : undefined, linked: has("passkey"), link: linkPasskey },
    { key: "email", icon: <EnvelopeSimple weight="bold" />, label: "Email", value: email?.address, linked: has("email"), link: linkEmail },
    { key: "x", icon: <XLogo weight="bold" />, label: "X", value: x?.username ? `@${x.username}` : undefined, linked: has("twitter_oauth"), link: linkTwitter },
    {
      key: "wallet", icon: <Wallet weight="bold" />, label: "Wallet",
      value: wallets.map((w) => `${w.address.slice(0, 6)}...${w.address.slice(-4)}${w.walletClientType === "privy" ? " (Tick wallet)" : ""}`).join(", "),
      linked: wallets.length > 0, link: () => linkWallet(),
    },
  ];

  return (
    <section className="match-panel">
      <header className="match-panel-head"><h2>Sign-in methods</h2></header>
      <ul className="profile-methods">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="profile-method-icon">{r.icon}</span>
            <span className="profile-method-label">
              <strong>{r.label}</strong>
              {r.value && <small>{r.value}</small>}
            </span>
            {r.linked ? (
              <span className="profile-linked"><Check weight="bold" /> Linked</span>
            ) : (
              <button
                type="button"
                className="btn-ghost small"
                onClick={() => {
                  try { r.link(); } catch (e) { onNote((e as Error).message); }
                }}
              >
                Link
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="match-note">Any linked method signs you into this same account and wallet.</p>
    </section>
  );
}
