"use client";

import { useRef, useSyncExternalStore } from "react";
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";

/**
 * The idea of the product, played by scrolling: compete in a group, then flex the profit.
 *
 * The panel pins while the section scrolls past and scroll position is the clock. A room fills with a
 * crew, the owner picks a market, everyone calls the same thirty seconds with their sides showing live,
 * the scoreboard races and re-sorts as the window settles, the winner's card is made, and the card lands
 * in the group chat. It is built from the same parts as the real room page (the clock ring, the chart
 * with its strike, Above and Below, the scoreboard with a ring round each face, the card), so what the
 * reader sees is what they will use. The numbers are illustrative, not live.
 *
 * Beats, as fractions of the scroll:
 *   0.00 to 0.14  a room is made and the crew joins
 *   0.14 to 0.28  the owner picks the market
 *   0.28 to 0.62  the window: everyone calls it, candles print, the clock runs down
 *   0.62 to 0.78  it settles and the scoreboard re-sorts
 *   0.78 to 0.90  the winner's card is generated
 *   0.90 to 1.00  the card is posted to the group chat
 */

// ---- the crew -------------------------------------------------------------------------------
interface Player {
  id: string;
  name: string;
  from: string;
  to: string;
  pick: "ABOVE" | "BELOW";
  stake: number;
  /** Net before this round and after it. */
  start: number;
  end: number;
  /** Where each stands in the table at each stop of RANK_STOPS (0 is first): the re-sort is three swaps. */
  ranks: number[];
  joinAt: number;
  pickAt: number;
}
/** You pass Maya, then Dev, then Maya passes Dev: one pair at a time, like a real table. */
const RANK_STOPS = [0.64, 0.675, 0.685, 0.715, 0.725, 0.755];
const PLAYERS: Player[] = [
  { id: "you", name: "You", from: "#d8f35f", to: "#173f31", pick: "ABOVE", stake: 2, start: 0.2, end: 1.18, ranks: [2, 1, 1, 0, 0, 0], joinAt: 0.02, pickAt: 0.31 },
  { id: "maya", name: "Maya", from: "#f0b64a", to: "#b4410a", pick: "ABOVE", stake: 1, start: 0.55, end: 1.04, ranks: [1, 2, 2, 2, 2, 1], joinAt: 0.05, pickAt: 0.36 },
  { id: "dev", name: "Dev", from: "#58c7dc", to: "#0b7285", pick: "BELOW", stake: 1, start: 0.8, end: -0.2, ranks: [0, 0, 0, 1, 1, 2], joinAt: 0.08, pickAt: 0.42 },
  { id: "sam", name: "Sam", from: "#b497ff", to: "#6d3fd0", pick: "BELOW", stake: 0.5, start: -0.1, end: -0.6, ranks: [3, 3, 3, 3, 3, 3], joinAt: 0.11, pickAt: 0.48 },
];

// ---- the price series -----------------------------------------------------------------------
const TICKS_PER = 4;
const HISTORY = 8;
const WINDOW_N = 12;
const SERIES = (() => {
  const s: number[] = [];
  const total = (HISTORY + WINDOW_N) * TICKS_PER;
  for (let i = 0; i <= total; i++) {
    if (i <= HISTORY * TICKS_PER) s.push(2490 + Math.sin(i * 0.9) * 0.9 + Math.sin(i * 0.37) * 0.6);
    else {
      const open = s[HISTORY * TICKS_PER];
      const u = (i - HISTORY * TICKS_PER) / (total - HISTORY * TICKS_PER);
      s.push(open + Math.pow(u, 1.5) * 6.2 + Math.sin(i * 1.1) * 0.8 * (1 - u * 0.6) + Math.sin(i * 2.3) * 0.35);
    }
  }
  return s;
})();
const STRIKE = SERIES[HISTORY * TICKS_PER];
const LO = Math.min(...SERIES) - 0.8;
const HI = Math.max(...SERIES) + 0.8;
const W = 440;
const H = 190;
const STEP = (W - 28) / (HISTORY + WINDOW_N + 1);
const yOf = (v: number) => H - 10 - ((v - LO) / (HI - LO)) * (H - 20);
const STRIKE_Y = yOf(STRIKE);
interface Candle { x: number; open: number; close: number; high: number; low: number }
const CANDLES: Candle[] = Array.from({ length: HISTORY + WINDOW_N }, (_, k) => {
  const slice = SERIES.slice(k * TICKS_PER, k * TICKS_PER + TICKS_PER + 1);
  return { x: 16 + k * STEP, open: slice[0], close: slice[slice.length - 1], high: Math.max(...slice) + 0.15, low: Math.min(...slice) - 0.15 };
});

const WINDOW: [number, number] = [0.3, 0.6];
const slot = (j: number) => {
  const len = (WINDOW[1] - WINDOW[0]) / WINDOW_N;
  return [WINDOW[0] + j * len, WINDOW[0] + (j + 1) * len] as const;
};
const PRICE_STOPS = [WINDOW[0], ...Array.from({ length: WINDOW_N }, (_, j) => slot(j)[1])];
const PRICE_VALUES = [STRIKE, ...CANDLES.slice(HISTORY).map((c) => c.close)];

const CAPTIONS = [
  { range: [0, 0.14], title: "Start a room. Bring the crew.", body: "Name it, send the link, and everyone you invite is in." },
  { range: [0.14, 0.28], title: "Pick the market.", body: "Any asset, any window from 30 seconds. The whole room is on it." },
  { range: [0.28, 0.62], title: "Everyone calls the same 30 seconds.", body: "Above or below, from ten cents. You see who is on which side as it happens." },
  { range: [0.62, 0.78], title: "The scoreboard races.", body: "Every window settles on Pyth and the table re-sorts. Nobody referees it." },
  { range: [0.78, 0.9], title: "Win it, and Tick makes your card.", body: "Your profit, drawn from your real record and verified on chain." },
  { range: [0.9, 1], title: "Flex it in the group.", body: "Post it to the chat or the feed. The profit is the post." },
] as const;

const money = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;

function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(max-width: 900px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 900px)").matches,
    () => false
  );
}

export function RoomStory() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const narrow = useNarrow();
  const ROW = narrow ? 40 : 56;
  const bouncy = { stiffness: 300, damping: 14, mass: 0.6 };

  // the window and the arena as a whole
  const arenaIn = useTransform(p, [0, 0.05], [0.94, 1]);
  const arenaOut = useTransform(p, [0.76, 0.81], [1, 0]);
  const arenaScale = useTransform([arenaIn, useTransform(p, [0.76, 0.81], [1, 0.96])], ([a, b]: number[]) => a * b);
  const arenaOpacity = useTransform([useTransform(p, [0, 0.04], [0.3, 1]), arenaOut], ([a, b]: number[]) => a * b);

  // the market picker and the chart
  const picker = useTransform(p, [0.14, 0.17, 0.235, 0.265], [0, 1, 1, 0]);
  const pickerY = useSpring(useTransform(p, [0.14, 0.17], [14, 0]), bouncy);
  const ethOn = useTransform(p, [0.2, 0.215], [0, 1]);
  const pickCursorX = useTransform(p, [0.16, 0.2], [90, 0]);
  const pickCursorY = useTransform(p, [0.16, 0.2], [60, 0]);
  const pickCursorOp = useTransform(p, [0.16, 0.175, 0.23, 0.245], [0, 1, 1, 0]);
  const chartIn = useTransform(p, [0.225, 0.28], [0, 1]);
  const strikeX = useTransform(p, [0.24, 0.285], [16, W - 8]);
  const strikeTag = useTransform(p, [0.27, 0.29], [0, 1]);
  const price = useTransform(p, PRICE_STOPS, PRICE_VALUES);
  const tagY = useTransform(price, (v) => yOf(v) - 9);
  const tagText = useTransform(price, (v) => v.toFixed(2));
  const priceText = useTransform(price, (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const tagFill = useTransform(price, (v) => (v >= STRIKE ? "#22c55e" : "#ef4444"));
  const countdown = useTransform(p, WINDOW, [30, 0]);
  const secs = useTransform(countdown, (v) => String(Math.max(0, Math.ceil(v))).padStart(2, "0"));
  const dash = useTransform(p, WINDOW, [0, 289]);
  const settled = useTransform(p, [0.6, 0.625, 0.7, 0.74], [0, 1, 1, 0]);

  // the pool as the crew piles in
  const crowd = useTransform(p, [0.29, 0.315, 0.43, 0.49], [50, 100, 75, 67]);
  const crowdW = useTransform(crowd, (v) => `${v}%`);
  const aboveAmt = useTransform(p, [0.3, 0.315, 0.36, 0.37], [0, 2, 3, 3]);
  const belowAmt = useTransform(p, [0.41, 0.425, 0.475, 0.49], [0, 1, 1, 1.5]);
  const aboveText = useTransform(aboveAmt, (v) => `$${v.toFixed(2)} above`);
  const belowText = useTransform(belowAmt, (v) => `$${v.toFixed(2)} below`);

  // your tap
  const dock = useTransform(p, [0.26, 0.29], [0, 1]);
  const tapX = useTransform(p, [0.28, 0.305], [60, 0]);
  const tapY = useTransform(p, [0.28, 0.305], [40, 0]);
  const tapOp = useTransform(p, [0.28, 0.29, 0.32, 0.335], [0, 1, 1, 0]);
  const tapPress = useTransform(p, [0.3, 0.308, 0.316, 0.324], [1, 0.8, 0.8, 1]);
  const aboveSpring = useSpring(useTransform(p, [0.3, 0.308, 0.318, 0.33], [1, 0.94, 1.05, 1]), bouncy);
  const aboveFill = useTransform(p, [0.305, 0.315], ["rgba(34,197,94,0.14)", "rgba(34,197,94,1)"]);
  const aboveInk = useTransform(p, [0.305, 0.315], ["#22c55e", "#04130a"]);
  const dim = useTransform(p, [0.31, 0.33], [1, 0.4]);

  // the scoreboard
  const board = useTransform(p, [0.02, 0.1], [0, 1]);

  return (
    <section ref={ref} id="how" className="rs" aria-label="How a room plays out">
      {/* The profit's face. React hoists it into the head once; only the landing page pays for it. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Pixel&display=swap" precedence="default" />
      <div className="rs-sticky">
        <div className="rs-copy">
          <p className="rs-eyebrow">Compete in groups. Flex your profits.</p>
          <div className="rs-captions">
            {CAPTIONS.map((c, i) => (
              <Caption key={c.title} p={p} range={c.range} first={i === 0} last={i === CAPTIONS.length - 1} title={c.title} body={c.body} />
            ))}
          </div>
          <div className="rs-steps" aria-hidden="true">
            {CAPTIONS.map((c) => (
              <Step key={c.title} p={p} range={c.range} />
            ))}
          </div>
        </div>

        <div className="rs-stage">
          <motion.i className="rs-glow" style={{ opacity: useTransform(p, [0, 0.3, 0.62, 0.8, 1], [0.15, 0.3, 0.55, 0.9, 0.7]) }} aria-hidden="true" />

          <motion.div className="rs-arena" style={{ scale: arenaScale, opacity: arenaOpacity }}>
            <header className="rs-head">
              <div className="rs-title">
                <strong>Friday 30s showdown</strong>
                <small>Sigma Traders</small>
              </div>
              <div className="rs-crew" aria-hidden="true">
                {PLAYERS.map((pl) => <Joiner key={pl.id} p={p} pl={pl} bouncy={bouncy} />)}
              </div>
              <motion.span className="rs-invite" style={{ opacity: useTransform(p, [0.015, 0.03, 0.1, 0.13], [0, 1, 1, 0]) }}>Invite link copied</motion.span>
            </header>

            <div className="rs-body">
              <div className="rs-market">
                <div className="rs-market-top">
                  <div><strong>ETH/USD</strong><small>30s window</small></div>
                  <motion.span className="rs-price" style={{ opacity: chartIn }}>{priceText}</motion.span>
                  <div className="rs-clock" role="timer" aria-label="Seconds left in the window">
                    <svg viewBox="0 0 100 100" aria-hidden="true">
                      <circle cx="50" cy="50" r="46" fill="none" strokeWidth="6" className="rs-clock-track" />
                      <motion.circle cx="50" cy="50" r="46" fill="none" strokeWidth="6" strokeLinecap="round" className="rs-clock-run" strokeDasharray="289" style={{ strokeDashoffset: dash, rotate: -90, transformOrigin: "50% 50%" }} />
                    </svg>
                    <motion.b style={{ opacity: chartIn }}>{secs}</motion.b>
                  </div>
                </div>

                <div className="rs-chart">
                  <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
                    <motion.g style={{ opacity: chartIn }}>
                      {CANDLES.map((c, k) => (
                        <CandleMark key={k} p={p} c={c} range={k < HISTORY ? ([0.22 + k * 0.004, 0.25 + k * 0.004] as const) : slot(k - HISTORY)} />
                      ))}
                      <motion.line x1={16} y1={STRIKE_Y} y2={STRIKE_Y} stroke="#eef1e6" strokeOpacity="0.8" strokeWidth="1.2" strokeDasharray="4 4" x2={strikeX} />
                      <motion.text x={W - 60} y={STRIKE_Y - 5} fontSize="9" fill="#eef1e6" opacity="0.8" style={{ opacity: strikeTag }}>strike</motion.text>
                      <motion.g style={{ y: tagY, opacity: useTransform(p, [0.28, 0.3], [0, 1]) }}>
                        <motion.rect x={W - 56} width="52" height="18" rx="3" style={{ fill: tagFill }} />
                        <motion.text x={W - 30} y="12.500" textAnchor="middle" fontSize="10" fontWeight="700" fill="#06120a">{tagText}</motion.text>
                      </motion.g>
                    </motion.g>
                  </svg>

                  <motion.div className="rs-picker" style={{ opacity: picker, y: pickerY }}>
                    <small>Pick this room&apos;s market</small>
                    <div>
                      <span>BTC</span>
                      <motion.span className="is-on" style={{ opacity: 1 }}>
                        <motion.i style={{ opacity: ethOn }} />ETH
                      </motion.span>
                      <span>SOL</span>
                    </div>
                    <motion.svg className="rs-cursor" style={{ x: pickCursorX, y: pickCursorY, opacity: pickCursorOp }} viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 19 L8.5 14.6 L11.6 21.4 L14.4 20.2 L11.3 13.5 L17.6 13.5 Z" fill="#10120f" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></motion.svg>
                  </motion.div>

                  <motion.div className="rs-settled" style={{ opacity: settled }}>Settled · Above wins</motion.div>
                </div>

                <motion.div className="rs-dock" style={{ opacity: dock }}>
                  <div className="rs-pool"><motion.span style={{ width: crowdW }} /></div>
                  <div className="rs-pool-lbl"><motion.small>{aboveText}</motion.small><motion.small>{belowText}</motion.small></div>
                  <div className="rs-sides">
                    <motion.span className="is-up" style={{ scale: aboveSpring, background: aboveFill, color: aboveInk }}>Above</motion.span>
                    <motion.span className="is-down" style={{ opacity: dim }}>Below</motion.span>
                    <motion.svg className="rs-cursor is-tap" style={{ x: tapX, y: tapY, opacity: tapOp, scale: tapPress }} viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 19 L8.5 14.6 L11.6 21.4 L14.4 20.2 L11.3 13.5 L17.6 13.5 Z" fill="#10120f" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></motion.svg>
                  </div>
                </motion.div>
              </div>

              <motion.div className="rs-board" style={{ opacity: board }}>
                <header><strong>Scoreboard</strong><span><i /> Live</span></header>
                <ol style={{ height: ROW * PLAYERS.length }}>
                  {PLAYERS.map((pl) => <Row key={pl.id} p={p} pl={pl} row={ROW} />)}
                </ol>
              </motion.div>
            </div>
          </motion.div>

          <Finale p={p} bouncy={bouncy} narrow={narrow} />
        </div>
      </div>
    </section>
  );
}

/** A crew member joining the room: their face pops into the header. */
function Joiner({ p, pl, bouncy }: { p: MotionValue<number>; pl: Player; bouncy: { stiffness: number; damping: number; mass: number } }) {
  const o = useTransform(p, [pl.joinAt, pl.joinAt + 0.025], [0, 1]);
  const s = useSpring(useTransform(p, [pl.joinAt, pl.joinAt + 0.03], [0.3, 1]), bouncy);
  return <motion.span className="rs-face" style={{ opacity: o, scale: s, background: `linear-gradient(135deg, ${pl.from}, ${pl.to})` }}>{pl.name[0]}</motion.span>;
}

/** One row of the scoreboard: it holds its place, shows a live pick, then counts to its result and slides to its new rank. */
function Row({ p, pl, row }: { p: MotionValue<number>; pl: Player; row: number }) {
  const y = useTransform(p, RANK_STOPS, pl.ranks.map((r) => r * row));
  const net = useTransform(p, [0.63, 0.75], [pl.start, pl.end]);
  const netText = useTransform(net, money);
  const netColor = useTransform(net, (v) => (v > 0.005 ? "#22c55e" : v < -0.005 ? "#ef4444" : "#8d9784"));
  const pickOn = useTransform(p, [pl.pickAt, pl.pickAt + 0.02, 0.6, 0.63], [0, 1, 1, 0]);
  const ringOp = useTransform(p, [pl.pickAt, pl.pickAt + 0.02, 0.63, 0.66], [0, 1, 1, 0]);
  const rise = useTransform(p, [0.64, 0.75], [0, 1]);
  const won = pl.end - pl.start > 0.3;
  const lead = useTransform(p, [0.715, 0.74], [0, pl.ranks[pl.ranks.length - 1] === 0 ? 1 : 0]);
  const rankText = useTransform(y, (v) => String(Math.round(v / row) + 1));
  return (
    <motion.li className="rs-row" style={{ y, height: row - 6, zIndex: pl.id === "you" ? 2 : 1 }}>
      <motion.i className="rs-lead" style={{ opacity: lead }} aria-hidden="true" />
      <motion.b className="rs-rank">{rankText}</motion.b>
      <span className="rs-avatar" style={{ background: `linear-gradient(135deg, ${pl.from}, ${pl.to})` }}>
        {pl.name[0]}
        <motion.i className={`rs-ring ${pl.pick === "ABOVE" ? "is-up" : "is-down"}`} style={{ opacity: ringOp }} />
      </span>
      <span className="rs-who">
        <strong>{pl.name}</strong>
        <span className="rs-sub">
          <motion.small style={{ opacity: pickOn }}>{pl.pick === "ABOVE" ? "▲" : "▼"} ${pl.stake.toFixed(2)} live</motion.small>
          <motion.small style={{ opacity: rise }}>{won ? "called it" : "missed"}</motion.small>
        </span>
      </span>
      <motion.b className="rs-net" style={{ color: netColor }}>{netText}</motion.b>
    </motion.li>
  );
}

/** A candle printing across its own slot of the timeline: it fades in and the body grows from the open. */
function CandleMark({ p, c, range }: { p: MotionValue<number>; c: Candle; range: readonly [number, number] }) {
  const [a, b] = range;
  const opacity = useTransform(p, [a, a + (b - a) * 0.3], [0, 1]);
  const grow = useTransform(p, [a, b], [0.15, 1]);
  const up = c.close >= c.open;
  const color = up ? "#22c55e" : "#ef4444";
  const top = yOf(Math.max(c.open, c.close));
  const h = Math.max(1.5, Math.abs(yOf(c.open) - yOf(c.close)));
  return (
    <motion.g style={{ opacity }}>
      <line x1={c.x} x2={c.x} y1={yOf(c.high)} y2={yOf(c.low)} stroke={color} strokeWidth="1.3" />
      <motion.rect x={c.x - 5} y={top} width={10} height={h} fill={color} style={{ scaleY: grow, originY: up ? 1 : 0, transformBox: "fill-box" }} />
    </motion.g>
  );
}

/**
 * The end: the arena falls away, the winner's card is made, and it lands in the group chat.
 * One card element travels from the middle of the stage to a bubble in the chat, so it reads as the
 * same object being made and then shared.
 */
function Finale({ p, bouncy, narrow }: { p: MotionValue<number>; bouncy: { stiffness: number; damping: number; mass: number }; narrow: boolean }) {
  const cardOp = useTransform(p, [0.78, 0.8], [0, 1]);
  const rise = useSpring(useTransform(p, [0.78, 0.84], [24, 0]), bouncy);
  const scale = useTransform(p, [0.78, 0.84, 0.86, 0.915], [0.86, 1.05, 1.05, 0.62]);
  // The chat is taller on a phone, so the slot the card lands in is further above the stage's centre.
  const y = useTransform(p, [0.78, 0.84, 0.86, 0.915], [0, 0, 0, narrow ? -78 : -34]);
  const x = useTransform(p, [0.86, 0.915], ["0%", "26%"]);
  const scanY = useTransform(p, [0.79, 0.84], ["-12%", "112%"]);
  const scanOp = useTransform(p, [0.79, 0.8, 0.835, 0.845], [0, 1, 1, 0]);
  const net = useTransform(p, [0.8, 0.85], [0, 1.18]);
  const netText = useTransform(net, (v) => `+$${v.toFixed(2)}`);
  const badge = useTransform(p, [0.835, 0.855], [0, 1]);
  const line = useTransform(p, [0.845, 0.865], [0, 1]);
  const status = useTransform(p, [0.79, 0.8, 0.84, 0.855], [0, 1, 1, 0]);
  const ready = useTransform(p, [0.85, 0.865, 0.88, 0.9], [0, 1, 1, 0]);

  const chat = useTransform(p, [0.86, 0.9], [0, 1]);
  const chatY = useSpring(useTransform(p, [0.86, 0.9], [20, 0]), bouncy);
  const m1 = useTransform(p, [0.885, 0.905], [0, 1]);
  const m2 = useTransform(p, [0.895, 0.915], [0, 1]);
  const r1 = useTransform(p, [0.945, 0.965], [0, 1]);
  const r2 = useTransform(p, [0.96, 0.98], [0, 1]);
  const likes = useTransform(p, [0.95, 0.995], [0, 7]);
  const likesText = useTransform(likes, (v) => String(Math.round(v)));
  const heart = useSpring(useTransform(p, [0.945, 0.955, 0.97], [1, 1.35, 1]), bouncy);
  const toast = useTransform(p, [0.925, 0.945], [0, 1]);
  const toastY = useSpring(useTransform(p, [0.925, 0.945], [12, 0]), bouncy);

  return (
    <div className="rs-finale" aria-hidden="true">
      <motion.div className="rs-chat" style={{ opacity: chat, y: chatY }}>
        <header><span className="rs-chat-mark">ST</span><div><strong>Sigma Traders</strong><small>4 members · 1 room</small></div></header>
        <div className="rs-msgs">
          <motion.p className="rs-msg" style={{ opacity: m1 }}><b className="c0">Maya</b>that last window was close</motion.p>
          <motion.p className="rs-msg" style={{ opacity: m2 }}><b className="c1">Dev</b>rematch?</motion.p>
          <div className="rs-card-slot" />
          <motion.p className="rs-msg" style={{ opacity: r1 }}><b className="c0">Maya</b>gg. you got me</motion.p>
          <motion.p className="rs-msg" style={{ opacity: r2 }}><b className="c1">Dev</b>running it back</motion.p>
        </div>
        <motion.div className="rs-likes" style={{ opacity: r1 }}>
          <motion.span style={{ scale: heart }}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21s-7.500-4.600-9.600-9.200C.9 8.400 3 5 6.400 5c2 0 3.600 1.100 4.600 2.700C12 6.100 13.600 5 15.600 5 19 5 21.100 8.400 19.600 11.800 17.500 16.400 12 21 12 21z" fill="#e5484d" /></svg>
          </motion.span>
          <motion.b>{likesText}</motion.b>
        </motion.div>
        <div className="rs-compose"><span>Write a message</span><i>Card</i></div>
      </motion.div>

      <motion.div className="rs-card" style={{ opacity: cardOp, scale, x, y: useTransform([y, rise], ([a, b]: number[]) => a + b) }}>
        <div className="results-card is-up is-flex">
          <motion.i className="sf-scan" style={{ top: scanY, opacity: scanOp }} />
          <motion.span className="results-eyebrow" style={{ opacity: badge }}>Verified on chain</motion.span>
          <motion.strong className="results-net">{netText}</motion.strong>
          <motion.span className="results-line" style={{ opacity: line }}>5 calls · #1 in Friday 30s showdown</motion.span>
        </div>
        <div className="rs-status">
          <motion.span style={{ opacity: status }}>Reading your record from the chain…</motion.span>
          <motion.span style={{ opacity: ready }}>Your card is ready</motion.span>
        </div>
      </motion.div>

      <motion.div className="rs-toast" style={{ opacity: toast, y: toastY, x: "-50%" }}><i>✓</i> Posted to Sigma Traders</motion.div>
    </div>
  );
}

/** A caption fades up in its beat and out at the next; the first is visible on arrival, the last stays. */
function Caption({ p, range, first, last, title, body }: { p: MotionValue<number>; range: readonly [number, number]; first: boolean; last: boolean; title: string; body: string }) {
  const [a, b] = range;
  const opacity = useTransform(p, [a, a + 0.03, b - 0.03, b], [first ? 1 : 0, 1, 1, last ? 1 : 0]);
  const y = useTransform(p, [a, a + 0.03, b - 0.03, b], [first ? 0 : 24, 0, 0, last ? 0 : -24]);
  return (
    <motion.div className="rs-caption" style={{ opacity, y }}>
      <h2>{title}</h2>
      <p>{body}</p>
    </motion.div>
  );
}

function Step({ p, range }: { p: MotionValue<number>; range: readonly [number, number] }) {
  const fill = useTransform(p, [range[0], range[1]], ["0%", "100%"]);
  return <span><motion.i style={{ width: fill }} /></span>;
}
