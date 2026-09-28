import { NextResponse } from "next/server";
import { monadTestnet } from "@/lib/chain/config";
import { FEEDS, feedById } from "@/lib/pyth";
import { OperatorUnfundedError, postPrices } from "@/lib/server/oracle";

/**
 * Posts a fresh signed Pyth price on chain, which is what opens the acceptance cutoff.
 *
 * WHY THIS EXISTS. Pyth on Monad is a pull oracle: the stored price only moves when
 * someone pays to post a signed update. With nothing running it ages out and every stake
 * is correctly refused.
 *
 * ONE FEED BY DEFAULT WHEN ONE IS NAMED. The client names the feed being traded; posting
 * just that one costs ~176k gas against ~257k for the whole board, and this runs every few
 * seconds on a paid key. Omit the body to refresh every listed feed in one transaction.
 *
 * Every post is a real transaction, so it is throttled globally: concurrent tabs coalesce
 * onto one refresh instead of each paying for their own.
 */
export const dynamic = "force-dynamic";

const MIN_INTERVAL_MS = 2500;
let lastRefreshAt = 0;

export async function POST(request: Request) {
  let requested = FEEDS.map((f) => f.id as string);
  try {
    const body = (await request.json()) as { feedId?: string; feedIds?: string[] };
    if (body.feedIds?.length) requested = body.feedIds;
    else if (body.feedId) requested = [body.feedId];
  } catch {
    /* no body: refresh everything */
  }

  const feeds = requested.map(feedById).filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (feeds.length === 0) return NextResponse.json({ error: "No known feeds requested." }, { status: 400 });

  const since = Date.now() - lastRefreshAt;
  if (since < MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: `Just refreshed. Try again in ${Math.ceil((MIN_INTERVAL_MS - since) / 1000)}s.` },
      { status: 429 }
    );
  }
  lastRefreshAt = Date.now();

  try {
    const posted = await postPrices(feeds);
    if (!posted) {
      // Nothing newer exists to post, so nothing was spent. Not a failure.
      lastRefreshAt = 0;
      return NextResponse.json({ ok: true, skipped: true });
    }
    const { hash, receipt } = posted;
    console.info(`[price/refresh] ${feeds.map((f) => f.symbol).join(",")} ${receipt.status} gas=${receipt.gasUsed} ${hash}`);
    return NextResponse.json({
      ok: receipt.status === "success",
      hash,
      symbols: feeds.map((f) => f.symbol),
      explorer: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
    });
  } catch (e) {
    // Never echo the key or the Authorization header into a response.
    lastRefreshAt = 0;
    if (e instanceof OperatorUnfundedError) {
      console.error(`[price/refresh] ${e.message}`);
      return NextResponse.json({ error: e.message, unfunded: true }, { status: 503 });
    }
    const message = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    console.error(`[price/refresh] failed: ${message.split("\n")[0]}`);
    return NextResponse.json({ error: message.split("\n")[0] }, { status: 500 });
  }
}
