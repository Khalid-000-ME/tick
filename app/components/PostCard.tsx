"use client";

import Link from "next/link";
import { useState } from "react";
import { Heart, SealCheck } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import type { FeedPost } from "@/lib/feed";
import type { Profile } from "@/lib/profiles";
import type { Standing } from "@/lib/useFeed";

/**
 * One post: who, their photo, the words, and the results card that makes it worth posting.
 *
 * The card is the point of the product, so it has its own look and is never confused with a
 * photo: dark glass, the profit in the pixel face, a glow that is green for a gain and ember
 * for a loss. On a photo it sits on the picture like a sticker; without one it is the post.
 * The figure is always read from the author's record on chain, never from the post itself.
 */
const money = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;

export function ago(at: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - at);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function ResultsCard({ standing, overlay = false, size }: { standing?: Standing; overlay?: boolean; size?: "hero" }) {
  const net = standing?.net ?? 0;
  const up = net >= 0;
  return (
    <div className={`results-card ${up ? "is-up" : "is-down"} ${overlay ? "is-overlay" : ""} ${size === "hero" ? "is-hero" : ""}`}>
      {/* The profit's face. React hoists this into the head once however many cards there are. */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Pixel&display=swap" precedence="default" />
      <span className="results-eyebrow">
        <SealCheck weight="fill" /> Verified on chain
      </span>
      <strong className="results-net">{standing ? money(net) : "…"}</strong>
      <span className="results-line">
        {standing
          ? standing.bets === 0
            ? "No calls yet"
            : `${standing.bets} calls${standing.rank ? ` · #${standing.rank} overall` : ""}${standing.open > 0 ? ` · $${standing.open.toFixed(2)} open` : ""}`
          : "Reading the chain"}
      </span>
    </div>
  );
}

export function PostCard({
  post,
  profile,
  standing,
  liked,
  onLike,
  you,
}: {
  post: FeedPost;
  profile?: Profile;
  standing?: Standing;
  liked: boolean;
  onLike: () => void;
  you: boolean;
}) {
  const name = profile?.displayName || (profile?.username ? `@${profile.username}` : `${post.author.slice(0, 6)}…${post.author.slice(-4)}`);
  // Anyone can post any bytes, so a photo that does not decode is left out rather than shown broken.
  const [broken, setBroken] = useState(false);
  const hasPhoto = post.imageBytes > 0 && !broken;

  return (
    <article className={`post ${you ? "is-you" : ""}`}>
      <header className="post-head">
        <Link href={`/w/${post.author}`} className="post-who">
          <Avatar avatar={profile?.avatar} seed={post.author} name={profile?.displayName || profile?.username} size={38} />
          <span>
            <strong>{name}</strong>
            {profile?.username && profile.displayName ? <small>@{profile.username}</small> : null}
          </span>
        </Link>
        <time dateTime={new Date(post.at * 1000).toISOString()}>{ago(post.at)}</time>
      </header>

      {hasPhoto && (
        <figure className="post-photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- read back from the chain, already a small WebP */}
          <img src={`/api/feed/image/${post.id}`} alt="" loading="lazy" onError={() => setBroken(true)} />
          {post.card && <ResultsCard standing={standing} overlay />}
        </figure>
      )}
      {!hasPhoto && post.card && <ResultsCard standing={standing} />}

      {post.caption && <p className="post-caption">{post.caption}</p>}

      <footer className="post-actions">
        <button type="button" className={`post-like ${liked ? "is-on" : ""}`} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} onClick={onLike}>
          <Heart weight={liked ? "fill" : "bold"} /> {post.likes > 0 ? post.likes : ""}
        </button>
        <Link href={`/w/${post.author}`} className="post-card-link">Their card</Link>
      </footer>
    </article>
  );
}
