"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, UsersThree } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { ASSET_ICONS, ticker } from "@/components/CardBanner";
import { TeamCrest } from "@/components/TeamCrest";
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

interface Fixture {
  espnId: string;
  league: string;
  name: string;
  home: { name: string; abbr: string; score: number | null; logo: string | null };
  away: { name: string; abbr: string; score: number | null; logo: string | null };
  state: "pre" | "in" | "post";
  secondsToKickoff: number;
  open: boolean;
}

const kickoffIn = (s: number) => (s < 3600 ? `in ${Math.max(1, Math.round(s / 60))}m` : s < 86_400 ? `in ${Math.round(s / 3600)}h` : `in ${Math.round(s / 86_400)}d`);

/**
 * What can be traded right now, in two tabs: live prices (30 seconds, one tap to a trade) and
 * the games that are on or about to be (one tap to the match). Finished games are left out,
 * since there is nothing left to call on them.
 */
export function TopMarkets() {
  const [tab, setTab] = useState<"crypto" | "sports">("crypto");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  useEffect(() => {
    let off = false;
    const feeds = SHOWN.map((s) => FEEDS.find((f) => f.symbol === s)).filter((f): f is NonNullable<typeof f> => !!f);
    async function loadPrices() {
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
    async function loadSports() {
      try {
        const res = await fetch("/api/sports/events");
        const body = (await res.json()) as { events?: Fixture[] };
        if (!off && body.events) setFixtures(body.events);
      } catch {
        /* the rail keeps the last fixtures */
      }
    }
    void loadPrices();
    void loadSports();
    const a = setInterval(loadPrices, 4000);
    const b = setInterval(loadSports, 20_000);
    return () => {
      off = true;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  // Live first, then the soonest to start; anything finished is gone.
  const games = (fixtures ?? [])
    .filter((f) => f.state !== "post")
    .sort((x, y) => (x.state === "in" ? -1 : 0) - (y.state === "in" ? -1 : 0) || x.secondsToKickoff - y.secondsToKickoff)
    .slice(0, 5);

  return (
    <section className="rail-card is-markets" aria-label="Top markets">
      <header className="rail-head">
        <h2>Trade now</h2>
        <div className="rail-tabs" role="tablist" aria-label="Market type">
          {(["crypto", "sports"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>
              {t === "crypto" ? "Crypto" : "Sports"}
            </button>
          ))}
        </div>
      </header>

      {tab === "crypto" ? (
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
      ) : fixtures === null ? (
        <p className="rail-empty">Reading the scoreboard…</p>
      ) : games.length === 0 ? (
        <p className="rail-empty">No games on or coming up right now.</p>
      ) : (
        <ul className="rail-list market-rail">
          {games.map((g) => (
            <li key={g.espnId}>
              <Link href={`/sports/${g.espnId}`} aria-label={`Open ${g.name}`}>
                <span className="fixture-logos" aria-hidden="true">
                  <TeamCrest logo={g.away.logo} name={g.away.name} abbr={g.away.abbr} size={26} />
                  <TeamCrest logo={g.home.logo} name={g.home.name} abbr={g.home.abbr} size={26} />
                </span>
                <span className="rail-name"><strong>{g.away.abbr} at {g.home.abbr}</strong><small>{g.league}</small></span>
                <span className="market-quote">
                  {g.state === "in" ? (
                    <strong className="is-live">{g.away.score ?? 0} - {g.home.score ?? 0}</strong>
                  ) : (
                    <small>{kickoffIn(g.secondsToKickoff)}</small>
                  )}
                  {g.state === "in" && <small className="live-tag">Live</small>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/markets" className="rail-more">All markets <ArrowRight weight="bold" /></Link>
    </section>
  );
}
