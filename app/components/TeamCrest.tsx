"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * A team's crest, or a stand-in when there is none.
 *
 * ESPN is the only source of logos, and it has none for some teams (a European side invited to an
 * NBA fixture, a club it has not catalogued) and its CDN can fail for others. A blank space reads as a
 * bug, so whenever there is no URL, or the one given does not load, the crest becomes a badge with the
 * team's initials on a colour taken from its name, the same colour every time so it stays recognisable.
 */
const initialsOf = (name: string | undefined, abbr: string) => {
  const words = (name ?? "").split(/\s+/).filter((w) => w && !/^(the|fc|cf|club)$/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0] ?? abbr).slice(0, 2).toUpperCase();
};

const hueOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};

export function TeamCrest({ logo, name, abbr, size }: { logo: string | null | undefined; name?: string; abbr: string; size: number }) {
  // Which URL failed, rather than a plain flag, so a different logo later is given its own chance.
  const [failed, setFailed] = useState<string | null>(null);
  if (logo && failed !== logo) {
    return <Image src={logo} alt="" width={size} height={size} onError={() => setFailed(logo)} />;
  }
  const hue = hueOf(name ?? abbr);
  return (
    <span
      className="team-crest"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)), background: `hsl(${hue} 42% 30%)`, color: `hsl(${hue} 70% 92%)` }}
    >
      {initialsOf(name, abbr)}
    </span>
  );
}
