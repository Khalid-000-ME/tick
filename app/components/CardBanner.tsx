"use client";

import Image from "next/image";
import { TeamCrest } from "@/components/TeamCrest";

/**
 * Asset icons for the market cards, and the fixture banner for sports.
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

/**
 * The top of a market card: the asset's icon and ticker, then how long it runs and what is
 * left on it. No banner and no artwork behind it, because the icon already says what it is
 * and everything below is the decision: the price to beat, the two sides, the pool.
 */
export function CardHeader({
  symbol,
  label,
  window: windowLabel,
  status,
  urgent = false,
  big = false,
}: {
  symbol: string;
  label?: string;
  window: string;
  status: string;
  urgent?: boolean;
  big?: boolean;
}) {
  const icon = ASSET_ICONS[symbol];
  return (
    <div className={`card-head ${big ? "is-big" : ""}`}>
      <span className="card-head-mark">
        {icon && <Image src={icon} alt="" width={big ? 34 : 28} height={big ? 34 : 28} />}
        <b>{ticker(symbol)}</b>
        {big && label && <em>{label}</em>}
      </span>
      <span className="card-head-chips">
        <span className="card-chip-flat">{windowLabel}</span>
        <span className={`card-chip-flat ${urgent ? "is-urgent" : ""}`}>{status}</span>
      </span>
    </div>
  );
}

export const ticker = (symbol: string) => symbol.replace("/USD", "");

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
  home: { abbr: string; name?: string; logo: string | null; score: number | null };
  away: { abbr: string; name?: string; logo: string | null; score: number | null };
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
        <TeamCrest logo={away.logo} name={away.name} abbr={away.abbr} size={tall ? 34 : 26} />
        <b>{away.abbr}</b>
        <em className="fixture-score">{scored ? `${away.score} : ${home.score}` : "@"}</em>
        <b>{home.abbr}</b>
        <TeamCrest logo={home.logo} name={home.name} abbr={home.abbr} size={tall ? 34 : 26} />
      </span>
    </div>
  );
}
