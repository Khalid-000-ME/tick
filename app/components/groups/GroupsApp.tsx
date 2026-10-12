"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { Avatar } from "@/components/Avatar";
import { ChatThread } from "@/components/groups/ChatThread";
import { GroupDetails } from "@/components/groups/GroupDetails";
import { GroupList, startAvatar } from "@/components/groups/GroupList";
import { RoomsPane } from "@/components/groups/RoomsPane";
import { openAuth } from "@/lib/authSession";
import { usePersisted } from "@/lib/usePersisted";
import { fetchLastMessages, useSocial, type Group, type Post } from "@/lib/useSocial";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * Groups, laid out like a desktop messenger: the list on the left, the open conversation in the
 * middle, and the group's info on the right when you ask for it by tapping the header.
 *
 * The open group is in the address (/groups/<id>), so a link to a group lands on it. On a phone
 * only one pane shows at a time: the list at /groups, the conversation at /groups/<id>, and the
 * info over it.
 */
export function GroupsApp({ selected }: { selected?: number }) {
  const wallet = useTickWallet();
  const { account, status, walletClient } = wallet;
  const social = useSocial(account, walletClient);
  const signedIn = status === "ready" && !!account;

  const [pane, setPane] = useState<"groups" | "rooms">("groups");
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<Map<number, Post>>(new Map());
  const [seenRaw, setSeenRaw] = usePersisted("tick.groups.seen");

  // The last message of every group, for the previews and the ordering of the list.
  const ids = useMemo(() => social.groups.slice(0, 60).map((g) => g.id), [social.groups]);
  const idKey = ids.join(",");
  useEffect(() => {
    if (!idKey) return;
    let off = false;
    const poll = async () => {
      try {
        const next = await fetchLastMessages(idKey.split(",").map(Number));
        if (!off) setLatest(next);
      } catch {
        /* the list keeps its last previews */
      }
    };
    void poll();
    const t = setInterval(poll, 12_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [idKey]);

  // How many messages of each group have been read, kept on this device. A group you have not
  // opened before is treated as read, so joining the app does not start with a badge on everything.
  const seen = useMemo<Record<string, number>>(() => {
    try {
      return seenRaw ? (JSON.parse(seenRaw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  }, [seenRaw]);
  const unread = useCallback((g: Group) => (seen[g.id] === undefined ? 0 : Math.max(0, g.messages - seen[g.id])), [seen]);
  const markSeen = useCallback(
    (id: number, count: number) => {
      if (seen[id] !== undefined && seen[id] >= count) return;
      setSeenRaw(JSON.stringify({ ...seen, [id]: count }));
    },
    [seen, setSeenRaw]
  );

  const group = selected ? social.groups.find((g) => g.id === selected) : undefined;
  const joined = !!selected && social.myGroups.includes(selected);
  const missing = !!selected && !social.loading && !group;

  async function create(name: string) {
    setBusy(true);
    const r = await social.send("createGroup", [name, startAvatar(name)]);
    setBusy(false);
    return r.ok;
  }

  const showChat = !!selected;
  return (
    <AccountShell active="groups" wallet={wallet} app>
      <div className={`msgr ${showChat ? "has-chat" : ""} ${details && group ? "has-details" : ""}`}>
        <aside className="msgr-list" aria-label="Groups">
          <div className="msgr-switch" role="tablist" aria-label="Groups or rooms">
            {(["groups", "rooms"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={pane === t} className={pane === t ? "is-active" : ""} onClick={() => setPane(t)}>
                {t === "groups" ? "Groups" : "Rooms"}
              </button>
            ))}
          </div>
          {pane === "groups" ? (
            <GroupList
              groups={social.groups}
              mine={social.myGroups}
              latest={latest}
              selected={selected}
              unread={unread}
              signedIn={signedIn}
              busy={busy}
              onCreate={create}
              loading={social.loading}
            />
          ) : (
            <RoomsPane rooms={social.mine} groups={social.groups} signedIn={signedIn} send={social.send} />
          )}
        </aside>

        <section className="msgr-chat" aria-label="Conversation">
          {!selected ? (
            <div className="msgr-empty">
              <h2>Pick a group</h2>
              <p>Choose one on the left to read and join the conversation. Tap its name to see the leaderboard and rooms.</p>
            </div>
          ) : missing ? (
            <div className="msgr-empty"><h2>No group has that number</h2><Link href="/groups" className="btn-ghost small">Back to groups</Link></div>
          ) : !group ? (
            <div className="msgr-empty"><p>Reading the group from the chain…</p></div>
          ) : (
            <>
              <header className="msgr-chat-head">
                <Link href="/groups" className="msgr-icon msgr-back" aria-label="Back to groups"><ArrowLeft weight="bold" /></Link>
                <button type="button" className="msgr-title" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
                  <Avatar avatar={group.avatar} seed={`group-${group.id}`} name={group.name} size={40} />
                  <span><strong>{group.name}</strong><small>{group.members} members · {group.rooms} rooms · tap for info</small></span>
                </button>
                <button type="button" className="msgr-icon" aria-label="Group info" onClick={() => setDetails((v) => !v)}><Info weight="bold" /></button>
              </header>
              <ChatThread
                key={group.id}
                groupId={group.id}
                account={signedIn ? account : null}
                canPost={joined}
                post={(text) => social.send("postToGroup", [BigInt(group.id), text])}
                onJoin={() => (signedIn ? void social.send("joinGroup", [BigInt(group.id)]) : openAuth("login"))}
                onSeen={(count) => markSeen(group.id, count)}
              />
            </>
          )}
        </section>

        {details && group && (
          <aside className="msgr-details" aria-label="Group info">
            <GroupDetails key={group.id} group={group} account={account} joined={joined} onClose={() => setDetails(false)} send={social.send} />
          </aside>
        )}
      </div>
    </AccountShell>
  );
}
