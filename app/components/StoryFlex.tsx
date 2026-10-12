"use client";

import { motion, useSpring, useTransform, type MotionValue } from "motion/react";

/**
 * The end of the story: the win becomes a card, and the card is posted.
 *
 * This is the idea of the product, so it gets the last third of the scroll. In order:
 *   0.74 to 0.80  the card is generated: a scan sweeps down it, the profit counts up in the pixel
 *                 face and the verified badge lands, as the trading window falls away
 *   0.82 to 0.91  it settles into a composer, a caption types itself and a cursor taps Post
 *   0.92 to 1.00  the composer becomes a post in the feed, the card in the same place, and the
 *                 likes start to come in
 *
 * One card element travels through all three, so it reads as the same object being made, then
 * shared, rather than three pictures. It uses the app's own results-card classes, so it is the
 * card people will actually see in the feed.
 */
const CAPTION = "30 seconds. Called it.";
const LIKES = 24;
const NET = 0.96;

export function StoryFlex({ p, bouncy }: { p: MotionValue<number>; bouncy: { stiffness: number; damping: number; mass: number } }) {
  // ---- the card: where it is, how big, and what it shows
  const cardIn = useTransform(p, [0.74, 0.8], [0, 1]);
  const cardOpacity = useTransform(p, [0.74, 0.77], [0, 1]);
  const rise = useSpring(useTransform(p, [0.74, 0.8], [26, 0]), bouncy);
  // Large and centred while it is made, then it tucks into the composer, then up into the post.
  const scale = useTransform(p, [0.74, 0.8, 0.82, 0.88, 0.92, 0.97], [0.86, 1.12, 1.12, 0.96, 0.96, 0.9]);
  const y = useTransform(p, [0.74, 0.8, 0.82, 0.88, 0.92, 0.97], [0, 0, 0, 8, 8, 3]);
  const scanY = useTransform(p, [0.75, 0.8], ["-12%", "112%"]);
  const scanOpacity = useTransform(p, [0.75, 0.76, 0.795, 0.805], [0, 1, 1, 0]);
  const net = useTransform(p, [0.76, 0.81], [0, NET]);
  const netText = useTransform(net, (v) => `+$${v.toFixed(2)}`);
  const badge = useTransform(p, [0.795, 0.815], [0, 1]);
  const line = useTransform(p, [0.805, 0.825], [0, 1]);
  const glow = useTransform(p, [0.74, 0.8, 0.84, 1], [0, 1, 0.55, 0.55]);
  const making = useTransform(p, [0.745, 0.755, 0.8, 0.815], [0, 1, 1, 0]);
  const made = useTransform(p, [0.81, 0.825, 0.84, 0.86], [0, 1, 1, 0]);

  // ---- the white panel the card moves into
  const panel = useTransform(p, [0.82, 0.86], [0, 1]);
  const panelY = useSpring(useTransform(p, [0.82, 0.86], [24, 0]), bouncy);
  const composing = useTransform(p, [0.86, 0.9, 0.915, 0.925], [0, 1, 1, 0]);
  const posted = useTransform(p, [0.925, 0.945], [0, 1]);

  // ---- composing: the caption types, the cursor goes to Post and taps it
  const typed = useTransform(p, [0.845, 0.89], [0, CAPTION.length]);
  const typedText = useTransform(typed, (v) => CAPTION.slice(0, Math.round(v)));
  const cursorX = useTransform(p, [0.875, 0.9], [-70, 0]);
  const cursorY = useTransform(p, [0.875, 0.9], [-60, 0]);
  const cursorOpacity = useTransform(p, [0.875, 0.885, 0.915, 0.925], [0, 1, 1, 0]);
  const cursorPress = useTransform(p, [0.9, 0.905, 0.912, 0.918], [1, 0.8, 0.8, 1]);
  const postPress = useSpring(useTransform(p, [0.898, 0.906, 0.914, 0.922], [1, 0.93, 0.93, 1]), bouncy);

  // ---- posted: the toast, and the likes arriving
  const toast = useTransform(p, [0.93, 0.945], [0, 1]);
  const toastY = useSpring(useTransform(p, [0.93, 0.945], [14, 0]), bouncy);
  const likes = useTransform(p, [0.95, 0.995], [0, LIKES]);
  const likesText = useTransform(likes, (v) => String(Math.round(v)));
  const heartPop = useSpring(useTransform(p, [0.945, 0.955, 0.97], [1, 1.35, 1]), bouncy);
  const heartFill = useTransform(p, [0.95, 0.955], [0, 1]);

  return (
    <div className="story-flex" aria-hidden="true">
      <motion.i className="sf-glow" style={{ opacity: glow }} />

      <motion.div className="sf-panel" style={{ opacity: panel, y: panelY }}>
        <motion.div className="sf-compose" style={{ opacity: composing }}>
          <div className="sf-row">
            <span className="sf-avatar">you</span>
            <p className="sf-typed"><motion.span>{typedText}</motion.span><i className="sf-caret" /></p>
          </div>
          <div className="sf-bar">
            <span className="sf-pill">Photo</span>
            <span className="sf-check"><b>✓</b> Show my card</span>
            <motion.span className="sf-post-btn" style={{ scale: postPress }}>Post</motion.span>
          </div>
          <motion.div className="sf-cursor" style={{ x: cursorX, y: cursorY, opacity: cursorOpacity, scale: cursorPress }}>
            <svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2 L4 19 L8.5 14.6 L11.6 21.4 L14.4 20.2 L11.3 13.5 L17.6 13.5 Z" fill="#10120f" stroke="#ffffff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </motion.div>
        </motion.div>

        <motion.div className="sf-post" style={{ opacity: posted }}>
          <div className="sf-row sf-post-head">
            <span className="sf-avatar">you</span>
            <span className="sf-who"><strong>You</strong><small>now</small></span>
          </div>
          <p className="sf-caption">{CAPTION}</p>
          <div className="sf-likes">
            <motion.span className="sf-heart" style={{ scale: heartPop }}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.6 1.1 4.6 2.7C12 6.1 13.600 5 15.600 5 19 5 21.100 8.400 19.600 11.800 17.500 16.400 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <motion.path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.6 1.1 4.6 2.7C12 6.1 13.600 5 15.600 5 19 5 21.100 8.400 19.600 11.800 17.500 16.400 12 21 12 21z" fill="#e5484d" style={{ opacity: heartFill }} />
              </svg>
            </motion.span>
            <motion.b>{likesText}</motion.b>
          </div>
        </motion.div>
      </motion.div>

      <motion.div className="sf-card" style={{ opacity: cardOpacity, scale: useTransform([scale, cardIn], ([a, b]: number[]) => a * (0.9 + 0.1 * b)), y: useTransform([y, rise], ([a, b]: number[]) => a + b) }}>
        <div className="results-card is-up is-flex">
          <motion.i className="sf-scan" style={{ top: scanY, opacity: scanOpacity }} />
          <motion.span className="results-eyebrow" style={{ opacity: badge }}>Verified on chain</motion.span>
          <motion.strong className="results-net">{netText}</motion.strong>
          <motion.span className="results-line" style={{ opacity: line }}>1 call · #1 overall</motion.span>
        </div>
        <div className="sf-status">
          <motion.span style={{ opacity: making }}>Reading your record from the chain…</motion.span>
          <motion.span style={{ opacity: made }}>Your card is ready</motion.span>
        </div>
      </motion.div>

      <motion.div className="sf-toast" style={{ opacity: toast, y: toastY, x: "-50%" }}>
        <i>✓</i> Posted. Your crew can see it.
      </motion.div>
    </div>
  );
}
