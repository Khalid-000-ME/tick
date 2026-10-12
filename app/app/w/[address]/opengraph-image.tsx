import { ImageResponse } from "next/og";
import { isAddress } from "viem";
import { byNet, standingOf, standings } from "@/lib/server/standings";

/** The image a post unfurls to: the number, big, and nothing it cannot prove. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

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
      line = me.bets === 0 ? "No calls yet" : `${me.bets} calls${rank >= 0 ? ` · #${rank + 1} of ${ranked.length}` : ""}`;
    } catch {
      line = "";
    }
  }
  const up = net >= 0;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0b0d08", color: "#eef1e6", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, color: "#d8f35f" }}>TICK · 30 SECOND MARKETS</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 180, fontWeight: 700, letterSpacing: -6, color: up ? "#d8f35f" : "#f87171" }}>
            {`${up ? "+" : "−"}$${Math.abs(net).toFixed(2)}`}
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#9aa18f", marginTop: 12 }}>{line}</div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#6f7768" }}>{`${address.slice(0, 10)}…${address.slice(-6)}`}</div>
      </div>
    ),
    size
  );
}
