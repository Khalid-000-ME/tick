import { NextResponse } from "next/server";
import { FEEDS } from "@/lib/pyth";

/**
 * Headlines from publishers' public RSS feeds, tagged with what each one is about.
 *
 * Two desks: `markets` (crypto and equities, for the price terminal) and `sports` (for
 * fixtures and in-play markets). A short market is a bet on the next move, and the next
 * move usually has a cause; the headline belongs next to the stake.
 *
 * Server-side so the browser never hits a cross-origin feed. Cached for 30 seconds per
 * desk, which keeps it close to live while a room full of tabs still costs each publisher
 * about two requests a minute. No API key. Nothing here is generated: if every feed is
 * unreachable the panel says so rather than inventing a headline.
 */
export const dynamic = "force-dynamic";

type Topic = "markets" | "sports";

const SOURCES: Record<Topic, { name: string; url: string; tag?: string }[]> = {
  markets: [
    { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
    { name: "Decrypt", url: "https://decrypt.co/feed" },
    { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  ],
  sports: [
    { name: "ESPN", url: "https://www.espn.com/espn/rss/news" },
    { name: "ESPN", url: "https://www.espn.com/espn/rss/nba/news", tag: "NBA" },
    { name: "ESPN", url: "https://www.espn.com/espn/rss/nfl/news", tag: "NFL" },
    { name: "ESPN", url: "https://www.espn.com/espn/rss/soccer/news", tag: "Soccer" },
    { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml" },
  ],
};

/** Which listed market a headline is about. Word-boundary matched, so "ETH" does not hit "whether". */
const MARKET_TAGS: { tag: string; re: RegExp }[] = [
  { tag: "BTC/USD", re: /\b(bitcoin|btc)\b/i },
  { tag: "ETH/USD", re: /\b(ethereum|ether|eth)\b/i },
  { tag: "SOL/USD", re: /\b(solana|sol)\b/i },
  { tag: "BNB/USD", re: /\b(bnb|binance)\b/i },
  { tag: "XRP/USD", re: /\b(xrp|ripple)\b/i },
  { tag: "DOGE/USD", re: /\b(dogecoin|doge)\b/i },
  { tag: "HYPE/USD", re: /\b(hyperliquid|hype)\b/i },
  { tag: "PYTH/USD", re: /\bpyth\b/i },
  { tag: "TSLA", re: /\b(tesla|tsla|musk)\b/i },
  { tag: "QQQ", re: /\b(nasdaq|qqq|tech stocks|fed|fomc|cpi|inflation)\b/i },
];

const SPORTS_TAGS: { tag: string; re: RegExp }[] = [
  { tag: "NBA", re: /\b(nba|lakers|celtics|warriors|knicks|nuggets|bucks|76ers|heat|suns|mavericks|thunder|cavaliers)\b/i },
  { tag: "NFL", re: /\b(nfl|quarterback|touchdown|chiefs|eagles|cowboys|49ers|bills|ravens|packers|lions)\b/i },
  { tag: "Premier League", re: /\b(premier league|arsenal|chelsea|liverpool|man city|manchester|tottenham|newcastle|aston villa)\b/i },
  { tag: "La Liga", re: /\b(la liga|real madrid|barcelona|atletico|sevilla|villarreal)\b/i },
];

const TTL_MS = 30_000;
const cache = new Map<Topic, { at: number; items: NewsItem[] }>();
/**
 * Some feeds (ESPN's top news) carry no publish date. Those are dated by when this server
 * first saw them, which stays put across refreshes, instead of "now" on every poll.
 */
const firstSeen = new Map<string, number>();

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  /** Markets or leagues this headline mentions. */
  tags: string[];
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
    .replace(/\s*[—]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ESPN writes New York wall-clock time and labels it "EST" all year, so in daylight time a
 * plain parse is an hour off. For ESPN the stamp is read as New York local time, with the
 * offset that applied on that date.
 */
function parseDate(raw: string, source: string): number {
  if (source !== "ESPN" || !/\bEST$/.test(raw.trim())) return Date.parse(raw);
  const wall = Date.parse(raw.trim().replace(/EST$/, "UTC"));
  if (Number.isNaN(wall)) return NaN;
  return wall - nyOffsetMs(wall);
}

/** New York's offset from UTC (e.g. -4h in summer) at about the given instant. */
function nyOffsetMs(ms: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - ms;
}

function parse(xml: string, source: string, topic: Topic, sourceTag?: string): NewsItem[] {
  const tags = topic === "markets" ? MARKET_TAGS : SPORTS_TAGS;
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
    // Betting pages are US-only: ESPN sends readers elsewhere to its regional sites, where
    // they do not exist, and odds tips are not what a market's news panel is for.
    if (/\/betting\//.test(url)) continue;
    const when = date ? parseDate(decode(date[1]), source) : NaN;
    const found = tags.filter((t) => t.re.test(text)).map((t) => t.tag);
    if (sourceTag && !found.includes(sourceTag)) found.unshift(sourceTag);
    if (!firstSeen.has(url)) {
      if (firstSeen.size > 2000) firstSeen.clear();
      firstSeen.set(url, Date.now());
    }
    out.push({ title: text, url, source, publishedAt: Number.isNaN(when) ? firstSeen.get(url)! : when, tags: found });
  }
  return out;
}

async function load(topic: Topic): Promise<{ items: NewsItem[]; at: number; stale?: boolean } | null> {
  const now = Date.now();
  const hit = cache.get(topic);
  if (hit && now - hit.at < TTL_MS) return hit;

  const batches = await Promise.all(
    SOURCES[topic].map(async (s) => {
      try {
        const res = await fetch(s.url, {
          headers: { "User-Agent": "Tick/0.1 (+https://github.com/Khalid-000-ME/tick)", Accept: "application/rss+xml, application/xml, text/xml" },
          cache: "no-store",
          redirect: "follow",
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return [];
        return parse(await res.text(), s.name, topic, s.tag);
      } catch {
        return [];
      }
    })
  );
  // The same story often appears in two feeds (ESPN top news and its league feed).
  const seen = new Set<string>();
  const items = batches
    .flat()
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((i) => {
      const k = i.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    // A feed occasionally dates an item in the future; never show "in 3h".
    .map((i) => (i.publishedAt > now ? { ...i, publishedAt: now } : i));

  // Keep the previous batch if every source failed, rather than blanking the panel.
  if (items.length === 0) return hit ? { ...hit, stale: true } : null;
  const next = { at: now, items: items.slice(0, 80) };
  cache.set(topic, next);
  return next;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const topic: Topic = q.get("topic") === "sports" ? "sports" : "markets";
  const data = await load(topic);
  if (!data) {
    console.error(`[news] every ${topic} source failed or returned no items`);
    return NextResponse.json({ error: "No news sources reachable right now." }, { status: 503 });
  }

  // What to put first: a market symbol, a league, and/or team names (sports).
  const symbol = q.get("symbol");
  const league = q.get("league");
  const teams = (q.get("teams") ?? "").split(",").map((t) => t.trim()).filter((t) => t.length >= 3);
  const teamRes = teams.map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));

  const score = (i: NewsItem) => {
    if (teamRes.some((re) => re.test(i.title))) return 3;
    if (symbol && FEEDS.some((f) => f.symbol === symbol) && i.tags.includes(symbol)) return 2;
    if (league && i.tags.includes(league)) return 1;
    return 0;
  };
  // Relevant headlines first, newest first within each group, so the panel is never empty
  // just because nobody wrote about this team in the last hour.
  const ranked = data.items.map((i) => ({ ...i, rank: score(i) })).sort((a, b) => b.rank - a.rank || b.publishedAt - a.publishedAt);
  return NextResponse.json({ items: ranked.slice(0, 24), fetchedAt: data.at, stale: data.stale ?? false });
}
