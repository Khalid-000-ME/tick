import { ImageResponse } from "next/og";
import { isAddress } from "viem";
import { byNet, standingOf, standings } from "@/lib/server/standings";

/**
 * The image a post unfurls to: the same card as on the page, in the same face. The pixel font is
 * fetched once from Google Fonts and kept; if it cannot be had the number falls back to bold
 * sans, which is worse looking but never a broken image.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

let pixel: Promise<ArrayBuffer | null> | null = null;
function pixelFont(): Promise<ArrayBuffer | null> {
  pixel ??= (async () => {
    try {
      const css = await (await fetch("https://fonts.googleapis.com/css2?family=Geist+Pixel", { signal: AbortSignal.timeout(4000) })).text();
      const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
      if (!url) return null;
      return await (await fetch(url, { signal: AbortSignal.timeout(6000) })).arrayBuffer();
    } catch {
      pixel = null; // try again next time
      return null;
    }
  })();
  return pixel;
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  let net = 0;
  let line = "";
  if (isAddress(address)) {
    try {
      const rows = await standings();
      const me = standingOf(rows, address);
      net = me.net;
      const ranked = [...rows.values()].filter((t) => t.bets > 0).sort(byNet);
      const rank = ranked.findIndex((t) => t.address === address.toLowerCase());
      line = me.bets === 0 ? "No calls yet" : `${me.bets} calls${rank >= 0 ? ` · #${rank + 1} overall` : ""}${me.open > 0 ? ` · $${me.open.toFixed(2)} open` : ""}`;
    } catch {
      line = "";
    }
  }
  const up = net >= 0;
  const glow = up ? "#d8f35f" : "#ff7a59";
  const font = await pixelFont();

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#07090a", fontFamily: "sans-serif" }}>
        <div
          style={{
            width: 1060, height: 470, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 64px", borderRadius: 40, color: "#eef1e6",
            border: `2px solid ${glow}55`,
            background: `radial-gradient(120% 140% at 0% 0%, ${glow}30 0%, #0b0d08 62%)`,
            boxShadow: `0 0 120px -20px ${glow}88`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: glow, fontSize: 26, letterSpacing: 7 }}>
            <div style={{ display: "flex" }}>VERIFIED ON CHAIN</div>
            <div style={{ display: "flex", color: "#eef1e6", fontSize: 34, letterSpacing: -1, fontWeight: 700 }}>tick.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 190, lineHeight: 1, color: glow, fontFamily: font ? "Geist Pixel" : "sans-serif", fontWeight: font ? 400 : 700, letterSpacing: font ? 2 : -6 }}>
              {`${up ? "+" : "−"}$${Math.abs(net).toFixed(2)}`}
            </div>
            <div style={{ display: "flex", fontSize: 30, color: "#aab1a0", letterSpacing: 2, marginTop: 18 }}>{line}</div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#6f7768", letterSpacing: 2 }}>{`${address.slice(0, 10)}…${address.slice(-6)}`}</div>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Geist Pixel", data: font, weight: 400, style: "normal" }] : [] }
  );
}
