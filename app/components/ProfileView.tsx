"use client";

import { useEffect, useState } from "react";
import { Check, DiceFive, UploadSimple } from "@phosphor-icons/react";
import { usePrivy } from "@privy-io/react-auth";
import { AmountPicker } from "@/components/AmountPicker";
import { AccountShell } from "@/components/AccountShell";
import { AVATAR_STYLES, Avatar, genAvatar, isAllowedAvatarUrl, type AvatarStyle } from "@/components/Avatar";
import { DURATIONS } from "@/lib/chain/config";
import { useMyProfile } from "@/lib/profiles";
import { useSettings, type StakeMode } from "@/lib/useSettings";
import { useTheme } from "@/lib/useTheme";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * Who you are on Tick, and how the site behaves for you.
 *
 * The profile (username, display name, avatar) is saved on chain: one transaction, unique
 * usernames enforced by the contract, readable anywhere your address appears. Settings stay
 * on this device and apply instantly.
 */
const MODES: { id: StakeMode; title: string; detail: string }[] = [
  { id: "tap", title: "One tap", detail: "Tap a side. You are in." },
  { id: "confirm", title: "Confirm", detail: "Review, then confirm." },
  { id: "slide", title: "Slide", detail: "Slide to stake." },
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
        <p>Your name, on chain.</p>
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
              <AmountPicker value={settings.defaultAmount} compact label="Default stake" onChange={(n) => n > 0 && update({ defaultAmount: n })} />
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
            <p className="match-note">Saved on this device.</p>
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
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const { getAccessToken } = usePrivy();

  async function upload(file: File) {
    setUploadNote(null);
    if (!file.type.startsWith("image/")) return setUploadNote("Choose an image file.");
    setUploading(true);
    try {
      // Centre-crop to a square and shrink in the browser first, so a phone photo is a few
      // dozen kilobytes on the wire. The server re-draws it again and does not trust this.
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(512, side);
      canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
      if (!blob) throw new Error("encode");
      const token = await getAccessToken();
      const res = await fetch("/api/avatar", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: blob });
      const body = (await res.json()) as { ok: boolean; avatar?: string; error?: string };
      if (!body.ok || !body.avatar) return setUploadNote(body.error ?? "Upload failed.");
      setAvatar(body.avatar);
    } catch {
      setUploadNote("Could not read that image. Try a JPG, PNG or WebP.");
    } finally {
      setUploading(false);
    }
  }
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
          <div className="profile-upload">
            <label className="btn-ghost small">
              <UploadSimple weight="bold" /> {uploading ? "Uploading..." : "Upload photo"}
              <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            </label>
            {uploadNote && <small className="is-bad">{uploadNote}</small>}
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
