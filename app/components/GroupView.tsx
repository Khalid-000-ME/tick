"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, PencilSimple, Trophy, UploadSimple, UsersThree } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { Avatar, AVATAR_STYLES, genAvatar, type AvatarStyle } from "@/components/Avatar";
import { ChatPanel } from "@/components/ChatPanel";
import { useAvatarUpload } from "@/lib/useAvatarUpload";
import { useProfiles } from "@/lib/profiles";
import { fetchGroup, fetchGroupMembers, fetchRoomsIn, useSocial, type Group, type Room } from "@/lib/useSocial";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * A group: its face, its people, the contests inside it, and the conversation.
 *
 * Everything on this page is read from TickSocial, and the picture is a reference exactly
 * like a trader's own avatar, so a group can be drawn from a seed or be an uploaded photo.
 */
export function GroupView({ id }: { id: number }) {
  const wallet = useTickWallet();
  const { account, walletClient } = wallet;
  const { send } = useSocial(account, walletClient);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [board, setBoard] = useState<{ address: string; bets: number; net: number }[]>([]);

  const load = useCallback(async () => {
    const found = await fetchGroup(id);
    if (!found) return setMissing(true);
    setGroup(found);
    const [m, r] = await Promise.all([fetchGroupMembers(id), fetchRoomsIn(id)]);
    setMembers(m);
    setRooms(r);
    try {
      const res = await fetch(`/api/standings?addresses=${m.join(",")}`, { cache: "no-store" });
      const body = (await res.json()) as { standings: { address: string; bets: number; net: number }[] };
      setBoard([...body.standings].sort((a, b) => b.net - a.net || b.bets - a.bets));
    } catch {
      /* the leaderboard keeps its last reading */
    }
  }, [id]);

  const profiles = useProfiles(board.map((b) => b.address));

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

  const joined = !!account && members.includes(account.toLowerCase());
  const mine = !!account && group?.creator.toLowerCase() === account.toLowerCase();

  return (
    <AccountShell active="groups" wallet={wallet}>
      {missing ? (
        <div className="page-empty">No group has that number.</div>
      ) : !group ? (
        <div className="page-empty">Reading the group from the chain…</div>
      ) : (
        <>
          <section className="group-head">
            <Avatar avatar={group.avatar} seed={`group-${group.id}`} name={group.name} size={72} />
            <div>
              <h1>{group.name}</h1>
              <p>{members.length} in · {rooms.length} rooms · {group.messages} messages</p>
            </div>
            <div className="group-head-actions">
              {account && !joined && (
                <button type="button" className="btn-solid" disabled={busy} onClick={() => { setBusy(true); void send("joinGroup", [BigInt(group.id)]).then(() => { setBusy(false); void load(); }); }}>
                  {busy ? "Joining…" : "Join group"}
                </button>
              )}
              {mine && (
                <button type="button" className="btn-ghost" onClick={() => setEditing((v) => !v)}>
                  <PencilSimple weight="bold" /> {editing ? "Done" : "Edit"}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/groups/${group.id}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? <Check weight="bold" /> : <Copy weight="bold" />} {copied ? "Copied" : "Invite"}
              </button>
            </div>
          </section>

          {editing && mine && (
            <GroupEditor
              group={group}
              onSave={async (name, avatar) => {
                setBusy(true);
                const r = await send("setGroup", [BigInt(group.id), name, avatar]);
                setBusy(false);
                if (r.ok) {
                  setEditing(false);
                  await load();
                }
                return r;
              }}
            />
          )}

          <div className="social-grid">
            <ChatPanel
              kind="group"
              id={group.id}
              account={account}
              canPost={joined}
              post={async (text) => send("postToGroup", [BigInt(group.id), text])}
            />

            <section className="match-panel">
              <header className="match-panel-head"><h2><Trophy weight="bold" /> Leaderboard</h2></header>
              <ol className="room-board">
                {board.map((s, i) => {
                  const p = profiles.get(s.address);
                  return (
                    <li key={s.address} className={account && s.address === account.toLowerCase() ? "is-you" : ""}>
                      <span className="room-rank">{i + 1}</span>
                      <Avatar avatar={p?.avatar} seed={s.address} name={p?.displayName || p?.username} size={28} />
                      <span className="room-who">
                        <strong>{p?.displayName || (p?.username ? `@${p.username}` : `${s.address.slice(0, 6)}…${s.address.slice(-4)}`)}</strong>
                        <small>{s.bets} calls</small>
                      </span>
                      <span className={`room-net ${s.net >= 0 ? "is-up" : "is-down"}`}>{s.net >= 0 ? "+" : "−"}${Math.abs(s.net).toFixed(2)}</span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="match-panel">
              <header className="match-panel-head"><h2><UsersThree weight="bold" /> Rooms in this group</h2></header>
              {rooms.length === 0 ? (
                <p className="match-meta">No contests yet. Make one from the Rooms page and pick this group.</p>
              ) : (
                <ul className="room-list">
                  {rooms.map((r) => (
                    <li key={r.id}>
                      <Link href={`/rooms/${r.id}`}>
                        <strong>{r.name}</strong>
                        <span>{r.members} in</span>
                        <ArrowRight weight="bold" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </AccountShell>
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
    <section className="match-panel group-editor">
      <header className="match-panel-head"><h2>Group picture and name</h2></header>
      <div className="profile-id">
        <Avatar avatar={avatar} seed={`group-${group.id}`} name={name} size={72} />
        <div className="profile-avatar-tools">
          <div className="profile-styles">
            {AVATAR_STYLES.map((s) => (
              <button key={s} type="button" aria-label={`${s} pattern`} className={style === s ? "is-active" : ""} onClick={() => setAvatar(genAvatar(s, seed))}>
                <Avatar avatar={genAvatar(s, seed)} seed={`group-${group.id}`} name={name} size={34} />
              </button>
            ))}
          </div>
          <div className="profile-upload">
            <label className="btn-ghost small">
              <UploadSimple weight="bold" /> {uploading ? "Uploading…" : "Upload photo"}
              <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            </label>
            {uploadNote && <small className="is-bad">{uploadNote}</small>}
          </div>
        </div>
      </div>
      <div className="social-form">
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
        <button
          type="button"
          className="btn-solid"
          disabled={saving || !name.trim()}
          onClick={() => {
            setSaving(true);
            setNote(null);
            void onSave(name, avatar).then((r) => {
              setSaving(false);
              if (!r.ok) setNote(r.message);
            });
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {note && <p className="match-note">{note}</p>}
    </section>
  );
}
