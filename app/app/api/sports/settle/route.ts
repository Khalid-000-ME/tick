import { NextResponse } from "next/server";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";
import { findFixture, sportsMarketId } from "@/lib/sports";

/**
 * Settles a finished fixture, paid for by the operator.
 *
 * Nothing here decides anything: the outcome comes from the attestor's signature over the
 * public scoreboard, and the same call is open to anyone holding that signature — running
 * it is worth a bounty. The server does it so a demo never waits on a stranger, exactly as
 * it does for price markets.
 */
export const dynamic = "force-dynamic";

const attempted = new Map<string, number>();
const TTL_MS = 120_000;

function operator() {
  const key = process.env.OPERATOR_PK ?? process.env.DEPLOYER_PK;
  if (!key) throw new Error("OPERATOR_PK is not set on the server");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

export async function POST(request: Request) {
  let espnId: string | undefined;
  try {
    espnId = ((await request.json()) as { espnId?: string }).espnId;
  } catch {
    /* handled below */
  }
  if (!espnId || !/^\d{1,20}$/.test(espnId)) {
    return NextResponse.json({ error: "Expected an ESPN event id." }, { status: 400 });
  }

  const fixture = await findFixture(espnId);
  if (!fixture) return NextResponse.json({ error: "Unknown fixture." }, { status: 404 });
  if (!fixture.completed || fixture.outcome === null) {
    return NextResponse.json({ error: "That fixture has not finished yet." }, { status: 409 });
  }

  const id = sportsMarketId(fixture.eventId, fixture.kickoff);
  for (const [k, at] of attempted) if (Date.now() - at > TTL_MS) attempted.delete(k);
  if (attempted.has(id)) return NextResponse.json({ error: "Already attempted." }, { status: 429 });

  try {
    const settled = (await pub.readContract({
      address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "settlements", args: [id],
    })) as readonly [number, bigint, number, bigint, bigint];
    if (settled[0] !== 0) return NextResponse.json({ ok: true, id, outcome: settled[0], alreadySettled: true });

    const [home, away] = (await pub.readContract({
      address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "pools", args: [id],
    })) as readonly [bigint, bigint];
    if (home === 0n && away === 0n) {
      attempted.set(id, Date.now());
      return NextResponse.json({ error: "Nobody staked this fixture; settling it would only burn gas." }, { status: 409 });
    }

    const origin = new URL(request.url).origin;
    const att = await fetch(`${origin}/api/sports/attest`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ espnId }),
    });
    if (!att.ok) return NextResponse.json({ error: "Could not get an attestation." }, { status: 502 });
    const { signature, outcome } = (await att.json()) as { signature: `0x${string}`; outcome: number };

    attempted.set(id, Date.now());
    const account = operator();
    const terms = { eventId: fixture.eventId, closesAt: BigInt(fixture.kickoff) } as const;
    const { request: sim } = await pub.simulateContract({
      address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "settleAttested",
      args: [terms, outcome, signature], account,
    });
    const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
    const hash = await wallet.writeContract(sim);
    const receipt = await pub.waitForTransactionReceipt({ hash });

    console.info(`[sports/settle] ${fixture.name} outcome=${outcome} ${receipt.status} ${hash}`);
    return NextResponse.json({
      ok: receipt.status === "success",
      id, outcome, hash,
      explorer: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
    });
  } catch (e) {
    attempted.delete(id);
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    console.error(`[sports/settle] ${msg.split("\n")[0]}`);
    return NextResponse.json({ error: msg.split("\n")[0] }, { status: 500 });
  }
}
