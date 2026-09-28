import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { TickAbi } from "@/lib/chain/abi";
import {
  CONTRACTS,
  SETTLE_WINDOW_S,
  WINDOW_S,
  monadTestnet,
} from "@/lib/chain/config";
import { marketId } from "@/lib/chain/market";
import { feedById } from "@/lib/pyth";
import { OperatorUnfundedError } from "@/lib/server/oracle";
import { NothingToSettle, settleMarket } from "@/lib/server/settlement";

/**
 * Settles a closed market, paid for by the operator key.
 *
 * WHY THE SERVER DOES THIS. settle() is permissionless and trustless — the outcome is a
 * comparison of Pyth's published price against the strike, which anyone can recompute —
 * but it costs ~1.2M gas and pays the caller nothing. Nobody has a reason to call it, and
 * Monad charges the gas LIMIT rather than gas used, so a user with a thin MON balance has
 * the transaction rejected outright. Leaving it to the user means a market closes, the
 * stake is locked, and the product looks like it stole the money.
 *
 * The server paying for it changes nothing about who decides the outcome: this route can
 * only submit the same comparison any observer would, and the contract recomputes it from
 * the oracle regardless of who sends the transaction.
 *
 * TIMING IS TIGHT AND DELIBERATE. The contract requires the settlement price to have been
 * published inside [closesAt, closesAt + settleTolerance] — currently a 20-second window.
 * That pins the outcome to a price from just after the close rather than whenever someone
 * got round to calling it. Pyth stores only its latest price, so settling late means the
 * stored publishTime has moved past the tolerance and the market can only be voided.
 *
 * TERMS ARE VALIDATED, not trusted. This spends the operator's MON, so it will only settle
 * a market that is on the published grid, on a listed feed, and actually closed. Without
 * that, the route is a gas pump for arbitrary calldata.
 */
export const dynamic = "force-dynamic";

function operatorKey(): `0x${string}` {
  const key = process.env.OPERATOR_PK ?? process.env.DEPLOYER_PK;
  if (!key) throw new Error("OPERATOR_PK (or DEPLOYER_PK) is not set on the server");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

/** Markets already attempted this process, so a polling UI cannot spend gas on repeats. */
const attempted = new Map<string, number>();
const ATTEMPT_TTL_MS = 120_000;

export async function POST(request: Request) {
  let body: { feedId?: string; strike?: string; expo?: number; closesAt?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with the market terms." }, { status: 400 });
  }

  const feed = body.feedId ? feedById(body.feedId) : undefined;
  if (!feed) return NextResponse.json({ error: "Unknown feed." }, { status: 400 });
  if (body.expo !== feed.expo) {
    return NextResponse.json({ error: "Exponent does not match the listed feed." }, { status: 400 });
  }

  const closesAt = Number(body.closesAt);
  if (!Number.isInteger(closesAt) || closesAt <= 0 || closesAt % WINDOW_S !== 0) {
    return NextResponse.json({ error: "closesAt is off the window grid." }, { status: 400 });
  }

  let strike: bigint;
  try {
    strike = BigInt(body.strike ?? "");
  } catch {
    return NextResponse.json({ error: "strike is not an integer." }, { status: 400 });
  }
  if (strike % feed.strikeStep !== 0n) {
    return NextResponse.json({ error: "strike is off the grid." }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < closesAt) {
    return NextResponse.json({ error: "This window has not closed yet." }, { status: 409 });
  }
  // Past the settle window the price is long gone; voidStale is the right call, and it is
  // open to anyone forever, so there is no hurry and no reason to spend operator gas here.
  if (now > closesAt + SETTLE_WINDOW_S) {
    return NextResponse.json({ error: "Past the settle window. This market can only be voided." }, { status: 409 });
  }

  const terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) } as const;
  const id = marketId(terms);

  for (const [key, at] of attempted) if (Date.now() - at > ATTEMPT_TTL_MS) attempted.delete(key);
  if (attempted.has(id)) {
    return NextResponse.json({ error: "Already attempted. Read settlements() for the outcome." }, { status: 429 });
  }

  try {
    const pub = createPublicClient({ chain: monadTestnet, transport: http() });

    // Cheap pre-check: an already-settled market would revert with AlreadySettled, and
    // paying gas to discover that is pointless when a view call answers it for free.
    const existing = (await pub.readContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "settlements",
      args: [id],
    })) as readonly [number, bigint, bigint, number, bigint, bigint];
    if (existing[0] !== 0) {
      return NextResponse.json({ ok: true, id, outcome: existing[0], alreadySettled: true });
    }

    attempted.set(id, Date.now());

    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(operatorKey());
    const result = await settleMarket(account, terms, id);

    console.info(
      `[settle] ${feed.symbol}@${closesAt} outcome=${result.outcome} gas=${result.receipt.gasUsed} ${result.hash}`
    );

    return NextResponse.json({
      ok: result.receipt.status === "success",
      id,
      outcome: result.outcome,
      hash: result.hash,
      explorer: `${monadTestnet.blockExplorers.default.url}/tx/${result.hash}`,
    });
  } catch (e) {
    attempted.delete(id);
    if (e instanceof NothingToSettle) {
      attempted.set(id, Date.now());
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof OperatorUnfundedError) {
      console.error(`[settle] ${e.message}`);
      return NextResponse.json({ error: e.message, unfunded: true }, { status: 503 });
    }
    const message = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    const first = message.split("\n")[0];
    // NoSettlementPrice is expected whenever no price landed in the tolerance window yet:
    // it means try again shortly, not that anything is broken.
    const retriable = /NoSettlementPrice|PriceFeedNotFound|no Hermes update/.test(message);
    console.error(`[settle] failed: ${first}`);
    return NextResponse.json({ error: first, retriable }, { status: retriable ? 409 : 500 });
  }
}
