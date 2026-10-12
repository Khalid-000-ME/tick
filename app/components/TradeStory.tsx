"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";

/**
 * One whole trade, played by scrolling.
 *
 * The panel pins to the screen while the section scrolls past, and scroll position is the
 * clock: a market opens with its strike, a cursor taps Above, thirty seconds run down while
 * the price climbs past the strike, and the result lands. Every beat is tied to scroll, so
 * the reader sets the pace and can scrub back. The numbers are illustrative, not live.
 *
 * Beats, as fractions of the section's scroll:
 *   0.00 to 0.18  the market opens, history draws, the strike line appears
 *   0.18 to 0.38  the cursor moves in and taps Above
 *   0.38 to 0.80  the 30-second window: countdown, price line, live price
 *   0.80 to 1.00  the win
 */
const STRIKE = 83621;
const W = 600;
const STRIKE_Y = 170;
const PX_PER_USD = 2.2;
const yOf = (price: number) => STRIKE_Y - (price - STRIKE) * PX_PER_USD;

// Before the stake: a little drift around the strike.
const HISTORY = Array.from({ length: 11 }, (_, i) => ({
  x: i * 12,
  price: STRIKE + Math.sin(i * 1.3) * 4 - (i === 10 ? Math.sin(13) * 4 : 0),
}));
// The window: chop early, then a climb that finishes well above the strike.
const N = 26;
const TRADE = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1);
  return { x: 120 + t * (W - 120), price: STRIKE + Math.pow(t, 1.6) * 47 + Math.sin(i * 1.7) * 4 * (1 - t) };
});
const pathOf = (pts: { x: number; price: number }[]) =>
  pts.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${yOf(p.price).toFixed(1)}`).join(" ");

const WINDOW: [number, number] = [0.38, 0.8];
const STOPS = TRADE.map((_, i) => WINDOW[0] + (i / (N - 1)) * (WINDOW[1] - WINDOW[0]));
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CAPTIONS = [
  { range: [0, 0.18], title: "A market opens every 30 seconds.", body: `The strike is Bitcoin's price right now: ${usd(STRIKE)}.` },
  { range: [0.18, 0.38], title: "Think it ends higher? Tap Above.", body: "One tap. $1 staked. No order book to fill." },
  { range: [0.38, 0.8], title: "Thirty seconds. That's it.", body: "The price runs against the strike, live from Pyth." },
  { range: [0.8, 1], title: "You won.", body: "Paid to your balance automatically. The next market is already open." },
] as const;

export function TradeStory() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });

  // Opening
  const cardIn = useTransform(p, [0, 0.06], [0.92, 1]);
  const cardOpacity = useTransform(p, [0, 0.05], [0.4, 1]);
  const historyLen = useTransform(p, [0.02, 0.14], [0, 1]);
  const historyOpacity = useTransform(p, [0.02, 0.03], [0, 1]);
  const strikeLen = useTransform(p, [0.08, 0.17], [0, 1]);
  const strikeLabel = useTransform(p, [0.14, 0.18], [0, 1]);

  // The tap
  const cursorX = useTransform(p, [0.18, 0.31], [260, 0]);
  const cursorY = useTransform(p, [0.18, 0.31], [150, 0]);
  const cursorOpacity = useTransform(p, [0.18, 0.22, 0.42, 0.46], [0, 1, 1, 0]);
  const cursorPress = useTransform(p, [0.31, 0.33, 0.35], [1, 0.82, 1]);
  const ripple = useTransform(p, [0.33, 0.4], [0, 2.6]);
  const rippleOpacity = useTransform(p, [0.33, 0.4], [0.7, 0]);
  const aboveFill = useTransform(p, [0.32, 0.34], ["rgba(34,197,94,0.08)", "rgba(34,197,94,1)"]);
  const aboveText = useTransform(p, [0.32, 0.34], ["#4ade80", "#06120a"]);
  const belowDim = useTransform(p, [0.32, 0.36], [1, 0.35]);
  const tapHint = useTransform(p, [0.3, 0.34], [1, 0]);
  const stakedNote = useTransform(p, [0.34, 0.38], [0, 1]);

  // The window
  const tradeLen = useTransform(p, WINDOW, [0, 1]);
  const dotX = useTransform(p, STOPS, TRADE.map((t) => t.x));
  const dotY = useTransform(p, STOPS, TRADE.map((t) => yOf(t.price)));
  const dotOpacity = useTransform(p, [0.37, 0.39], [0, 1]);
  const price = useTransform(p, STOPS, TRADE.map((t) => t.price));
  const priceText = useTransform(price, usd);
  const countdown = useTransform(p, WINDOW, [30, 0]);
  const countdownText = useTransform(countdown, (v) => `${Math.ceil(v)}s`);
  const barWidth = useTransform(p, WINDOW, ["100%", "0%"]);
  const aboveZone = useTransform(p, [0.55, 0.7], [0, 1]);

  // The win
  const wonOpacity = useTransform(p, [0.8, 0.85], [0, 1]);
  const wonScale = useTransform(p, [0.8, 0.86], [0.8, 1]);

  return (
    <section ref={ref} className="story" aria-label="How a trade plays out">
      <div className="story-sticky">
        <div className="story-copy">
          <p className="story-eyebrow">One trade, start to finish</p>
          <div className="story-captions">
            {CAPTIONS.map((c, i) => (
              <Caption key={c.title} p={p} range={c.range} first={i === 0} last={i === CAPTIONS.length - 1} title={c.title} body={c.body} />
            ))}
          </div>
          <div className="story-steps" aria-hidden="true">
            {CAPTIONS.map((c) => (
              <Step key={c.title} p={p} range={c.range} />
            ))}
          </div>
        </div>

        <motion.div className="story-card" style={{ scale: cardIn, opacity: cardOpacity }}>
          <div className="story-card-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/asset-icons/btc.png" alt="" width={36} height={36} />
            <div>
              <strong>BTC/USD</strong>
              <span>30s market</span>
            </div>
            <motion.em className="story-count">{countdownText}</motion.em>
          </div>
          <div className="story-bar"><motion.span style={{ width: barWidth }} /></div>

          <div className="story-price-row">
            <motion.strong>{priceText}</motion.strong>
            <span>Strike {usd(STRIKE)}</span>
          </div>

          <svg className="story-chart" viewBox={`0 0 ${W} 260`} aria-hidden="true">
            <defs>
              <linearGradient id="story-up" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>
            <motion.rect x="0" y="0" width={W} height={STRIKE_Y} fill="url(#story-up)" style={{ opacity: aboveZone }} />
            <motion.line x1="0" y1={STRIKE_Y} x2={W} y2={STRIKE_Y} stroke="#e8ecd9" strokeWidth="1.5" strokeDasharray="6 6" style={{ scaleX: strikeLen, originX: 0, transformBox: "fill-box" }} />
            <motion.g style={{ opacity: strikeLabel }}>
              <rect x={W - 92} y={STRIKE_Y - 13} width="92" height="26" rx="6" fill="#e8ecd9" />
              <text x={W - 46} y={STRIKE_Y + 5} textAnchor="middle" fontSize="13" fontFamily="ui-monospace, monospace" fill="#0b0f09">STRIKE</text>
            </motion.g>
            <motion.path d={pathOf(HISTORY)} fill="none" stroke="#8b927f" strokeWidth="3" strokeLinecap="round" style={{ pathLength: historyLen, opacity: historyOpacity }} />
            <motion.path d={pathOf(TRADE)} fill="none" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: tradeLen, opacity: dotOpacity }} />
            <motion.circle r="7" fill="#4ade80" style={{ cx: dotX, cy: dotY, opacity: dotOpacity }} />
            <motion.circle r="16" fill="#4ade80" fillOpacity="0.25" style={{ cx: dotX, cy: dotY, opacity: dotOpacity }} />
          </svg>

          <div className="story-sides">
            <motion.div className="story-side is-up" style={{ background: aboveFill, color: aboveText }}>
              <span>Above</span>
              <small>wins 1.96x</small>
              <motion.i className="story-ripple" style={{ scale: ripple, opacity: rippleOpacity }} />
              <motion.div className="story-cursor" style={{ x: cursorX, y: cursorY, opacity: cursorOpacity, scale: cursorPress }}>
                <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
                  <path d="M4 2 L4 19 L8.5 14.6 L11.6 21.4 L14.4 20.2 L11.3 13.5 L17.6 13.5 Z" fill="#f4f6ec" stroke="#0b0f09" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
              </motion.div>
            </motion.div>
            <motion.div className="story-side is-down" style={{ opacity: belowDim }}>
              <span>Below</span>
              <small>wins 2.04x</small>
            </motion.div>
          </div>
          <div className="story-status">
            <motion.span style={{ opacity: tapHint }}>Tap a side to stake</motion.span>
            <motion.span style={{ opacity: stakedNote }}>Staked $1 on Above</motion.span>
          </div>

          <motion.div className="story-won" style={{ opacity: wonOpacity }}>
            {Array.from({ length: 12 }, (_, i) => (
              <Spark key={i} p={p} angle={(i / 12) * Math.PI * 2} />
            ))}
            <motion.div className="story-won-inner" style={{ scale: wonScale }}>
              <p>You won</p>
              <strong>$1.96</strong>
              <span>paid out on a $1 stake, in 30 seconds</span>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/** A caption fades up in its beat and out at the next; the first is visible on arrival, the last stays. */
function Caption({ p, range, first, last, title, body }: { p: MotionValue<number>; range: readonly [number, number]; first: boolean; last: boolean; title: string; body: string }) {
  const [a, b] = range;
  const opacity = useTransform(p, [a, a + 0.03, b - 0.03, b], [first ? 1 : 0, 1, 1, last ? 1 : 0]);
  const y = useTransform(p, [a, a + 0.03, b - 0.03, b], [first ? 0 : 24, 0, 0, last ? 0 : -24]);
  return (
    <motion.div className="story-caption" style={{ opacity, y }}>
      <h2>{title}</h2>
      <p>{body}</p>
    </motion.div>
  );
}

function Step({ p, range }: { p: MotionValue<number>; range: readonly [number, number] }) {
  const fill = useTransform(p, [range[0], range[1]], ["0%", "100%"]);
  return <span><motion.i style={{ width: fill }} /></span>;
}

/** Sparks thrown out from the win. */
function Spark({ p, angle }: { p: MotionValue<number>; angle: number }) {
  const dist = useTransform(p, [0.8, 0.92], [0, 170]);
  const x = useTransform(dist, (d) => Math.cos(angle) * d);
  const y = useTransform(dist, (d) => Math.sin(angle) * d);
  const opacity = useTransform(p, [0.8, 0.84, 0.92, 0.96], [0, 1, 1, 0]);
  return <motion.i className="story-spark" style={{ x, y, opacity }} />;
}
