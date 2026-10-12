"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { useProfiles } from "@/lib/profiles";
import { fetchChat, type Post } from "@/lib/useSocial";

/**
 * The chat of a group or a room, read from and written to the contract.
 *
 * Every message is a transaction, which is unusual for a chat and is the point: the thread
 * sits beside results that are already on chain, and nobody, us included, can quietly edit
 * what was said. It polls rather than streams, because a message is only real once it is in
 * a block anyway.
 */
export function ChatPanel({
  kind,
  id,
  canPost,
  post,
  account,
}: {
  kind: "group" | "room";
  id: number;
  /** Members only. A non-member sees the thread and is told to join. */
  canPost: boolean;
  post: (text: string) => Promise<{ ok: boolean; message: string }>;
  account: string | null;
}) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      setPosts(await fetchChat(kind, id));
    } catch {
      /* the thread stays as it was until the next pass */
    }
  }, [kind, id]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await load();
    };
    void poll();
    const t = setInterval(poll, 6000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [load]);

  // Follow new messages only when the reader is already at the bottom, so scrolling back
  // through the thread is not yanked away every six seconds.
  useEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [posts]);

  const profiles = useProfiles(posts?.map((p) => p.from) ?? []);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setNote(null);
    const r = await post(body);
    setBusy(false);
    if (r.ok) {
      setText("");
      await load();
    } else {
      setNote(r.message);
    }
  }

  return (
    <section className="match-panel chat-panel">
      <header className="match-panel-head"><h2>Chat</h2><span className="chat-note">On chain</span></header>
      <div
        className="chat-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {posts === null ? (
          <p className="match-meta">Reading the thread…</p>
        ) : posts.length === 0 ? (
          <p className="match-meta">Nothing said yet. Say the first thing.</p>
        ) : (
          posts.map((p, i) => {
            const profile = profiles.get(p.from);
            const mine = !!account && p.from === account.toLowerCase();
            return (
              <article key={`${p.at}-${i}`} className={`chat-msg ${mine ? "is-mine" : ""}`}>
                <Avatar avatar={profile?.avatar} seed={p.from} name={profile?.displayName || profile?.username} size={26} />
                <div>
                  <p className="chat-who">
                    <strong>{profile?.displayName || (profile?.username ? `@${profile.username}` : `${p.from.slice(0, 6)}…${p.from.slice(-4)}`)}</strong>
                    <time dateTime={new Date(p.at * 1000).toISOString()}>{new Date(p.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </p>
                  <p className="chat-text">{p.text}</p>
                </div>
              </article>
            );
          })
        )}
      </div>
      {canPost ? (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input value={text} maxLength={280} placeholder="Say something" onChange={(e) => setText(e.target.value)} aria-label="Message" />
          <button type="submit" className="btn-solid" disabled={busy || !text.trim()} aria-label="Send">
            <PaperPlaneRight weight="bold" /> {busy ? "Sending…" : "Send"}
          </button>
        </form>
      ) : (
        <p className="match-note">Join to post. Reading is open to anyone.</p>
      )}
      {note && <p className="match-note">{note}</p>}
    </section>
  );
}
