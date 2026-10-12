"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Avatar, genAvatar } from "@/components/Avatar";
import { CARD_TAG } from "@/components/ChatPanel";
import { listTime } from "@/components/groups/format";
import type { Group, Post } from "@/lib/useSocial";

/**
 * The left pane: every group, yours first and newest conversation on top, then the rest to
 * discover. A row is the group's face, its name, the last thing said and when, and a badge for
 * what you have not read. It is a list of links, so the selected group lives in the address and
 * a refresh, a shared link and the browser's back button all behave.
 */
export function GroupList({
  groups,
  mine,
  latest,
  selected,
  unread,
  signedIn,
  busy,
  onCreate,
  loading,
  switcher,
}: {
  groups: Group[];
  mine: number[];
  latest: Map<number, Post>;
  selected?: number;
  unread: (g: Group) => number;
  signedIn: boolean;
  busy: boolean;
  onCreate: (name: string) => Promise<boolean>;
  loading: boolean;
  /** The Groups/Rooms switch, which sits at the left of the header beside the + button. */
  switcher: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");

  const { yours, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (g: Group) => !q || g.name.toLowerCase().includes(q);
    const newest = (g: Group) => latest.get(g.id)?.at ?? g.createdAt;
    return {
      yours: groups.filter((g) => mine.includes(g.id) && match(g)).sort((a, b) => newest(b) - newest(a)),
      others: groups.filter((g) => !mine.includes(g.id) && match(g)).sort((a, b) => b.members - a.members || newest(b) - newest(a)),
    };
  }, [groups, mine, latest, query]);

  const preview = (g: Group) => {
    const last = latest.get(g.id);
    if (!last) return "No messages yet";
    return last.text.startsWith(CARD_TAG) ? "Shared a results card" : last.text;
  };

  const row = (g: Group, joined: boolean) => {
    const last = latest.get(g.id);
    const n = joined ? unread(g) : 0;
    return (
      <li key={g.id}>
        <Link href={`/groups/${g.id}`} className={`gl-row ${selected === g.id ? "is-selected" : ""}`} aria-current={selected === g.id ? "page" : undefined}>
          <Avatar avatar={g.avatar} seed={`group-${g.id}`} name={g.name} size={48} />
          <span className="gl-main">
            <span className="gl-top"><strong>{g.name}</strong><time>{last ? listTime(last.at) : ""}</time></span>
            <span className="gl-bottom">
              <span className="gl-preview">{joined ? preview(g) : `${g.members} ${g.members === 1 ? "member" : "members"} · ${g.rooms} ${g.rooms === 1 ? "room" : "rooms"}`}</span>
              {n > 0 && <b className="gl-badge" aria-label={`${n} unread`}>{n > 99 ? "99+" : n}</b>}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <>
      <header className="msgr-list-head">
        {switcher}
        {signedIn && (
          <button type="button" className="msgr-new" aria-label={making ? "Cancel" : "Start a group"} aria-expanded={making} onClick={() => setMaking((v) => !v)}>
            <Plus weight="bold" />
          </button>
        )}
      </header>

      {making && (
        <form
          className="gl-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            void onCreate(name.trim()).then((ok) => { if (ok) { setName(""); setMaking(false); } });
          }}
        >
          <input value={name} maxLength={40} placeholder="Name your group" autoFocus onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          <button type="submit" className="btn-solid small" disabled={busy || !name.trim()}>{busy ? "Starting…" : "Start"}</button>
        </form>
      )}

      <label className="gl-search">
        <MagnifyingGlass weight="bold" />
        <input value={query} placeholder="Search groups" onChange={(e) => setQuery(e.target.value)} aria-label="Search groups" />
      </label>

      <div className="gl-scroll">
        {loading ? (
          <p className="gl-note">Reading groups from the chain…</p>
        ) : (
          <>
            {signedIn && (
              <>
                <h2 className="gl-section">Your groups</h2>
                {yours.length === 0 ? <p className="gl-note">{query ? "No group of yours matches." : "You are not in a group yet. Pick one below, or start your own."}</p> : <ul>{yours.map((g) => row(g, true))}</ul>}
              </>
            )}
            <h2 className="gl-section">{signedIn ? "Discover" : "All groups"}</h2>
            {others.length === 0 ? <p className="gl-note">{query ? "No group matches that." : "Nothing more to discover."}</p> : <ul>{others.map((g) => row(g, false))}</ul>}
          </>
        )}
      </div>
    </>
  );
}

/** A starting picture for a new group: a pattern drawn from its name. */
export const startAvatar = (name: string) => genAvatar("rings", name);
