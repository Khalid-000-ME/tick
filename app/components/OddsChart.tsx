"use client";

/**
 * Both sides of a market over its window, the way a prediction market reads: two lines on
 * a 0-100% axis that mirror each other, because one side's odds are the other's inverse.
 *
 * The series is observed, not generated — each point is an implied-odds reading taken
 * while the board was open. A market nobody has staked in has no crowd to plot, so it
 * draws the even split as a flat pair rather than inventing movement.
 */
export interface OddsPoint {
  t: number;
  above: number;
}

const W = 300;
const H = 110;
const PAD = 6;

function path(points: OddsPoint[], pick: (p: OddsPoint) => number): string {
  if (points.length === 0) return "";
  const span = Math.max(1, points.length - 1);
  return points
    .map((p, i) => {
      const x = (i / span) * W;
      const y = PAD + ((100 - pick(p)) / 100) * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function OddsChart({ series, above, tall = false }: { series: OddsPoint[]; above: number; tall?: boolean }) {
  // One reading cannot be a line, so a fresh market is drawn as a flat pair at its
  // current split until a second reading arrives.
  const points = series.length >= 2 ? series : [{ t: 0, above }, { t: 1, above }];
  const y = (v: number) => PAD + ((100 - v) / 100) * (H - PAD * 2);

  return (
    <svg
      className={`odds-chart ${tall ? "is-tall" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Above ${above.toFixed(0)} percent, Below ${(100 - above).toFixed(0)} percent`}
    >
      {[0, 25, 50, 75, 100].map((v) => (
        <line key={v} className="odds-grid" x1="0" x2={W} y1={y(v)} y2={y(v)} />
      ))}
      <path className="odds-line tone-down" d={path(points, (p) => 100 - p.above)} />
      <path className="odds-line tone-up" d={path(points, (p) => p.above)} />
      <circle className="odds-dot tone-down" cx={W} cy={y(100 - above)} r="3" />
      <circle className="odds-dot tone-up" cx={W} cy={y(above)} r="3" />
    </svg>
  );
}
