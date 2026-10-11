"use client";

import Image from "next/image";

/**
 * The image strip across the top of a market card, and the only place the card says what
 * it is and how long it has left. Everything below it is the decision: the price to beat,
 * the two sides, the pool.
 *
 * We have no photo library and no licence to borrow one, so each asset gets a generated
 * banner: its brand colours, its mark, the ticker set large.
 */
/** Official marks, stored locally rather than hotlinked. Crypto from Trust Wallet's open
 *  asset repository (Hyperliquid from CoinGecko, which that repo lacks); equities from
 *  Financial Modeling Prep. QQQ is Invesco's fund, so its mark is Invesco's, set on a disc
 *  because the source is white on transparent and vanished on light backgrounds. */
export const ASSET_ICONS: Record<string, string> = {
  "BTC/USD": "/asset-icons/btc.png",
  "ETH/USD": "/asset-icons/eth.png",
  "SOL/USD": "/asset-icons/sol.png",
  "BNB/USD": "/asset-icons/bnb.png",
  "XRP/USD": "/asset-icons/xrp.png",
  "DOGE/USD": "/asset-icons/doge.png",
  "HYPE/USD": "/asset-icons/hype.jpg",
  "PYTH/USD": "/asset-icons/pyth.png",
  TSLA: "/asset-icons/tsla.png",
  QQQ: "/asset-icons/qqq.png",
};

/** Brand-ish pairs, dark enough that white type stays legible on them. */
const PALETTE: Record<string, [string, string]> = {
  "BTC/USD": ["#7a4a06", "#2a1a04"],
  "ETH/USD": ["#2f3a63", "#13172b"],
  "SOL/USD": ["#1d5e58", "#0c2320"],
  "BNB/USD": ["#7a6410", "#2a2206"],
  "XRP/USD": ["#2b3238", "#111517"],
  "DOGE/USD": ["#6d5c1c", "#241e09"],
  "HYPE/USD": ["#0d4a40", "#051d18"],
  "PYTH/USD": ["#3d2177", "#170d2c"],
  TSLA: ["#6b1a1a", "#250909"],
  QQQ: ["#123a63", "#061423"],
};
const FALLBACK: [string, string] = ["#2d3a33", "#121714"];

export const ticker = (symbol: string) => symbol.replace("/USD", "");

export function CardBanner({
  symbol,
  label,
  window: windowLabel,
  status,
  urgent = false,
  tall = false,
}: {
  symbol: string;
  label?: string;
  window: string;
  status: string;
  urgent?: boolean;
  tall?: boolean;
}) {
  const [from, to] = PALETTE[symbol] ?? FALLBACK;
  const icon = ASSET_ICONS[symbol];
  return (
    <div className={`card-banner ${tall ? "is-tall" : ""}`} style={{ backgroundImage: `linear-gradient(118deg, ${from}, ${to})` }}>
      {icon && (
        <span className="card-banner-ghost" aria-hidden="true">
          <Image src={icon} alt="" width={160} height={160} />
        </span>
      )}
      <span className="card-banner-top">
        <span className="card-chip">{windowLabel}</span>
        <span className={`card-chip ${urgent ? "is-urgent" : ""}`}>{status}</span>
      </span>
      <span className="card-banner-mark">
        {icon && <Image src={icon} alt="" width={tall ? 30 : 24} height={tall ? 30 : 24} />}
        <b>{ticker(symbol)}</b>
        {tall && label && <em>{label}</em>}
      </span>
    </div>
  );
}

/** A fixture banner: both crests on a neutral field, since neither club owns the card. */
export function FixtureBanner({
  league,
  status,
  live = false,
  home,
  away,
  showScore = false,
  tall = false,
}: {
  league: string;
  status: string;
  live?: boolean;
  /** ESPN reports 0-0 before kickoff, so the score is shown only once there is one. */
  showScore?: boolean;
  home: { abbr: string; logo: string | null; score: number | null };
  away: { abbr: string; logo: string | null; score: number | null };
  tall?: boolean;
}) {
  const scored = showScore && home.score !== null && away.score !== null;
  return (
    <div className={`card-banner is-fixture ${tall ? "is-tall" : ""}`} style={{ backgroundImage: "linear-gradient(118deg, #1b2b22, #0b1310)" }}>
      <span className="card-banner-top">
        <span className="card-chip">{league}</span>
        <span className={`card-chip ${live ? "is-live" : ""}`}>{status}</span>
      </span>
      <span className="card-banner-mark">
        {away.logo && <Image src={away.logo} alt="" width={tall ? 34 : 26} height={tall ? 34 : 26} />}
        <b>{away.abbr}</b>
        <em className="fixture-score">{scored ? `${away.score} : ${home.score}` : "@"}</em>
        <b>{home.abbr}</b>
        {home.logo && <Image src={home.logo} alt="" width={tall ? 34 : 26} height={tall ? 34 : 26} />}
      </span>
    </div>
  );
}
