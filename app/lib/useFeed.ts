"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletClient } from "viem";
import { PAGE, encodeImage, fetchFeed, fetchLikedBy, postGas, sendFeed, type FeedPost } from "@/lib/feed";

export interface Standing { address: string; bets: number; staked: number; returned: number; net: number; rank: number | null }

/**
 * The feed: the newest posts, older ones on demand, who has liked what, and how each author
 * is doing. The posts come from TickFeed and the results from the chain index, joined here so
 * a card is always drawn from the author's real record and never from anything in the post.
 */
export function useFeed(account: `0x${string}` | null, walletClient: WalletClient | null) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [standings, setStandings] = useState<Map<string, Standing>>(new Map());
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [outOf, setOutOf] = useState(0);
  const known = useRef(new Set<string>());

  /** Fetch results for any authors not seen yet, and which of these posts this wallet liked. */
  const enrich = useCallback(
    async (batch: FeedPost[], onChain = false) => {
      const fresh = [...new Set(batch.map((p) => p.author))].filter((a) => !known.current.has(a));
      fresh.forEach((a) => known.current.add(a));
      if (fresh.length) {
        try {
          const res = await fetch(`/api/standings?addresses=${fresh.join(",")}`, { cache: "no-store" });
          const body = (await res.json()) as { standings: Standing[]; of: number };
          setStandings((prev) => new Map([...prev, ...body.standings.map((s) => [s.address, s] as const)]));
          setOutOf(body.of);
        } catch {
          fresh.forEach((a) => known.current.delete(a));
        }
      }
      if (account) {
        const mine = await fetchLikedBy(account, batch.map((p) => p.id), onChain).catch(() => new Set<number>());
        setLiked((prev) => new Set([...prev, ...mine]));
      }
    },
    [account]
  );

  const refresh = useCallback(async (onChain = false) => {
    try {
      const top = await fetchFeed(0, PAGE, onChain);
      setPosts((prev) => {
        if (!prev) return top;
        // New posts and fresh like counts on the top page; older pages already loaded stay.
        const ids = new Set(top.map((p) => p.id));
        return [...top, ...prev.filter((p) => !ids.has(p.id))].sort((a, b) => b.id - a.id);
      });
      setHasMore(top.length === PAGE);
      await enrich(top, onChain);
    } catch {
      setPosts((prev) => prev ?? []);
    }
  }, [enrich]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await refresh(false);
    };
    void poll();
    const t = setInterval(poll, 15_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!posts?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await fetchFeed(posts[posts.length - 1].id, PAGE);
      setPosts((prev) => [...(prev ?? []), ...older]);
      setHasMore(older.length === PAGE);
      await enrich(older);
    } finally {
      setLoadingMore(false);
    }
  }, [posts, loadingMore, enrich]);

  const publish = useCallback(
    async (caption: string, image: Uint8Array, card: boolean) => {
      const r = await sendFeed(walletClient, account, "post", [caption, encodeImage(image), card], postGas(image.length));
      // Your own post is read from the chain: the indexer would show it a few seconds late.
      if (r.ok) await refresh(true);
      return r;
    },
    [walletClient, account, refresh]
  );

  const like = useCallback(
    async (id: number) => {
      const was = liked.has(id);
      // Shown at once and put right if the transaction does not go through.
      setLiked((prev) => {
        const next = new Set(prev);
        if (was) next.delete(id);
        else next.add(id);
        return next;
      });
      setPosts((prev) => prev?.map((p) => (p.id === id ? { ...p, likes: Math.max(0, p.likes + (was ? -1 : 1)) } : p)) ?? prev);
      const r = await sendFeed(walletClient, account, "like", [BigInt(id)], 120_000n);
      if (!r.ok) {
        setLiked((prev) => {
          const next = new Set(prev);
          if (was) next.add(id);
          else next.delete(id);
          return next;
        });
        setPosts((prev) => prev?.map((p) => (p.id === id ? { ...p, likes: Math.max(0, p.likes + (was ? 1 : -1)) } : p)) ?? prev);
      }
      return r;
    },
    [liked, walletClient, account]
  );

  return { posts, standings, liked, hasMore, loadingMore, outOf, loadMore, publish, like, refresh };
}
