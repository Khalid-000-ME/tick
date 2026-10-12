"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, UsersThree } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { ASSET_ICONS, ticker } from "@/components/CardBanner";
import { openAuth } from "@/lib/authSession";
import { isFrozen } from "@/lib/marketHours";
import { FEEDS } from "@/lib/pyth";
import type { Group, Room } from "@/lib/useSocial";

/**
 * The two rails beside the feed.
 *
 * Left: the groups you are in, one tap from their chat. Right: a few live markets, one tap
 * from a trade. Both are shortcuts to places that already exist, so nothing here is a second
 * copy of a screen.
 */

export function MyGroups({
  signedIn,
  groups,
  mine,
  rooms,
  loading,
}: {
  signedIn: boolean;
  groups: Group[];
  /** Ids of the groups this wallet is in. */
  mine: number[];
  rooms: Room[];
  loading: boolean;
}) {
  const inGroups = groups.filter((g) => mine.includes(g.id));
  return (
    <section className="rail-card is-groups" aria-label="Your groups">
      <header className="rail-head"><UsersThree weight="bold" /><h2>Your groups</h2><Link href="/groups">All</Link></header>

      {!signedIn ? (
        <div className="rail-empty">
          <p>Log in to see your groups and chat with them.</p>
          <button type="button" className="btn-solid small" onClick={() => openAuth("login")}>Log in</button>
        </div>
      ) : loading ? (
        <p className="rail-empty">Reading your groups…</p>
      ) : inGroups.length === 0 ? (
        <div className="rail-empty">
          <p>You are not in a group yet.</p>
          <Link href="/groups" className="btn-ghost small">Find one</Link>
        </div>
      ) : (
        <ul className="rail-list">
          {inGroups.slice(0, 8).map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`}>
                <Avatar avatar={g.avatar} seed={`group-${g.id}`} name={g.name} size={34} />
                <span className="rail-name"><strong>{g.name}</strong><small>{g.members} in · {g.messages} messages</small></span>
                <ArrowRight weight="bold" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {signedIn && rooms.length > 0 && (
        <>
          <h3 className="rail-sub">Your rooms</h3>
          <ul className="rail-list is-compact">
            {rooms.slice(0, 4).map((r) => (
              <li key={r.id}>
                <Link href={`/rooms/${r.id}`}><span className="rail-name"><strong>{r.name}</strong><small>{r.members} playing</small></span><ArrowRight weight="bold" /></Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface Quote { symbol: string; price: number; closed: boolean }
const SHOWN = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "TSLA"];

const money = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: v < 1 ? 4 : 2 });

export function TopMarkets() {
  const [quotes, setQuotes] = useState<Quote[]>([]);

  useEffect(() => {
    let off = false;
    const feeds = SHOWN.map((s) => FEEDS.find((f) => f.symbol === s)).filter((f): f is NonNullable<typeof f> => !!f);
    async function load() {
      try {
        const res = await fetch(`/api/price/live?ids=${feeds.map((f) => f.id).join(",")}`);
        if (!res.ok) return;
        const body = (await res.json()) as { prices: { symbol: string; price: string; expo: number; publishTime: number }[] };
        if (off) return;
        setQuotes(
          body.prices.map((p) => ({
            symbol: p.symbol,
            price: Number(p.price) * 10 ** p.expo,
            // An equity outside exchange hours is marked closed rather than shown as moving.
            closed: FEEDS.find((f) => f.symbol === p.symbol)?.kind === "equity" && isFrozen(p.publishTime),
          }))
        );
      } catch {
        /* the rail keeps the last quotes */
      }
    }
    void load();
    const t = setInterval(load, 4000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="rail-card is-markets" aria-label="Top markets">
      <header className="rail-head"><h2>Trade now</h2><Link href="/markets">All markets</Link></header>
      <ul className="rail-list market-rail">
        {SHOWN.map((symbol) => {
          const feed = FEEDS.find((f) => f.symbol === symbol);
          const q = quotes.find((x) => x.symbol === symbol);
          if (!feed) return null;
          return (
            <li key={symbol}>
              <Link href={`/trade?feed=${encodeURIComponent(symbol)}&window=30`} aria-label={`Trade ${feed.label}, 30 seconds`}>
                {ASSET_ICONS[symbol] ? <Image src={ASSET_ICONS[symbol]} alt="" width={30} height={30} className="market-icon" /> : <span className="market-icon" />}
                <span className="rail-name"><strong>{ticker(symbol)}</strong><small>{feed.label} · 30s</small></span>
                <span className="market-quote">
                  {q ? (q.closed ? <small>Closed</small> : <strong>${money(q.price)}</strong>) : <small>…</small>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
