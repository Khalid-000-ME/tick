/**
 * Pyth integration: the price feed Tick settles against.
 *
 * SERVER ONLY. PYTH_API_KEY has no NEXT_PUBLIC_ prefix, so Next never inlines it into
 * the browser bundle. Nothing here may be imported from a client component.
 *
 * Hermes has required a bearer token since 2026-08-26 and answers 401 without one.
 * Verified working against both hosts below.
 *
 * WHY A PULL ORACLE CHANGES THE ARCHITECTURE. Pyth stores a price on chain only when
 * someone submits a signed update. Nobody does that routinely on Monad testnet, so the
 * stored BTC price was ~7 hours old and AAPL ~137 days old when measured. A keeper
 * therefore refreshes the feed, and — critically — refreshes it in a DIFFERENT BLOCK
 * from the stakes that read it. Refreshing writes Pyth's price slot; a stake in the same
 * block reads what the refresh wrote, which is a read-after-write conflict and
 * re-executes. Measured at 5 conflicts in test/Concurrency.t.sol. That is the whole
 * reason Tick reads the price rather than updating it on the staking path.
 */

export const HERMES_HOSTS = [
  "https://hermes.pyth.network",
  "https://pyth.dourolabs.app/hermes",
] as const;

export interface FeedSpec {
  /** Pyth price feed id. Every one below was confirmed with priceFeedExists on Monad. */
  id: `0x${string}`;
  symbol: string;
  label: string;
  /** Feed exponent, confirmed on chain with getPriceUnsafe. Strikes are in these units. */
  expo: number;
  /**
   * Strike grid step, in feed units. 1 = no rounding: the strike is Pyth's exact price at
   * window open. The grid used to be $100 for BTC, which made the strike jump in big
   * steps; it is no longer needed for convergence because /api/strike supplies one
   * shared value. MUST match what listFeed set on chain.
   */
  strikeStep: bigint;
  kind: "crypto" | "equity";
}

/**
 * The listed feeds. Ids and exponents were each verified against the live Pyth contract
 * on Monad testnet before being written here.
 *
 * ONLY FEEDS THIS API KEY CAN ACTUALLY READ. Hermes enforces per-feed entitlements and
 * answers 403 "Not entitled: feed <id>" for anything outside the plan. AAPL and MSFT were
 * listed here and removed after testing: both their Equity.US and Equity.Index ids are
 * refused, as are NVDA, AMZN, GOOGL, META, SPY and COIN. TSLA is the one entitled equity,
 * so it stays. Listing a feed we cannot refresh is worse than not listing it — the price
 * would sit frozen and every stake would be refused with no way for a user to fix it.
 *
 * Crypto trades continuously, so a demo works at any hour. TSLA only moves while the US
 * market is open (14:30-21:00 UTC on weekdays); outside those hours its price goes stale
 * and the cutoff correctly refuses stakes, which is the mechanism working rather than a
 * fault.
 */
export const FEEDS: readonly FeedSpec[] = [
  {
    id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    symbol: "BTC/USD",
    label: "Bitcoin",
    expo: -8,
    strikeStep: 1n,
    kind: "crypto",
  },
  {
    id: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    symbol: "ETH/USD",
    label: "Ether",
    expo: -8,
    strikeStep: 1n,
    kind: "crypto",
  },
  {
    id: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    symbol: "SOL/USD",
    label: "Solana",
    expo: -8,
    strikeStep: 1n,
    kind: "crypto",
  },
  {
    id: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    symbol: "TSLA",
    label: "Tesla",
    expo: -5,
    strikeStep: 1n,
    kind: "equity",
  },
] as const;

export const feedBySymbol = (symbol: string): FeedSpec => {
  const f = FEEDS.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
  if (!f) throw new Error(`unknown feed "${symbol}" — known: ${FEEDS.map((x) => x.symbol).join(", ")}`);
  return f;
};

export const feedById = (id: string): FeedSpec | undefined =>
  FEEDS.find((x) => x.id.toLowerCase() === id.toLowerCase());

export interface ParsedPrice {
  id: string;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
}

export interface PriceUpdate {
  /** Signed payloads to hand to Pyth.updatePriceFeeds. */
  updateData: `0x${string}`[];
  parsed: ParsedPrice[];
  /** Which Hermes host answered, for the evidence page. */
  host: string;
}

function apiKey(): string {
  const key = process.env.PYTH_API_KEY;
  if (!key) {
    throw new Error(
      "PYTH_API_KEY is not set. Hermes has required a bearer token since 2026-08-26 " +
        "and returns 401 without one. Put it in contracts/.env or app/.env.local — " +
        "never with a NEXT_PUBLIC_ prefix, which would ship it to the browser."
    );
  }
  return key;
}

/**
 * Fetches the latest signed price updates. Tries each host in turn so one being down
 * does not end a live session.
 *
 * Errors here deliberately never include the key or the Authorization header.
 */
export async function fetchPriceUpdate(feedIds: readonly string[]): Promise<PriceUpdate> {
  const key = apiKey();
  const params = new URLSearchParams();
  for (const id of feedIds) params.append("ids[]", id);

  const failures: string[] = [];
  for (const host of HERMES_HOSTS) {
    const url = `${host}/v2/updates/price/latest?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      if (!res.ok) {
        failures.push(`${host} -> HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {
        binary: { data: string[] };
        parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[];
      };
      return {
        updateData: body.binary.data.map((hex) => (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`),
        parsed: body.parsed.map((p) => ({
          id: p.id.startsWith("0x") ? p.id : `0x${p.id}`,
          price: BigInt(p.price.price),
          conf: BigInt(p.price.conf),
          expo: p.price.expo,
          publishTime: p.price.publish_time,
        })),
        host,
      };
    } catch (e) {
      failures.push(`${host} -> ${(e as Error).message}`);
    }
  }
  throw new Error(`every Hermes host failed: ${failures.join("; ")}`);
}

/**
 * The signed update that settles a market: the FIRST price Pyth published at or after the
 * close. Tick.settleWithUpdate has Pyth verify prevPublishTime < closesAt <= publishTime
 * <= closesAt + tolerance, so there is exactly one acceptable price per close and a
 * settler cannot choose among the many ticks in the window.
 *
 * Tries successive seconds because a feed may have no update in exactly the close second.
 * Hermes answers with the latest update at or before the timestamp asked for, so the
 * update to take is the first one whose own predecessor is still before the close.
 */
export async function fetchUpdateForWindow(
  feedId: string,
  closesAt: number,
  toleranceSeconds: number
): Promise<{ updateData: `0x${string}`[]; publishTime: number }> {
  const key = apiKey();
  const failures: string[] = [];
  for (let offset = 0; offset <= Math.min(toleranceSeconds, 6); offset++) {
    const ts = closesAt + offset;
    for (const host of HERMES_HOSTS) {
      try {
        const res = await fetch(
          `${host}/v2/updates/price/${ts}?ids[]=${feedId}&encoding=hex&parsed=true`,
          { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" }
        );
        if (!res.ok) {
          failures.push(`${host}@${ts} -> HTTP ${res.status}`);
          continue;
        }
        const body = (await res.json()) as {
          binary: { data: string[] };
          parsed: { price: { publish_time: number }; metadata?: { prev_publish_time?: number } }[];
        };
        const publishTime = body.parsed?.[0]?.price.publish_time;
        const prev = body.parsed?.[0]?.metadata?.prev_publish_time;
        // Not yet at the close: try the next second.
        if (publishTime === undefined || publishTime < closesAt) break;
        // Past the first update: an earlier one at/after the close exists, which is the
        // only one the contract will take. Asking for a later second cannot fix that.
        if (prev === undefined || prev >= closesAt) {
          failures.push(`${host}@${ts} -> publish ${publishTime} is not the first update after the close`);
          break;
        }
        return {
          updateData: body.binary.data.map((h) => (h.startsWith("0x") ? h : `0x${h}`) as `0x${string}`),
          publishTime,
        };
      } catch (e) {
        failures.push(`${host}@${ts} -> ${(e as Error).message}`);
      }
    }
  }
  throw new Error(`no Hermes update inside the settlement window: ${failures.slice(0, 3).join("; ")}`);
}

/** Human-readable price from feed units. */
export function toDecimal(price: bigint, expo: number): number {
  return Number(price) * 10 ** expo;
}

/** Feed units from a human price, rounded onto the strike grid. */
export function toFeedUnits(amount: number, expo: number): bigint {
  return BigInt(Math.round(amount / 10 ** expo));
}

/**
 * Rounds a price onto the feed's strike grid. Off-grid strikes are rejected on chain,
 * and the grid is what keeps a permissionless market space from fragmenting into
 * one-sided pools that all void.
 */
export function snapToGrid(priceInFeedUnits: bigint, step: bigint): bigint {
  const half = step / 2n;
  return ((priceInFeedUnits + half) / step) * step;
}

export function fmtPrice(price: bigint, expo: number): string {
  return toDecimal(price, expo).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * US equity feeds only publish while the market is open. This is advisory for the UI;
 * the contract does not care, because a stale price fails the cutoff regardless.
 */
export function equityMarketLikelyOpen(now = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 14 * 60 + 30 && minutes < 21 * 60;
}
