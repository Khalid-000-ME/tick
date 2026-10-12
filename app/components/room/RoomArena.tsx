"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, PencilSimple } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { ChatThread } from "@/components/groups/ChatThread";
import { ArenaMarket } from "@/components/room/ArenaMarket";
import { MarketPicker } from "@/components/room/MarketPicker";
import { Scoreboard } from "@/components/room/Scoreboard";
import { openAuth } from "@/lib/authSession";
import { currentMarket, marketMessage } from "@/lib/chatTags";
import { useProfiles } from "@/lib/profiles";
import type { RoomRow } from "@/lib/server/standings";
import { fetchChat, fetchRoom, useSocial, type Group, type Post, type Room } from "@/lib/useSocial";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * A room, as a live contest.
 *
 * The owner picks a market and a window; everyone in the room plays that market on the real
 * contract, and a scoreboard ranks them by what they make on it, updating every few seconds. The
 * chart, the stake bar and the settling are the main terminal's own, so this is a different way to
 * play the same market rather than a second trading engine. Chat is on the right, and the owner's
 * market changes show up in it as notices.
 */
export function RoomArena({ id }: { id: number }) {
  const wallet = useTickWallet();
  const { account, status, walletClient } = wallet;
  const { send } = useSocial(account, walletClient);
  const signedIn = status === "ready" && !!account;

  const [info, setInfo] = useState<{ room: Room; group: Group | null; members: string[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [rows, setRows] = useState<RoomRow[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      const found = await fetchRoom(id);
      if (!found) return setMissing(true);
      setInfo(found);
    } catch {
      /* the page keeps what it has */
    }
  }, [id]);

  const loadChat = useCallback(async () => {
    try {
      setPosts(await fetchChat("room", id, 150));
    } catch {
      /* the thread keeps what it has */
    }
  }, [id]);

  useEffect(() => {
    let off = false;
    const tick = async () => {
      if (off) return;
      await Promise.all([loadInfo(), loadChat()]);
    };
    void tick();
    const a = setInterval(loadChat, 3000);
    const b = setInterval(loadInfo, 15_000);
    return () => {
      off = true;
      clearInterval(a);
      clearInterval(b);
    };
  }, [loadInfo, loadChat]);

  const owner = info?.room.creator ?? "";
  const market = useMemo(() => (owner ? currentMarket(posts ?? [], owner) : null), [posts, owner]);
  const members = info?.members ?? [];
  const memberKey = members.join(",");
  const feedId = market?.feed.id;
  const since = market?.at ?? 0;

  // The scoreboard: polled every three seconds, which is faster than a window settles.
  useEffect(() => {
    if (!feedId || !memberKey) return;
    let off = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/room-board?feed=${feedId}&since=${since}&addresses=${memberKey}`, { cache: "no-store" });
        const body = (await res.json()) as { rows?: RoomRow[]; at?: number };
        if (!off && body.rows) {
          setRows(body.rows);
          setUpdatedAt(body.at ?? Date.now());
        }
      } catch {
        /* the board keeps its last reading */
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [feedId, since, memberKey]);

  const profiles = useProfiles([owner].filter(Boolean));
  const ownerName = (() => {
    const p = profiles.get(owner.toLowerCase());
    return p?.displayName || (p?.username ? `@${p.username}` : owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : "");
  })();
  const isOwner = !!account && !!owner && account.toLowerCase() === owner.toLowerCase();
  const inRoom = !!account && members.includes(account.toLowerCase());

  async function setMarket(symbol: string, windowS: number) {
    const r = await send("postToRoom", [BigInt(id), marketMessage(symbol, windowS)]);
    if (r.ok) {
      setPicking(false);
      await loadChat();
    }
    return r;
  }

  async function join() {
    if (!signedIn) return openAuth("login");
    setBusy(true);
    await send("joinRoom", [BigInt(id)]);
    setBusy(false);
    await loadInfo();
  }

  return (
    <AccountShell active="groups" wallet={wallet} wide>
      {/* The profit's face, loaded once for the page; React hoists it into the head. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Pixel&display=swap" precedence="default" />

      {missing ? (
        <div className="page-empty">No room has that number.</div>
      ) : !info ? (
        <div className="page-empty">Reading the room from the chain…</div>
      ) : (
        <div className="arena">
          <header className="arena-head">
            <Link href={info.group ? `/groups/${info.group.id}` : "/groups"} className="arena-back" aria-label="Back to groups"><ArrowLeft weight="bold" /></Link>
            <div className="arena-title">
              <p>{info.group ? info.group.name : "Room"} · #{info.room.id}</p>
              <h1>{info.room.name}</h1>
              <p className="arena-meta">{members.length} {members.length === 1 ? "player" : "players"} · run by {ownerName}</p>
            </div>
            <div className="arena-actions">
              <button
                type="button"
                className="btn-ghost small"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/rooms/${info.room.id}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? <Check weight="bold" /> : <Copy weight="bold" />} {copied ? "Copied" : "Invite"}
              </button>
              {!inRoom && <button type="button" className="btn-solid small" disabled={busy} onClick={() => void join()}>{busy ? "Joining…" : signedIn ? "Join the room" : "Log in to join"}</button>}
              {isOwner && market && !picking && <button type="button" className="btn-ghost small" onClick={() => setPicking(true)}><PencilSimple weight="bold" /> Change market</button>}
            </div>
          </header>

          {isOwner && picking && market && (
            <section className="arena-pick"><MarketPicker current={{ symbol: market.feed.symbol, windowS: market.windowS }} onPick={setMarket} onCancel={() => setPicking(false)} /></section>
          )}

          <div className="arena-grid">
            <div className="arena-main">
              {market ? (
                <ArenaMarket key={`${market.feed.symbol}-${market.windowS}`} feed={market.feed} windowS={market.windowS} wallet={wallet} />
              ) : (
                <section className="arena-none">
                  <h2>{isOwner ? "Pick this room's market" : "Waiting for the owner"}</h2>
                  <p>{isOwner ? "Choose an asset and a window. Everyone you invite plays it live, and the scoreboard counts from the moment you start." : "The owner has not picked a market yet. When they do, the chart and the scoreboard come alive here."}</p>
                  {isOwner && <MarketPicker onPick={setMarket} />}
                </section>
              )}
            </div>

            <aside className="arena-side">
              {market && <Scoreboard rows={rows ?? []} account={account} roundSince={market.at} updatedAt={updatedAt} loading={rows === null} />}
              <section className="arena-chat msgr is-embedded">
                <header className="arena-chat-head"><h2>Room chat</h2><small>On chain</small></header>
                <ChatThread
                  groupId={info.room.id}
                  kind="room"
                  owner={owner}
                  account={signedIn ? account : null}
                  canPost={inRoom}
                  post={(text) => send("postToRoom", [BigInt(id), text])}
                  onJoin={() => void join()}
                  external={posts}
                  onReload={loadChat}
                />
              </section>
            </aside>
          </div>
        </div>
      )}
    </AccountShell>
  );
}
