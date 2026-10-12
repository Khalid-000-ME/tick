import type { Metadata } from "next";
import Link from "next/link";
import { isAddress } from "viem";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { ResultsCard } from "@/components/PostCard";
import { ShareActions } from "@/components/ShareActions";
import { TickProfilesAbi } from "@/lib/chain/abi";
import { CONTRACTS } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";
import { byNet, standingOf, standings } from "@/lib/server/standings";

/**
 * A trader's card: what they made, on a page made to be posted.
 *
 * It is the same card the feed shows, just larger, so the thing people post and the thing they
 * open from the post are one object. Everything is read from the chain at request time and the
 * address is in the URL, so anyone who follows the link sees the same numbers rather than a
 * screenshot that could say anything.
 */
export const dynamic = "force-dynamic";

async function load(address: string) {
  const [rows, profile] = await Promise.all([
    standings().catch(() => null),
    (pub.readContract({ address: CONTRACTS.tickProfiles, abi: TickProfilesAbi, functionName: "profileOf", args: [address as `0x${string}`] }) as Promise<readonly [string, string, string, bigint]>).catch(() => null),
  ]);
  const [username, displayName, avatar] = profile ?? ["", "", ""];
  if (!rows) return { standing: null, profile: { username, displayName, avatar } };
  const me = standingOf(rows, address);
  const ranked = [...rows.values()].filter((t) => t.bets > 0).sort(byNet);
  const place = ranked.findIndex((t) => t.address === address.toLowerCase());
  return { standing: { ...me, rank: place < 0 ? null : place + 1 }, profile: { username, displayName, avatar } };
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return { title: "Tick" };
  const { standing } = await load(address);
  const net = standing?.net ?? 0;
  const title = net >= 0 ? `+$${net.toFixed(2)} on Tick` : `−$${Math.abs(net).toFixed(2)} on Tick`;
  return {
    title,
    description: "Thirty-second markets. The world's first. Call it, and post what you made.",
    openGraph: { title, description: "Thirty-second markets on Tick." },
    twitter: { card: "summary_large_image", title },
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default async function TraderCard({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const { standing, profile } = await load(address);

  const name = profile.displayName || (profile.username ? `@${profile.username}` : `${address.slice(0, 6)}…${address.slice(-4)}`);

  return (
    <main className="card-page">
      <div className="trader-card">
        <header className="trader-head">
          <Avatar avatar={profile.avatar} seed={address.toLowerCase()} name={profile.displayName || profile.username} size={52} />
          <div>
            <strong>{name}</strong>
            <small>{profile.username && profile.displayName ? `@${profile.username} · ` : ""}{address.slice(0, 6)}…{address.slice(-4)}</small>
          </div>
          <Link href="/feed" className="trader-brand" aria-label="Tick feed">tick<span>.</span></Link>
        </header>

        <ResultsCard size="hero" standing={standing ?? undefined} />

        {standing && (
          <dl className="trader-stats">
            <div><dt>Calls</dt><dd>{standing.bets}</dd></div>
            <div><dt>Settled</dt><dd>{money(standing.staked - standing.open)}</dd></div>
            <div><dt>Returned</dt><dd>{money(standing.returned)}</dd></div>
            <div><dt>Open</dt><dd>{money(standing.open)}</dd></div>
          </dl>
        )}
        {!standing && <p className="trader-note">Results are unavailable right now.</p>}

        <ShareActions address={address} net={standing?.net ?? 0} />
        <Link href="/trade?feed=BTC%2FUSD&window=30" className="trader-cta">Call the next thirty seconds →</Link>
        <p className="trader-foot">Profit on markets that have settled, read from the chain when this page was opened. Winnings count whether or not they have been collected.</p>
      </div>
    </main>
  );
}
