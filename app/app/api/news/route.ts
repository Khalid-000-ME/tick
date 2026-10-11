import { NextResponse } from "next/server";
import { FEEDS } from "@/lib/pyth";

/**
 * Headlines from public crypto news RSS, tagged with the Tick market each one is about.
 *
 * WHY IT IS HERE. A 30-second market is a bet on where a price goes next, and the thing
 * that moves a price next is usually news. Showing the headline next to the chart is the
 * difference between guessing and having a reason.
 *
 * Server-side so the browser never hits a cross-origin feed, and cached so a room full of
 * tabs costs the publishers one request every few minutes. No API key: these are the
 * publishers' own public feeds. Nothing here is generated — if the feeds are unreachable
 * the panel says so rather than inventing a headline.
 */
export const dynamic = "force-dynamic";

const SOURCES = [
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
] as const;

/** Which listed market a headline is about. Word-boundary matched, so "ETH" does not hit "whether". */
const TAGS: { symbol: string; re: RegExp }[] = [
  { symbol: "BTC/USD", re: /\b(bitcoin|btc)\b/i },
  { symbol: "ETH/USD", re: /\b(ethereum|ether|eth)\b/i },
  { symbol: "SOL/USD", re: /\b(solana|sol)\b/i },
  { symbol: "TSLA", re: /\b(tesla|tsla|musk)\b/i },
];

const TTL_MS = 180_000;
let cache: { at: number; items: NewsItem[] } | null = null;

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  /** Symbols of the listed markets this headline mentions, if any. */
  symbols: string[];
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    // House style is no em dashes anywhere on the site, including quoted headlines.
    .replace(/\s*[\u2014]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function parse(xml: string, source: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const block of xml.split(/<item[\s>]/).slice(1)) {
    const item = block.split("</item>")[0];
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(item);
    const link = /<link[^>]*>([\s\S]*?)<\/link>/.exec(item);
    const date = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/.exec(item);
    if (!title || !link) continue;
    const text = decode(title[1]);
    const url = decode(link[1]);
    if (!text || !/^https?:\/\//.test(url)) continue;
    const when = date ? Date.parse(decode(date[1])) : NaN;
    out.push({
      title: text,
      url,
      source,
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      symbols: TAGS.filter((t) => t.re.test(text)).map((t) => t.symbol),
    });
  }
  return out;
}

export async function GET(request: Request) {
  const want = new URL(request.url).searchParams.get("symbol");
  const now = Date.now();

  if (!cache || now - cache.at > TTL_MS) {
    const batches = await Promise.all(
      SOURCES.map(async (s) => {
        try {
          const res = await fetch(s.url, {
            headers: { "User-Agent": "Tick/0.1 (+https://github.com/Khalid-000-ME/tick)", Accept: "application/rss+xml, application/xml, text/xml" },
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return [];
          return parse(await res.text(), s.name);
        } catch {
          return [];
        }
      })
    );
    const items = batches.flat().sort((a, b) => b.publishedAt - a.publishedAt);
    // Keep the previous batch if every source failed, rather than blanking the panel.
    if (items.length === 0 && cache) {
      return NextResponse.json({ items: filter(cache.items, want), stale: true });
    }
    if (items.length === 0) {
      console.error("[news] every source failed or returned no items");
      return NextResponse.json({ error: "No news sources reachable right now." }, { status: 503 });
    }
    cache = { at: now, items: items.slice(0, 60) };
  }

  return NextResponse.json({ items: filter(cache.items, want) });
}

function filter(items: NewsItem[], symbol: string | null): NewsItem[] {
  if (!symbol) return items.slice(0, 24);
  const known = FEEDS.some((f) => f.symbol === symbol);
  if (!known) return items.slice(0, 24);
  // The market's own headlines first, then everything else, so the panel is never empty
  // just because nobody wrote about Solana in the last hour.
  const mine = items.filter((i) => i.symbols.includes(symbol));
  const rest = items.filter((i) => !i.symbols.includes(symbol));
  return [...mine, ...rest].slice(0, 24);
}
