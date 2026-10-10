"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut, Newspaper } from "@phosphor-icons/react";
import type { FeedSpec } from "@/lib/pyth";

/**
 * Headlines for the market being traded, beside the chart.
 *
 * A 30-second window is a bet on the next move, and the next move usually has a cause.
 * The market's own headlines come first, then the rest of the feed, so the panel is still
 * useful when nobody has written about Solana in the last hour. Everything is a real
 * published article from Cointelegraph or Decrypt; if the feeds are unreachable the panel
 * says that rather than showing nothing and looking broken.
 */
interface Item {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  symbols: string[];
}

function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function NewsPanel({ feed }: { feed: FeedSpec }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    async function load() {
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(feed.symbol)}`);
        if (!res.ok) throw new Error("unavailable");
        const body = (await res.json()) as { items?: Item[] };
        if (off) return;
        setItems(body.items ?? []);
        setFailed(false);
      } catch {
        if (!off) setFailed(true);
      }
    }
    void load();
    const t = setInterval(load, 120_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [feed.symbol]);

  return (
    <section className="news-panel" aria-label={`News for ${feed.symbol}`}>
      <header className="news-head">
        <Newspaper weight="bold" />
        <strong>What&apos;s moving {feed.symbol}</strong>
      </header>
      {failed ? (
        <p className="news-empty">News feeds are unreachable right now.</p>
      ) : items === null ? (
        <p className="news-empty">Loading headlines…</p>
      ) : items.length === 0 ? (
        <p className="news-empty">No headlines right now.</p>
      ) : (
        <ul className="news-list">
          {items.slice(0, 12).map((item) => (
            <li key={item.url} className={item.symbols.includes(feed.symbol) ? "is-relevant" : ""}>
              <a href={item.url} target="_blank" rel="noreferrer">
                <span className="news-title">{item.title}</span>
                <span className="news-meta">
                  {item.symbols.includes(feed.symbol) && <b>{feed.symbol}</b>}
                  {item.source} · {ago(item.publishedAt)}
                  <ArrowSquareOut />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
