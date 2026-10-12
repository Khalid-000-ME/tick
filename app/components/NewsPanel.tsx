"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CaretDown, Newspaper } from "@phosphor-icons/react";
import { usePersisted } from "@/lib/usePersisted";

/**
 * Live headlines beside a market.
 *
 * Polls every 20 seconds against a 30-second server cache, so a story is on screen within
 * about half a minute of the publisher posting it. Headlines that arrive after the panel
 * first loaded are marked new, and the ages keep counting without a refetch. The most
 * relevant headlines (this market, these teams, this league) come first, then the rest, so
 * the panel is still useful when nobody has written about this market in the last hour.
 */
interface Item {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  tags: string[];
  rank: number;
}

const POLL_MS = 20_000;

function ago(ts: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ts) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function NewsPanel({
  topic = "markets",
  title,
  symbol,
  league,
  teams,
  limit = 12,
  variant = "rail",
  foldKey,
}: {
  topic?: "markets" | "sports";
  title: string;
  /** A market symbol (BTC/USD) to rank first. */
  symbol?: string;
  /** A league tag (NBA, Premier League) to rank first. */
  league?: string;
  /** Team names to rank above everything. */
  teams?: string[];
  limit?: number;
  /** "rail" sits in the terminal's side column; "panel" is a standalone card. */
  variant?: "rail" | "panel";
  /**
   * Makes the panel foldable and remembers the choice under this key. Unset, the panel is
   * always open. Folded, only the header shows. With no saved choice the panel is open on a
   * desktop and folded on a phone, so a small screen opens on the chart and the trade
   * buttons rather than on a list of headlines.
   */
  foldKey?: string;
}) {
  const [saved, setSaved] = usePersisted(foldKey ?? "tick.news.unused");
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  const teamKey = (teams ?? []).join(",");
  useEffect(() => {
    let off = false;
    seen.current = null;
    const qs = new URLSearchParams({ topic });
    if (symbol) qs.set("symbol", symbol);
    if (league) qs.set("league", league);
    if (teamKey) qs.set("teams", teamKey);

    async function load() {
      try {
        const res = await fetch(`/api/news?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error("unavailable");
        const body = (await res.json()) as { items?: Item[] };
        if (off) return;
        const next = body.items ?? [];
        // Anything not in the first load is news that broke while the page was open.
        if (seen.current) {
          const known = seen.current;
          const arrived = next.filter((i) => !known.has(i.url)).map((i) => i.url);
          if (arrived.length) setFresh((f) => new Set([...f, ...arrived]));
        }
        seen.current = new Set([...(seen.current ?? []), ...next.map((i) => i.url)]);
        setItems(next);
        setFailed(false);
        setNow(Date.now());
      } catch {
        if (!off) setFailed(true);
      }
    }
    void load();
    const poll = setInterval(load, POLL_MS);
    // Ages keep moving between polls.
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      off = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [topic, symbol, league, teamKey]);

  const focus = symbol ?? league;

  return (
    <section className={`news-panel is-${variant}`} aria-label={title} data-fold={foldKey ? (saved ?? "auto") : "open"}>
      <header className="news-head">
        <Newspaper weight="bold" />
        <strong>{title}</strong>
        {!failed && items && <span className="news-live" title="Refreshes every 20 seconds"><i />Live</span>}
        {foldKey && (
          <button
            type="button"
            className="news-fold"
            aria-label="Show or hide the news"
            aria-controls="news-body"
            // With no saved choice the panel's state depends on the screen, which is only known
            // in the browser, so aria-expanded is set once the person has chosen.
            aria-expanded={saved === null ? undefined : saved === "open"}
            onClick={() => {
              const showing = saved === "open" || (saved === null && !window.matchMedia("(max-width: 980px)").matches);
              setSaved(showing ? "closed" : "open");
            }}
          >
            <CaretDown weight="bold" />
          </button>
        )}
      </header>
      <div className="news-body" id="news-body">
      {failed && !items ? (
        <p className="news-empty">News feeds are unreachable right now.</p>
      ) : items === null ? (
        <p className="news-empty">Loading headlines…</p>
      ) : items.length === 0 ? (
        <p className="news-empty">No headlines right now.</p>
      ) : (
        <ul className="news-list">
          {items.slice(0, limit).map((item) => {
            const tag = item.rank > 0 ? (item.rank === 3 ? "Match" : focus) : null;
            return (
              <li key={item.url} className={`${item.rank > 0 ? "is-relevant" : ""} ${fresh.has(item.url) ? "is-new" : ""}`}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  <span className="news-title">{item.title}</span>
                  <span className="news-meta">
                    {fresh.has(item.url) && <em>New</em>}
                    {tag && <b>{tag}</b>}
                    {item.source} · {ago(item.publishedAt, now)}
                    <ArrowSquareOut />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </section>
  );
}
