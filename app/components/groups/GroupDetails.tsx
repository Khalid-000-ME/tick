"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, PencilSimple, Plus, UploadSimple, X } from "@phosphor-icons/react";
import { AVATAR_STYLES, Avatar, genAvatar, type AvatarStyle } from "@/components/Avatar";
import { ShareActions } from "@/components/ShareActions";
import { useProfiles } from "@/lib/profiles";
import { useAvatarUpload } from "@/lib/useAvatarUpload";
import { fetchGroupMembers, fetchRoomsIn, type Group, type Room } from "@/lib/useSocial";

/**
 * The group's info, opened from the chat header the way a messenger opens a contact card: its
 * face and name, who started it, and three things to look at: the leaderboard, the rooms inside
 * it, and the people. Rooms are made here, inside the group, and the owner can change the name
 * and picture.
 */
type Tab = "leaderboard" | "rooms" | "members";
interface Row { address: string; bets: number; net: number }

export function GroupDetails({
  group,
  account,
  joined,
  onClose,
  send,
}: {
  group: Group;
  account: `0x${string}` | null;
  joined: boolean;
  onClose: () => void;
  send: (fn: "setGroup" | "createRoom", args: readonly unknown[]) => Promise<{ ok: boolean; message: string }>;
}) {
  const [tab, setTab] = useState<Tab>("leaderboard");
  const [members, setMembers] = useState<string[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [board, setBoard] = useState<Row[]>([]);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Read once when the panel opens, so "started 2 days ago" does not change under a render.
  const [openedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([fetchGroupMembers(group.id), fetchRoomsIn(group.id)]);
      setMembers(m);
      setRooms(r.reverse());
      const res = await fetch(`/api/standings?addresses=${m.join(",")}`, { cache: "no-store" });
      const body = (await res.json()) as { standings: Row[] };
      setBoard([...body.standings].sort((a, b) => b.net - a.net || b.bets - a.bets));
    } catch {
      /* the panel keeps its last reading */
    }
  }, [group.id]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await load();
    };
    void poll();
    const t = setInterval(poll, 15_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [load]);

  const profiles = useProfiles(members);
  const mine = !!account && group.creator.toLowerCase() === account.toLowerCase();
  const me = account ? board.find((b) => b.address === account.toLowerCase()) : undefined;

  const who = (a: string) => {
    const p = profiles.get(a);
    return { p, name: p?.displayName || (p?.username ? `@${p.username}` : `${a.slice(0, 6)}…${a.slice(-4)}`) };
  };

  const days = Math.floor((openedAt / 1000 - group.createdAt) / 86_400);
  const started = days <= 0 ? "Started today" : days === 1 ? "Started yesterday" : `Started ${days} days ago`;

  return (
    <div className="gd">
      <header className="gd-head">
        <button type="button" className="msgr-icon" aria-label="Close group info" onClick={onClose}><X weight="bold" /></button>
        <h2>Group info</h2>
      </header>

      <div className="gd-scroll">
        <section className="gd-hero">
          <Avatar avatar={group.avatar} seed={`group-${group.id}`} name={group.name} size={92} />
          <h3>{group.name}</h3>
          <p>{started}</p>
        </section>

        <dl className="gd-stats">
          <div><dd>{members.length || group.members}</dd><dt>Members</dt></div>
          <div><dd>{rooms.length || group.rooms}</dd><dt>Rooms</dt></div>
          <div><dd>{group.messages}</dd><dt>Messages</dt></div>
        </dl>

        <div className="gd-actions">
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/groups/${group.id}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? <Check weight="bold" /> : <Copy weight="bold" />} {copied ? "Copied" : "Invite link"}
          </button>
          {mine && <button type="button" className="btn-ghost small" onClick={() => setEditing((v) => !v)}><PencilSimple weight="bold" /> {editing ? "Done" : "Edit"}</button>}
          {joined && me && <ShareActions address={me.address} net={me.net} compact />}
        </div>

        {editing && mine && <GroupEditor group={group} onSave={async (name, avatar) => { const r = await send("setGroup", [BigInt(group.id), name, avatar]); if (r.ok) setEditing(false); return r; }} />}

        <div className="gd-tabs" role="tablist">
          {(["leaderboard", "rooms", "members"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>
              {t === "leaderboard" ? "Leaderboard" : t === "rooms" ? "Rooms" : "Members"}
              {t === "rooms" && rooms.length > 0 && <em>{rooms.length}</em>}
              {t === "members" && members.length > 0 && <em>{members.length}</em>}
            </button>
          ))}
        </div>

        {tab === "leaderboard" && (
          <ol className="gd-list">
            {board.length === 0 && <li className="gd-empty">Nobody has made a call yet. When they do, the table fills in here.</li>}
            {board.map((s, i) => {
              const { p, name } = who(s.address);
              return (
                <li key={s.address} className={account && s.address === account.toLowerCase() ? "is-you" : ""}>
                  <Link className="gd-row" href={`/w/${s.address}`}>
                    <span className={`gd-rank ${i === 0 ? "is-first" : ""}`}>{i + 1}</span>
                    <Avatar avatar={p?.avatar} seed={s.address} name={p?.displayName || p?.username} size={36} />
                    <span className="gd-who"><strong>{name}</strong><small>{s.bets} {s.bets === 1 ? "call" : "calls"}</small></span>
                    <span className={`gd-net ${s.net >= 0 ? "is-up" : "is-down"}`}>{s.net >= 0 ? "+" : "−"}${Math.abs(s.net).toFixed(2)}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}

        {tab === "rooms" && (
          <div className="gd-list">
            {rooms.length === 0 && <p className="gd-empty">No contests in this group yet. Start one and everyone here can join it.</p>}
            <ul>
              {rooms.map((r) => (
                <li key={r.id}>
                  <Link href={`/rooms/${r.id}`} className="gd-row">
                    <span className="gd-who"><strong>{r.name}</strong><small>{r.members} playing · {r.messages} {r.messages === 1 ? "message" : "messages"}</small></span>
                    <ArrowRight weight="bold" className="gd-chev" />
                  </Link>
                </li>
              ))}
            </ul>
            {joined && (
              <form
                className="gd-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!roomName.trim() || busy) return;
                  setBusy(true);
                  setNote(null);
                  void send("createRoom", [roomName.trim(), BigInt(group.id)]).then(async (r) => {
                    setBusy(false);
                    if (r.ok) { setRoomName(""); await load(); } else setNote(r.message);
                  });
                }}
              >
                <input value={roomName} maxLength={40} placeholder="Name a new room" onChange={(e) => setRoomName(e.target.value)} aria-label="Room name" />
                <button type="submit" className="btn-solid small" disabled={busy || !roomName.trim()}><Plus weight="bold" /> {busy ? "Making…" : "Make"}</button>
              </form>
            )}
            {note && <p className="gd-empty">{note}</p>}
          </div>
        )}

        {tab === "members" && (
          <ul className="gd-list">
            {members.map((a) => {
              const { p, name } = who(a);
              return (
                <li key={a}>
                  <Link className="gd-row" href={`/w/${a}`}>
                    <Avatar avatar={p?.avatar} seed={a} name={p?.displayName || p?.username} size={36} />
                    <span className="gd-who"><strong>{name}</strong>{p?.username && p.displayName ? <small>@{p.username}</small> : null}</span>
                    {a === group.creator.toLowerCase() && <em className="gd-admin">Admin</em>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The group's name and picture, which only whoever started it can change. */
function GroupEditor({ group, onSave }: { group: Group; onSave: (name: string, avatar: string) => Promise<{ ok: boolean; message: string }> }) {
  const [name, setName] = useState(group.name);
  const [avatar, setAvatar] = useState(group.avatar || genAvatar("rings", `group-${group.id}`));
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { upload, uploading, note: uploadNote } = useAvatarUpload(setAvatar);
  const style = avatar.startsWith("gen:") ? (avatar.split(":")[1] as AvatarStyle) : null;
  const seed = avatar.split(":")[2] || `group-${group.id}`;

  return (
    <section className="gd-editor">
      <div className="gd-editor-top">
        <Avatar avatar={avatar} seed={`group-${group.id}`} name={name} size={56} />
        <div className="profile-styles">
          {AVATAR_STYLES.map((s) => (
            <button key={s} type="button" aria-label={`${s} pattern`} className={style === s ? "is-active" : ""} onClick={() => setAvatar(genAvatar(s, seed))}>
              <Avatar avatar={genAvatar(s, seed)} seed={`group-${group.id}`} name={name} size={34} />
            </button>
          ))}
        </div>
      </div>
      <div className="profile-upload">
        <label className="btn-ghost small">
          <UploadSimple weight="bold" /> {uploading ? "Uploading…" : "Upload photo"}
          <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </label>
        {uploadNote && <small className="is-bad">{uploadNote}</small>}
      </div>
      <div className="gd-form">
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
        <button type="button" className="btn-solid small" disabled={saving || !name.trim()} onClick={() => { setSaving(true); setNote(null); void onSave(name, avatar).then((r) => { setSaving(false); if (!r.ok) setNote(r.message); }); }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {note && <p className="gd-empty">{note}</p>}
    </section>
  );
}
