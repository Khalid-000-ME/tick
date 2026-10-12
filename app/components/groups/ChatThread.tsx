"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, IdentificationCard } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { CARD_TAG } from "@/components/ChatPanel";
import { ResultsCard } from "@/components/PostCard";
import { clock, dayKey, dayLabel } from "@/components/groups/format";
import { useProfiles } from "@/lib/profiles";
import type { Standing } from "@/lib/useFeed";
import { fetchChat, type Post } from "@/lib/useSocial";

/** A stable colour slot for a sender, from their address, so each person keeps theirs. */
const hueOf = (address: string) => {
  let h = 0;
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return h % 6;
};

type Row = { kind: "day"; key: string; label: string } | { kind: "msg"; key: string; post: Post; first: boolean };

/**
 * The conversation of one group, laid out the way a messenger does it: your messages on the
 * right, everyone else's on the left with their face beside the first of a run, a divider for
 * each day, and the composer fixed under it.
 *
 * Every message is a transaction on TickSocial, and a message that is only CARD_TAG is drawn as
 * the sender's results card (see components/ChatPanel for why that cannot be forged).
 */
export function ChatThread({
  groupId,
  account,
  canPost,
  post,
  onJoin,
  onSeen,
}: {
  groupId: number;
  account: string | null;
  canPost: boolean;
  post: (text: string) => Promise<{ ok: boolean; message: string }>;
  onJoin: () => void;
  /** Called with the number of messages the reader has now seen, to clear an unread badge. */
  onSeen: (count: number) => void;
}) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [standings, setStandings] = useState<Map<string, Standing>>(new Map());
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchChat("group", groupId, 120);
      setPosts(next);
    } catch {
      /* the thread stays as it was until the next pass */
    }
  }, [groupId]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await load();
    };
    void poll();
    const t = setInterval(poll, 4000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [load]);

  // Opening a chat puts you at the newest message; after that new ones only pull you down if
  // you were already at the bottom, so scrolling back through history is not undone.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    if (posts) onSeen(posts.length);
  }, [posts, onSeen]);

  const profiles = useProfiles(posts?.map((p) => p.from) ?? []);

  const sharerKey = [...new Set((posts ?? []).filter((p) => p.text.startsWith(CARD_TAG)).map((p) => p.from))].filter((a) => !standings.has(a)).join(",");
  useEffect(() => {
    if (!sharerKey) return;
    let off = false;
    void fetch(`/api/standings?addresses=${sharerKey}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ standings: Standing[] }>)
      .then((b) => { if (!off) setStandings((prev) => new Map([...prev, ...b.standings.map((s) => [s.address, s] as const)])); })
      .catch(() => {});
    return () => { off = true; };
  }, [sharerKey]);

  // Messages as runs: a new run starts when the sender or the day changes, or after a pause.
  const rows = useMemo(() => {
    const items: Row[] = [];
    let prev: Post | null = null;
    (posts ?? []).forEach((p, i) => {
      if (!prev || dayKey(prev.at) !== dayKey(p.at)) items.push({ kind: "day", key: `d${p.at}-${i}`, label: dayLabel(p.at) });
      const first = !prev || prev.from !== p.from || dayKey(prev.at) !== dayKey(p.at) || p.at - prev.at > 300;
      items.push({ kind: "msg", key: `${p.at}-${i}`, post: p, first });
      prev = p;
    });
    return items;
  }, [posts]);

  async function run(body: string) {
    setBusy(true);
    setNote(null);
    stick.current = true;
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
    <div className="thread">
      <div
        className="thread-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {posts === null ? (
          <p className="thread-empty">Reading the conversation from the chain…</p>
        ) : posts.length === 0 ? (
          <p className="thread-empty">Nothing here yet. Say the first thing.</p>
        ) : (
          rows.map((row) => {
            if (row.kind === "day") return <div key={row.key} className="thread-day"><span>{row.label}</span></div>;
            const p = row.post;
            const mine = !!account && p.from === account.toLowerCase();
            const profile = profiles.get(p.from);
            const isCard = p.text.startsWith(CARD_TAG);
            const caption = isCard ? p.text.slice(CARD_TAG.length).trim() : p.text;
            const name = profile?.displayName || (profile?.username ? `@${profile.username}` : `${p.from.slice(0, 6)}…${p.from.slice(-4)}`);
            return (
              <div key={row.key} className={`bubble-row ${mine ? "is-mine" : ""} ${row.first ? "is-first" : ""}`}>
                {!mine && (row.first ? <Avatar avatar={profile?.avatar} seed={p.from} name={profile?.displayName || profile?.username} size={32} /> : <span className="bubble-gap" />)}
                <div className={`bubble ${isCard ? "has-card" : ""}`}>
                  {!mine && row.first && <strong className="bubble-who" data-h={hueOf(p.from)}>{name}</strong>}
                  {isCard && <div className="bubble-card"><ResultsCard standing={standings.get(p.from)} /></div>}
                  <div className="bubble-text">
                    {(!isCard || caption) && <p>{caption}</p>}
                    <time dateTime={new Date(p.at * 1000).toISOString()}>{clock(p.at)}</time>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {canPost ? (
        <form className="thread-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(text.trim()); }}>
          <input value={text} maxLength={270} placeholder="Write a message" onChange={(e) => setText(e.target.value)} aria-label="Message" />
          <button type="button" className="thread-tool" disabled={busy} title="Share your results card in this chat" onClick={() => void run(`${CARD_TAG}${text.trim() ? ` ${text.trim()}` : ""}`)}>
            <IdentificationCard weight="bold" /> Card
          </button>
          <button type="submit" className="thread-send" disabled={busy || !text.trim()} aria-label="Send"><ArrowUp weight="bold" /></button>
        </form>
      ) : (
        <div className="thread-join">
          {account ? <><span>Join to write here. Anyone can read.</span><button type="button" className="btn-solid small" onClick={onJoin}>Join group</button></> : <><span>Log in to join this group and chat.</span><button type="button" className="btn-solid small" onClick={onJoin}>Log in</button></>}
        </div>
      )}
      {note && <p className="thread-note">{note}</p>}
    </div>
  );
}
