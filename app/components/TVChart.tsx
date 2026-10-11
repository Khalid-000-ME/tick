"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { FeedSpec } from "@/lib/pyth";

/**
 * The terminal chart, drawn with TradingView's Lightweight Charts.
 *
 * Price candles are Pyth's own prices, the numbers these markets settle against: seeded
 * with the last couple of minutes from Hermes' history, then built live from the ticks the
 * terminal already receives. Below them, in their own pane, is the volume staked on Tick
 * in each candle, read from the on-chain event index and coloured by the side that took
 * more of it. That is this product's volume, not an exchange's.
 */
const FRAMES = [
  { s: 5, label: "5s" },
  { s: 15, label: "15s" },
  { s: 60, label: "1m" },
] as const;

interface Candle { time: UTCTimestamp; open: number; high: number; low: number; close: number }
interface Stake { above: boolean; amount: string; stakedAt: number }

const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL;

function css(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const el = document.querySelector(".terminal-shell") ?? document.documentElement;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Fold raw price points into candles of `frame` seconds. */
function toCandles(points: { t: number; p: number }[], frame: number): Candle[] {
  const out: Candle[] = [];
  for (const { t, p } of points) {
    const bucket = (Math.floor(t / frame) * frame) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, p);
      last.low = Math.min(last.low, p);
      last.close = p;
    } else {
      out.push({ time: bucket, open: last ? last.close : p, high: p, low: p, close: p });
      const c = out[out.length - 1];
      c.high = Math.max(c.high, c.open);
      c.low = Math.min(c.low, c.open);
    }
  }
  return out;
}

export function TVChart({
  feed,
  livePrice,
  strike,
  theme,
}: {
  feed: FeedSpec;
  livePrice: number | null;
  strike: number | null;
  theme: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const strikeLine = useRef<IPriceLine | null>(null);
  const points = useRef<{ t: number; p: number }[]>([]);
  const [frame, setFrame] = useState<number>(5);
  const frameRef = useRef(frame);
  const [ready, setReady] = useState(false);

  // Build the chart once per theme; series survive asset and timeframe changes.
  useEffect(() => {
    if (!box.current) return;
    const ink = css("--t-ink", "#161a16");
    const dim = css("--t-dim", "#7d8877");
    const line = css("--t-line", "#dde2da");
    const up = css("--t-up", "#16a34a");
    const down = css("--t-down", "#dc2626");

    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: dim,
        fontSize: 11,
        attributionLogo: true,
        // The library's default divider is near-white, which glared in dark mode.
        panes: { separatorColor: line, separatorHoverColor: css("--t-stroke", "#153f31") + "40" },
      },
      grid: { vertLines: { color: line + "55" }, horzLines: { color: line + "55" } },
      rightPriceScale: { borderColor: line },
      // The default 6px bar spacing left two minutes of candles as a sliver of a wide chart.
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: true, rightOffset: 4, barSpacing: 18, minBarSpacing: 4 },
      crosshair: { vertLine: { color: dim, labelBackgroundColor: ink }, horzLine: { color: dim, labelBackgroundColor: ink } },
      localization: { priceFormatter: (v: number) => (v < 1 ? v.toFixed(5) : v.toLocaleString("en-US", { maximumFractionDigits: 2 })) },
    });
    const cs = c.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    });
    const vs = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    // Price gets most of the height; the volume pane sits underneath, as on TradingView.
    c.panes()[0]?.setStretchFactor(0.78);
    c.panes()[1]?.setStretchFactor(0.22);

    chart.current = c;
    candles.current = cs;
    volume.current = vs;
    strikeLine.current = null;
    setReady(true);
    return () => {
      c.remove();
      chart.current = null;
      candles.current = null;
      volume.current = null;
      setReady(false);
    };
  }, [theme]);

  // Seed history whenever the asset changes.
  useEffect(() => {
    points.current = [];
    candles.current?.setData([]);
    volume.current?.setData([]);
    let off = false;
    void fetch(`/api/price/history?feedId=${feed.id}`)
      .then((r) => r.json())
      .then((b: { points?: { t: number; p: number }[] }) => {
        if (off || !b.points) return;
        // Keep any live ticks that arrived while history was loading.
        const live = points.current;
        points.current = [...b.points, ...live.filter((x) => x.t > (b.points!.at(-1)?.t ?? 0))];
        candles.current?.setData(toCandles(points.current, frameRef.current));
        // Fill the width with what there is; new candles then shift it along.
        chart.current?.timeScale().fitContent();
      })
      .catch(() => {});
    return () => { off = true; };
  }, [feed.id, ready]);

  // Live ticks extend the current candle.
  useEffect(() => {
    if (livePrice === null || !candles.current) return;
    const t = Math.floor(Date.now() / 1000);
    points.current.push({ t, p: livePrice });
    if (points.current.length > 4000) points.current.splice(0, points.current.length - 4000);
    const all = toCandles(points.current, frameRef.current);
    const last = all[all.length - 1];
    if (last) candles.current.update(last);
  }, [livePrice]);

  // Re-bucket everything on a timeframe change.
  useEffect(() => {
    frameRef.current = frame;
    candles.current?.setData(toCandles(points.current, frame));
    chart.current?.timeScale().fitContent();
  }, [frame, ready]);

  // The strike, as a dashed line the candles can be read against.
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    if (strikeLine.current) { s.removePriceLine(strikeLine.current); strikeLine.current = null; }
    if (strike !== null) {
      strikeLine.current = s.createPriceLine({
        price: strike, color: css("--t-ink", "#161a16"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Strike",
      });
    }
  }, [strike, ready]);

  // Volume staked on Tick per candle, from the event index.
  useEffect(() => {
    if (!INDEXER) return;
    let off = false;
    const from = Math.floor(Date.now() / 1000) - 1800;
    async function load() {
      try {
        const res = await fetch(INDEXER!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query($f:String!,$from:Int!){Stake(where:{market:{feedId:{_eq:$f}},stakedAt:{_gte:$from}},order_by:{stakedAt:asc},limit:1000){above amount stakedAt}}`,
            variables: { f: feed.id, from },
          }),
        });
        const json = (await res.json()) as { data?: { Stake: Stake[] } };
        if (off || !json.data || !volume.current) return;
        const up = css("--t-up", "#16a34a");
        const down = css("--t-down", "#dc2626");
        // Only stakes inside the span the price pane covers, so the two panes share one time
        // axis instead of the price candles being pushed into a corner by an old stake.
        const since = points.current[0]?.t ?? Math.floor(Date.now() / 1000) - 180;
        const buckets = new Map<number, { above: number; below: number }>();
        for (const s of json.data.Stake) {
          if (s.stakedAt < since) continue;
          const b = Math.floor(s.stakedAt / frameRef.current) * frameRef.current;
          const row = buckets.get(b) ?? { above: 0, below: 0 };
          if (s.above) row.above += Number(s.amount) / 1e6; else row.below += Number(s.amount) / 1e6;
          buckets.set(b, row);
        }
        volume.current.setData(
          [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({
            time: t as UTCTimestamp, value: v.above + v.below, color: (v.above >= v.below ? up : down) + "b3",
          }))
        );
      } catch {
        /* the price pane stands on its own if the index is unreachable */
      }
    }
    void load();
    const timer = setInterval(load, 10_000);
    return () => { off = true; clearInterval(timer); };
  }, [feed.id, frame, ready]);

  return (
    <div className="tv-chart">
      <div className="tv-frames" role="tablist" aria-label="Candle length">
        {FRAMES.map((f) => (
          <button key={f.s} type="button" role="tab" aria-selected={frame === f.s} className={frame === f.s ? "is-active" : ""} onClick={() => setFrame(f.s)}>
            {f.label}
          </button>
        ))}
        <span className="tv-legend">Volume staked on Tick, USDC</span>
      </div>
      <div ref={box} className="tv-canvas" />
    </div>
  );
}
