"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero's moving backdrop: two clips played back to back, forever.
 *
 * Each clip plays to its end, then the next one starts from its first frame and the two
 * cross-fade, so neither ever shows the jump of a raw loop. Both are muted, inline and
 * small (no audio track, ~3 MB together), and only the visible one is decoding. Anyone who
 * asked for reduced motion gets the first frame as a still, and so does a browser that
 * refuses autoplay.
 */
const CLIPS = [
  { src: "/hero/forest.mp4", poster: "/hero/forest.jpg" },
  { src: "/hero/window.mp4", poster: "/hero/window.jpg" },
] as const;

/** Start the hand-off this long before a clip ends, so the fade overlaps its last frames. */
const FADE_S = 1.1;

export function HeroReel({ still = false }: { still?: boolean }) {
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (still) return;
    const vids = refs.current;
    const current = vids[active];
    if (!current) return;
    const next = vids[(active + 1) % CLIPS.length];
    let handed = false;

    current.currentTime = 0;
    void current.play().catch(() => {
      /* autoplay refused: the poster stays up, which is a fine hero on its own */
    });
    // Warm the next clip so its first frame is ready when the fade starts. Only the
    // preload hint: calling load() would also reset a clip that is still fading out.
    if (next) next.preload = "auto";

    const onTime = () => {
      if (handed || !current.duration) return;
      if (current.duration - current.currentTime <= FADE_S) {
        handed = true;
        setActive((a) => (a + 1) % CLIPS.length);
      }
    };
    current.addEventListener("timeupdate", onTime);
    // If timeupdate is throttled (background tab), ending still advances.
    const onEnd = () => {
      if (!handed) {
        handed = true;
        setActive((a) => (a + 1) % CLIPS.length);
      }
    };
    current.addEventListener("ended", onEnd);
    return () => {
      current.removeEventListener("timeupdate", onTime);
      current.removeEventListener("ended", onEnd);
    };
  }, [active, still]);

  return (
    <div className="hero-reel" aria-hidden="true">
      {CLIPS.map((c, i) => (
        <video
          key={c.src}
          ref={(el) => { refs.current[i] = el; }}
          className={`hero-reel-clip ${i === active ? "is-active" : ""}`}
          src={still ? undefined : c.src}
          poster={c.poster}
          muted
          playsInline
          preload={i === 0 ? "auto" : "metadata"}
          disablePictureInPicture
        />
      ))}
      <div className="hero-reel-grade" />
      <div className="hero-reel-glow" />
      <div className="hero-reel-vignette" />
      <div className="hero-reel-scan" />
    </div>
  );
}
