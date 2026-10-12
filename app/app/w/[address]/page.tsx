import type { Metadata } from "next";
import Link from "next/link";
import { isAddress } from "viem";
import { notFound } from "next/navigation";
import { byNet, standingOf, standings } from "@/lib/server/standings";
import { ShareActions } from "@/components/ShareActions";

/**
 * A trader's card: what they made, on a page made to be posted.
 *
 * The profit is the post. Everything here is read from the chain index at request time and
 * the address is in the URL, so anyone who follows the link sees the same numbers rather
 * than a screenshot that could say anything.
 */
export const dynamic = "force-dynamic";

async function card(address: string) {
  try {
    const rows = await standings();
    const me = standingOf(rows, address);
    const ranked = [...rows.values()].filter((t) => t.bets > 0).sort(byNet);
    const rank = ranked.findIndex((t) => t.address === address.toLowerCase());
    return { me, rank: rank < 0 ? null : rank + 1, of: ranked.length };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return { title: "Tick" };
  const data = await card(address);
  const net = data ? data.me.net : 0;
  const title = net >= 0 ? `+$${net.toFixed(2)} on Tick` : `${net.toFixed(2)} on Tick`;
  return {
    title,
    description: "Thirty-second markets. The world's first. Call it, and post what you made.",
    openGraph: { title, description: "Thirty-second markets on Tick." },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function TraderCard({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const data = await card(address);

  const net = data?.me.net ?? 0;
  const up = net >= 0;

  return (
    <main className="card-page">
      <section className={`card-hero ${up ? "is-up" : "is-down"}`}>
        <p className="card-eyebrow">Tick · 30 second markets</p>
        <strong className="card-net">{up ? "+" : "−"}${Math.abs(net).toFixed(2)}</strong>
        <p className="card-sub">
          {data === null
            ? "Results are unavailable right now."
            : data.me.bets === 0
              ? "No calls yet."
              : `${data.me.bets} calls, ${data.me.staked.toFixed(2)} USDC staked${data.rank ? `, ranked #${data.rank} of ${data.of}` : ""}.`}
        </p>
        <code className="card-address">{address}</code>
        <ShareActions address={address} net={net} />
        <Link href="/markets" className="card-cta">Call the next thirty seconds →</Link>
      </section>
    </main>
  );
}
