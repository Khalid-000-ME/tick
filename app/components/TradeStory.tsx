"use client";

import { useRef } from "react";
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";

/**
 * One whole trade, played by scrolling.
 *
 * The panel pins to the screen while the section scrolls past, and scroll position is the
 * clock: a market opens with its strike, a cursor taps Above, the thirty-second window runs
 * (compressed, so it does not take a long scroll) while candles print past the strike, and
 * the result lands. Every beat is tied to scroll, so the reader sets the pace and can scrub
 * back. The chart is drawn the way the terminal draws it: candles, a volume pane, a dashed
 * strike, a price axis and a live price tag. The numbers are illustrative, not live.
 *
 * Beats, as fractions of the section's scroll:
 *   0.00 to 0.12  the market opens: history candles print, the strike line appears
 *   0.12 to 0.40  the click, the longest beat: approach, hover, press, release, confirm
 *   0.40 to 0.62  the 30-second window: countdown, candles climb, live price tag
 *   0.64 to 1.00  the win
 */

// ---- the price series ----------------------------------------------------------------
// Four ticks per candle. Eight candles of history drift around the opening price; fourteen
// candles of window chop early, then climb well clear of the strike.
const TICKS_PER = 4;
const HISTORY_CANDLES = 8;
const WINDOW_CANDLES = 14;
const SERIES = (() => {
  const s: number[] = [];
  const total = (HISTORY_CANDLES + WINDOW_CANDLES) * TICKS_PER;
  for (let i = 0; i <= total; i++) {
    if (i <= HISTORY_CANDLES * TICKS_PER) {
      s.push(83621 + Math.sin(i * 0.9) * 5 + Math.sin(i * 0.37) * 3);
    } else {
      const open = s[HISTORY_CANDLES * TICKS_PER];
      const u = (i - HISTORY_CANDLES * TICKS_PER) / (total - HISTORY_CANDLES * TICKS_PER);
      s.push(open + Math.pow(u, 1.5) * 46 + Math.sin(i * 1.1) * 5 * (1 - u * 0.6) + Math.sin(i * 2.3) * 2);
    }
  }
  return s;
})();
/** The strike is the price at the instant the window opens: the last history close. */
const STRIKE = SERIES[HISTORY_CANDLES * TICKS_PER];

interface Candle { x: number; open: number; close: number; high: number; low: number; vol: number }
const PLOT_W = 520;
const STEP = PLOT_W / (HISTORY_CANDLES + WINDOW_CANDLES + 1);
const CANDLES: Candle[] = Array.from({ length: HISTORY_CANDLES + WINDOW_CANDLES }, (_, k) => {
  const slice = SERIES.slice(k * TICKS_PER, k * TICKS_PER + TICKS_PER + 1);
  const window = k >= HISTORY_CANDLES;
  return {
    x: 14 + k * STEP,
    open: slice[0],
    close: slice[slice.length - 1],
    high: Math.max(...slice) + 0.9,
    low: Math.min(...slice) - 0.9,
    // Volume picks up once the window opens and people are staking.
    vol: (window ? 18 : 8) + Math.abs(Math.sin(k * 2.7)) * (window ? 26 : 12),
  };
});

// ---- geometry ------------------------------------------------------------------------
const LO = 83598;
const HI = 83690;
const PANE_TOP = 12;
const PANE_BOTTOM = 236;
const yOf = (price: number) => PANE_BOTTOM - ((price - LO) / (HI - LO)) * (PANE_BOTTOM - PANE_TOP);
const STRIKE_Y = yOf(STRIKE);
const VOL_BOTTOM = 298;
const TICKS = [83600, 83620, 83640, 83660, 83680];
const BODY_W = 12;

// ---- timeline -------------------------------------------------------------------------
const WINDOW: [number, number] = [0.4, 0.62];
const slot = (j: number) => {
  const len = (WINDOW[1] - WINDOW[0]) / WINDOW_CANDLES;
  return [WINDOW[0] + j * len, WINDOW[0] + (j + 1) * len] as const;
};
// The live price: the strike at the open, then each window candle's close as it completes.
const PRICE_STOPS = [WINDOW[0], ...Array.from({ length: WINDOW_CANDLES }, (_, j) => slot(j)[1])];
const PRICE_VALUES = [STRIKE, ...CANDLES.slice(HISTORY_CANDLES).map((c) => c.close)];

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CAPTIONS = [
  { range: [0, 0.12], title: "A market opens every 30 seconds.", body: `Strike: ${usd(STRIKE)}, Bitcoin right now.` },
  { range: [0.12, 0.4], title: "Think it ends higher? Tap Above.", body: "One tap. $1 staked." },
  { range: [0.4, 0.64], title: "Thirty seconds. That's it.", body: "Live from Pyth." },
  { range: [0.64, 1], title: "You won.", body: "Paid out automatically." },
] as const;

export function TradeStory() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });

  // Opening
  const cardIn = useTransform(p, [0, 0.06], [0.92, 1]);
  const cardOpacity = useTransform(p, [0, 0.05], [0.4, 1]);

  // The card stays flat and face-on. No tilt, no turn: the only real motion is the bounce
  // when the cursor clicks, so the click is the thing the eye goes to.
  //   entry    rises a little and scales up as it comes in
  //   hover    a touch of anticipation as the cursor arrives
  //   press    squashes down and dips, as if pushed into the page
  //   release  springs back past its resting size and hops up, then settles
  //   win      lifts and grows slightly, then holds for the rest of the section
  const CAM = [0, 0.1, 0.28, 0.325, 0.345, 0.4, 0.68, 1];
  // Low damping on the click values, so the release overshoots and wobbles out.
  const bouncy = { stiffness: 300, damping: 13, mass: 0.6 };
  const zoom = useSpring(useTransform(p, CAM, [0.92, 1, 1.02, 0.94, 1.08, 1, 1.04, 1.04]), bouncy);
  const lift = useSpring(useTransform(p, CAM, [70, 0, -4, 10, -16, 0, -10, -10]), bouncy);
  const cardScale = useTransform([zoom, cardIn], ([z, c]: number[]) => z * c);
  // One steady shadow, pulled in tight while the card is pressed down.
  const cardShadow = useTransform(lift, (v) =>
    `0px ${(30 + v * 0.7).toFixed(1)}px ${(70 + v * 1.0).toFixed(1)}px rgba(16,18,15,0.22)`
  );
  // A lime glow behind the card: faint as it rises, warmer through the window, a bloom on the win.
  const glowOpacity = useTransform(p, [0, 0.12, 0.33, 0.35, 0.4, 0.62, 0.68, 1], [0, 0.25, 0.35, 0.8, 0.3, 0.5, 0.9, 0.9]);
  const glowScale = useTransform(p, [0, 0.62, 0.7, 1], [0.7, 0.95, 1.15, 1.15]);
  const strikeLen = useTransform(p, [0.05, 0.11], [0, 1]);
  const strikeTags = useTransform(p, [0.1, 0.12], [0, 1]);

  // The click, beat by beat (see CAM above). The cursor arcs in rather than sliding.
  const cursorX = useTransform(p, [0.12, 0.2, 0.26, 0.28], [280, 190, 34, 0]);
  const cursorY = useTransform(p, [0.12, 0.2, 0.26, 0.28], [170, 50, 8, 0]);
  const cursorOpacity = useTransform(p, [0.12, 0.15, 0.38, 0.41], [0, 1, 1, 0]);
  const cursorPress = useTransform(p, [0.31, 0.32, 0.335, 0.345], [1, 0.78, 0.78, 1]);
  // The button: lifts and glows on hover, sinks on press, pops on release, settles.
  const aboveScale = useSpring(useTransform(p, [0.27, 0.29, 0.31, 0.325, 0.345, 0.37], [1, 1.05, 1.05, 0.93, 1.06, 1]), bouncy);
  const aboveGlow = useTransform(p, [0.27, 0.29, 0.31, 0.335, 0.37, 0.4], [
    "0 0 0 0 rgba(22,163,74,0)",
    "0 0 0 3px rgba(22,163,74,0.3)",
    "0 0 0 3px rgba(22,163,74,0.3)",
    "0 0 0 1px rgba(22,163,74,0.18)",
    "0 0 40px 6px rgba(74,222,128,0.55)",
    "0 0 0 0 rgba(74,222,128,0)",
  ]);
  const ripple = useTransform(p, [0.335, 0.38], [0, 3.2]);
  const rippleOpacity = useTransform(p, [0.335, 0.38], [0.8, 0]);
  const aboveFill = useTransform(p, [0.333, 0.345], ["rgba(22,163,74,0.06)", "rgba(34,197,94,1)"]);
  const aboveText = useTransform(p, [0.333, 0.345], ["#15803d", "#06120a"]);
  const belowDim = useTransform(p, [0.335, 0.36], [1, 0.35]);
  const tapHint = useTransform(p, [0.3, 0.33], [1, 0]);
  const stakedNote = useTransform(p, [0.36, 0.39], [0, 1]);
  const toastOpacity = useTransform(p, [0.355, 0.365, 0.395, 0.41], [0, 1, 1, 0]);
  const toastY = useSpring(useTransform(p, [0.355, 0.37], [16, 0]), bouncy);

  // The window, compressed: the countdown still reads 30 to 0, just over a shorter scroll.
  const price = useTransform(p, PRICE_STOPS, PRICE_VALUES);
  const priceText = useTransform(price, usd);
  const tagText = useTransform(price, plain);
  const tagY = useTransform(price, (v) => yOf(v) - 11);
  const tagFill = useTransform(p, [0.39, 0.41], ["#b8baae", "#22c55e"]);
  const tagOpacity = useTransform(p, [0.08, 0.11], [0, 1]);
  const countdown = useTransform(p, WINDOW, [30, 0]);
  const countdownText = useTransform(countdown, (v) => `${Math.ceil(v)}s`);
  const barWidth = useTransform(p, WINDOW, ["100%", "0%"]);
  const aboveZone = useTransform(p, [0.5, 0.6], [0, 1]);

  // The win
  const wonOpacity = useTransform(p, [0.64, 0.69], [0, 1]);
  const wonScale = useTransform(p, [0.64, 0.7], [0.8, 1]);

  return (
    <section ref={ref} id="how" className="story" aria-label="How a trade plays out">
      {/* Geist Pixel is too new for this Next version's next/font/google list, so the
          payout's face is loaded as a stylesheet. React hoists it into the head, and it is
          declared here so only the landing page pays for it. The lint rule below is about
          the pages router's _document, which this app does not use. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Pixel&display=swap" precedence="default" />
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

        <div className="story-stage">
        <motion.i className="story-glow" style={{ opacity: glowOpacity, scale: glowScale }} aria-hidden="true" />
        <motion.div
          className="story-card"
          style={{ scale: cardScale, opacity: cardOpacity, y: lift, boxShadow: cardShadow }}
        >
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

          <svg className="story-chart" viewBox="0 0 600 300" aria-hidden="true">
            <defs>
              <linearGradient id="story-up" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid and price axis, as on the terminal */}
            {TICKS.map((t) => (
              <g key={t}>
                <line x1="0" x2={PLOT_W} y1={yOf(t)} y2={yOf(t)} stroke="#e8e7df" strokeWidth="1" />
                <text x={PLOT_W + 10} y={yOf(t) + 4} fontSize="12" fontFamily="ui-monospace, monospace" fill="#8b8e86">{t.toLocaleString("en-US")}</text>
              </g>
            ))}
            <line x1={PLOT_W} x2={PLOT_W} y1="0" y2={VOL_BOTTOM} stroke="#d9dad2" strokeWidth="1" />
            <line x1="0" x2={PLOT_W} y1={PANE_BOTTOM + 8} y2={PANE_BOTTOM + 8} stroke="#d9dad2" strokeWidth="1" />

            <motion.rect x="0" y={PANE_TOP} width={PLOT_W} height={STRIKE_Y - PANE_TOP} fill="url(#story-up)" style={{ opacity: aboveZone }} />

            {CANDLES.map((c, k) => (
              <CandleMark key={k} p={p} c={c} range={k < HISTORY_CANDLES ? [0.02 + k * 0.0125, 0.02 + (k + 1) * 0.0125] : slot(k - HISTORY_CANDLES)} />
            ))}

            {/* Strike: dashed line, a "Strike" tag and its value on the axis */}
            <motion.line x1="0" y1={STRIKE_Y} x2={PLOT_W} y2={STRIKE_Y} stroke="#10120f" strokeWidth="1.4" strokeDasharray="5 5" style={{ scaleX: strikeLen, originX: 0, transformBox: "fill-box" }} />
            <motion.g style={{ opacity: strikeTags }}>
              <rect x={PLOT_W - 62} y={STRIKE_Y + 4} width="56" height="20" rx="3" fill="#10120f" />
              <text x={PLOT_W - 34} y={STRIKE_Y + 18} textAnchor="middle" fontSize="11" fontWeight="600" letterSpacing="1" fontFamily="ui-monospace, monospace" fill="#f4f3ed">STRIKE</text>
              <rect x={PLOT_W + 2} y={STRIKE_Y - 10} width="76" height="20" rx="3" fill="#f4f3ed" stroke="#10120f" strokeWidth="1" />
              <text x={PLOT_W + 40} y={STRIKE_Y + 4} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, monospace" fill="#10120f">{plain(STRIKE)}</text>
            </motion.g>

            {/* Live price tag on the axis, following the last close */}
            <motion.g style={{ opacity: tagOpacity, y: tagY }}>
              <motion.rect x={PLOT_W + 2} y="0" width="76" height="22" rx="3" style={{ fill: tagFill }} />
              <motion.text x={PLOT_W + 40} y="15" textAnchor="middle" fontSize="11" fontWeight="600" fontFamily="ui-monospace, monospace" fill="#06120a">{tagText}</motion.text>
            </motion.g>
          </svg>

          <div className="story-sides">
            <motion.div className="story-side is-up" style={{ background: aboveFill, color: aboveText, scale: aboveScale, boxShadow: aboveGlow }}>
              <span>Above</span>
              <small>wins 1.96x</small>
              <motion.i className="story-ripple" style={{ scale: ripple, opacity: rippleOpacity }} />
              <motion.div className="story-cursor" style={{ x: cursorX, y: cursorY, opacity: cursorOpacity, scale: cursorPress }}>
                <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
                  <path d="M4 2 L4 19 L8.5 14.6 L11.6 21.4 L14.4 20.2 L11.3 13.5 L17.6 13.5 Z" fill="#10120f" stroke="#ffffff" strokeWidth="1.4" strokeLinejoin="round" />
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
          <motion.div className="story-toast" style={{ opacity: toastOpacity, y: toastY, x: "-50%" }} aria-hidden="true">
            <i>✓</i> $1 staked on Above
          </motion.div>

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
      </div>
    </section>
  );
}

/**
 * One candle and its volume bar. It prints across its own slot of the timeline: it fades
 * in, and the body grows out from the open toward the close, as a live candle does.
 */
function CandleMark({ p, c, range }: { p: MotionValue<number>; c: Candle; range: readonly [number, number] }) {
  const [a, b] = range;
  const opacity = useTransform(p, [a, a + (b - a) * 0.25], [0, 1]);
  const grow = useTransform(p, [a, b], [0.15, 1]);
  const up = c.close >= c.open;
  const color = up ? "#22c55e" : "#ef4444";
  const top = yOf(Math.max(c.open, c.close));
  const bodyH = Math.max(2, Math.abs(yOf(c.open) - yOf(c.close)));
  const volH = c.vol;
  return (
    <motion.g style={{ opacity }}>
      <line x1={c.x} x2={c.x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={color} strokeWidth="1.5" />
      <motion.rect
        x={c.x - BODY_W / 2}
        y={top}
        width={BODY_W}
        height={bodyH}
        fill={color}
        style={{ scaleY: grow, originY: up ? 1 : 0, transformBox: "fill-box" }}
      />
      <rect x={c.x - BODY_W / 2} y={VOL_BOTTOM - volH} width={BODY_W} height={volH} fill={color} fillOpacity="0.35" />
    </motion.g>
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
  const dist = useTransform(p, [0.64, 0.76], [0, 170]);
  const x = useTransform(dist, (d) => Math.cos(angle) * d);
  const y = useTransform(dist, (d) => Math.sin(angle) * d);
  const opacity = useTransform(p, [0.64, 0.67, 0.76, 0.82], [0, 1, 1, 0]);
  return <motion.i className="story-spark" style={{ x, y, opacity }} />;
}
