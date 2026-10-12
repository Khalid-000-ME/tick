"use client";

import { useMemo, useState } from "react";
import { AccountShell } from "@/components/AccountShell";
import { Composer } from "@/components/Composer";
import { PostCard } from "@/components/PostCard";
import { openAuth } from "@/lib/authSession";
import { useFeed } from "@/lib/useFeed";
import { useProfiles, useMyProfile } from "@/lib/profiles";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * The home of the app: what everyone posted, newest first or by who is up the most.
 *
 * Latest is the order the chain gives. Top re-orders what is loaded by each author's real
 * net result, so the people doing best float up without anyone deciding who that is.
 */
type Tab = "latest" | "top";

export function FeedView() {
  const wallet = useTickWallet();
  const { account, walletClient, status } = wallet;
  const feed = useFeed(account, walletClient);
  const { profile } = useMyProfile(account, walletClient);
  const [tab, setTab] = useState<Tab>("latest");

  const profiles = useProfiles(feed.posts?.map((p) => p.author) ?? []);
  const shown = useMemo(() => {
    const list = feed.posts ?? [];
    if (tab === "latest") return list;
    return [...list].sort((a, b) => (feed.standings.get(b.author)?.net ?? 0) - (feed.standings.get(a.author)?.net ?? 0) || b.id - a.id);
  }, [feed.posts, feed.standings, tab]);

  const signedIn = status === "ready" && !!account;

  return (
    <AccountShell active="feed" wallet={wallet}>
      <div className="feed-col">
        <Composer
          account={signedIn ? account : null}
          profile={profile ?? undefined}
          onPost={feed.publish}
          onLogin={() => openAuth("login")}
        />

        <div className="feed-tabs" role="tablist" aria-label="Feed order">
          {(["latest", "top"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>
              {t === "latest" ? "Latest" : "Top"}
            </button>
          ))}
        </div>

        {feed.posts === null ? (
          <p className="feed-empty">Reading the feed from the chain…</p>
        ) : shown.length === 0 ? (
          <p className="feed-empty">Nothing posted yet. Be the first, with a photo and your card.</p>
        ) : (
          <>
            {shown.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                profile={profiles.get(p.author)}
                standing={feed.standings.get(p.author)}
                liked={feed.liked.has(p.id)}
                onLike={() => (signedIn ? void feed.like(p.id) : openAuth("login"))}
                you={!!account && p.author === account.toLowerCase()}
              />
            ))}
            {feed.hasMore && (
              <button type="button" className="btn-ghost feed-more" disabled={feed.loadingMore} onClick={() => void feed.loadMore()}>
                {feed.loadingMore ? "Loading…" : "Older posts"}
              </button>
            )}
          </>
        )}
      </div>
    </AccountShell>
  );
}
