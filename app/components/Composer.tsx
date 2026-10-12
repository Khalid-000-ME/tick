"use client";

import { useRef, useState } from "react";
import { Camera, X } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { squeezePhoto } from "@/lib/feed";
import type { Profile } from "@/lib/profiles";

/**
 * Where a post is made: a few words, an optional photo, and whether to put the results card
 * on it. The card is on by default, because the profit is the reason to post.
 */
export function Composer({
  account,
  profile,
  onPost,
  onLogin,
}: {
  account: string | null;
  profile?: Profile;
  onPost: (caption: string, image: Uint8Array, card: boolean) => Promise<{ ok: boolean; message: string }>;
  onLogin: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [card, setCard] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (!account) {
    return (
      <section className="composer is-locked">
        <p>Post a win, a photo, or just how it is going.</p>
        <button type="button" className="btn-solid" onClick={onLogin}>Log in to post</button>
      </section>
    );
  }

  async function pick(file: File) {
    setNote(null);
    setBusy("Shrinking the photo…");
    try {
      const bytes = await squeezePhoto(file);
      const copy = new Uint8Array(bytes);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { bytes: copy, url: URL.createObjectURL(new Blob([copy], { type: "image/webp" })) };
      });
    } catch (e) {
      setNote((e as Error).message || "Could not read that photo.");
    } finally {
      setBusy(null);
    }
  }

  const empty = !caption.trim() && !photo && !card;

  async function submit() {
    setNote(null);
    setBusy("Posting on chain…");
    const r = await onPost(caption.trim(), photo?.bytes ?? new Uint8Array(), card);
    setBusy(null);
    if (!r.ok) return setNote(r.message);
    setCaption("");
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }

  return (
    <section className="composer">
      <div className="composer-row">
        <Avatar avatar={profile?.avatar} seed={account} name={profile?.displayName || profile?.username} size={40} />
        <textarea
          value={caption}
          maxLength={280}
          rows={2}
          placeholder="What happened in those thirty seconds?"
          aria-label="Post"
          onChange={(e) => setCaption(e.target.value)}
        />
      </div>

      {photo && (
        <div className="composer-photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the bytes about to be posted */}
          <img src={photo.url} alt="Your photo" />
          <button type="button" aria-label="Remove the photo" onClick={() => setPhoto((old) => { if (old) URL.revokeObjectURL(old.url); return null; })}><X weight="bold" /></button>
          <small>{(photo.bytes.length / 1000).toFixed(0)} KB, stored on chain</small>
        </div>
      )}

      <div className="composer-bar">
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
        <button type="button" className="composer-tool" disabled={!!busy} onClick={() => input.current?.click()}>
          <Camera weight="bold" /> Photo
        </button>
        <label className="composer-toggle">
          <input type="checkbox" checked={card} onChange={(e) => setCard(e.target.checked)} />
          <span>Show my card</span>
        </label>
        <button type="button" className="btn-solid composer-post" disabled={!!busy || empty} onClick={() => void submit()}>
          {busy ?? "Post"}
        </button>
      </div>
      {note && <p className="match-note">{note}</p>}
    </section>
  );
}
