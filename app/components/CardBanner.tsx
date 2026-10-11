"use client";

import Image from "next/image";

/**
 * The image strip across the top of a market card.
 *
 * Boards like Polymarket's and Kalshi's lead each card with a photograph, which is what
 * makes a wall of markets scannable rather than a spreadsheet. We have no photo library
 * and no licence to borrow one, so each asset gets its own generated banner instead: its
 * brand colours as a gradient, its mark, and the ticker set large. It reads as deliberate
 * rather than as a missing image, and it costs nothing to serve.
 */
export const ASSET_ICONS: Record<string, string> = {
  "BTC/USD": "/asset-icons/bitcoin.svg",
  "ETH/USD": "/asset-icons/ethereum.svg",
  "SOL/USD": "/asset-icons/solana.svg",
  "BNB/USD": "/asset-icons/bnb.svg",
  "XRP/USD": "/asset-icons/xrp.svg",
  "DOGE/USD": "/asset-icons/doge.svg",
  "HYPE/USD": "/asset-icons/hype.svg",
  "PYTH/USD": "/asset-icons/pyth.svg",
  TSLA: "/asset-icons/tesla.svg",
  QQQ: "/asset-icons/qqq.svg",
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

export function CardBanner({ symbol, label, tall = false }: { symbol: string; label?: string; tall?: boolean }) {
  const [from, to] = PALETTE[symbol] ?? FALLBACK;
  const icon = ASSET_ICONS[symbol];
  return (
    <div
      className={`card-banner ${tall ? "is-tall" : ""}`}
      style={{ backgroundImage: `linear-gradient(118deg, ${from}, ${to})` }}
      aria-hidden="true"
    >
      {icon && (
        <span className="card-banner-ghost">
          <Image src={icon} alt="" width={160} height={160} />
        </span>
      )}
      <span className="card-banner-mark">
        {icon && <Image src={icon} alt="" width={tall ? 30 : 24} height={tall ? 30 : 24} />}
        <b>{symbol}</b>
        {label && <em>{label}</em>}
      </span>
    </div>
  );
}

/** A fixture banner: both crests on a neutral field, since neither club owns the card. */
export function FixtureBanner({
  league,
  home,
  away,
}: {
  league: string;
  home: { abbr: string; logo: string | null };
  away: { abbr: string; logo: string | null };
}) {
  return (
    <div className="card-banner is-fixture" style={{ backgroundImage: "linear-gradient(118deg, #1b2b22, #0b1310)" }} aria-hidden="true">
      <span className="card-banner-mark">
        {away.logo && <Image src={away.logo} alt="" width={26} height={26} />}
        <b>{away.abbr} @ {home.abbr}</b>
        {home.logo && <Image src={home.logo} alt="" width={26} height={26} />}
      </span>
      <em className="card-banner-league">{league}</em>
    </div>
  );
}
