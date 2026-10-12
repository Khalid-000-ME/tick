"use client";

import Image from "next/image";

/**
 * A trader's avatar from the reference stored in their profile.
 *
 *  - "gen:<style>:<seed>" draws one locally from the seed: no storage, no requests.
 *  - an https URL is shown only from a short list of image hosts (X, GitHub, Google,
 *    Imgur). Profiles are public and anyone can write any URL into theirs; rendering
 *    arbitrary hosts would let a profile plant a tracking pixel in every viewer's browser.
 *    Anything else falls back to a generated avatar.
 */
export const AVATAR_HOSTS = ["pbs.twimg.com", "avatars.githubusercontent.com", "lh3.googleusercontent.com", "i.imgur.com"];
export const AVATAR_STYLES = ["beam", "pixel", "rings"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

const PALETTES = [
  ["#153f31", "#5be08a", "#e8f5d0"],
  ["#2f3a63", "#8aa2ff", "#e6e9ff"],
  ["#6b1a1a", "#ff8a6b", "#ffe8df"],
  ["#5b4b0b", "#f5c542", "#fff4cf"],
  ["#3d2177", "#b18cff", "#efe6ff"],
  ["#0d4a40", "#5fe0c8", "#dcfbf4"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A photo uploaded through Tick: stored by content hash, served from this app. */
export const isUploadedAvatar = (v: string) => /^\/api\/avatar\/[a-f0-9]{32}$/.test(v);

export function isAllowedAvatarUrl(url: string): boolean {
  if (isUploadedAvatar(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && AVATAR_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function genAvatar(style: AvatarStyle, seed: string) {
  return `gen:${style}:${seed}`;
}

function Generated({ style, seed, size, initials }: { style: string; seed: string; size: number; initials: string }) {
  const h = hash(seed);
  const [dark, mid, light] = PALETTES[h % PALETTES.length];
  if (style === "pixel") {
    // A 5x5 grid mirrored left to right, the classic identicon.
    const cells: [number, number][] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((h >> (y * 3 + x)) & 1) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]); }
    return (
      <svg width={size} height={size} viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
        <rect width="5" height="5" fill={light} />
        {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={dark} />)}
      </svg>
    );
  }
  if (style === "rings") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" fill={dark} />
        <circle cx={10 + (h % 20)} cy={10 + ((h >> 5) % 20)} r="16" fill="none" stroke={mid} strokeWidth="5" />
        <circle cx={10 + ((h >> 9) % 20)} cy={10 + ((h >> 13) % 20)} r="8" fill={light} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={`g${h}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={mid} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" fill={`url(#g${h})`} />
      <text x="20" y="25.5" textAnchor="middle" fontSize="14" fontWeight="700" fill={light} fontFamily="system-ui, sans-serif">{initials}</text>
    </svg>
  );
}

export function Avatar({ avatar, seed, name, size = 32 }: { avatar?: string | null; seed: string; name?: string | null; size?: number }) {
  const initials = (name || seed.replace(/^0x/, "")).replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  let body: React.ReactNode;
  if (avatar && avatar.startsWith("gen:")) {
    const [, style, s] = avatar.split(":");
    body = <Generated style={style} seed={s || seed} size={size} initials={initials} />;
  } else if (avatar && isUploadedAvatar(avatar)) {
    // eslint-disable-next-line @next/next/no-img-element -- already a small square WebP
    body = <img src={avatar} alt="" width={size} height={size} />;
  } else if (avatar && isAllowedAvatarUrl(avatar)) {
    body = <Image src={avatar} alt="" width={size} height={size} unoptimized={false} />;
  } else {
    body = <Generated style="beam" seed={seed} size={size} initials={initials} />;
  }
  return <span className="avatar" style={{ width: size, height: size }}>{body}</span>;
}
