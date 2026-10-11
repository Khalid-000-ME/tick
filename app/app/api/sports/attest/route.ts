import { NextResponse } from "next/server";
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { findFixture, microDescriptor, microEventId, microOutcome, sportsMarketId, type MicroKey } from "@/lib/sports";

/**
 * Signs the result of a finished fixture so anyone can settle its market.
 *
 * This is the referee, and it is deliberately the narrowest one that works. It will only
 * sign a fixture the public scoreboard reports as COMPLETED, and it signs only the
 * outcome that scoreboard gives — it never takes an outcome from the caller. Anyone can
 * ask for the signature and anyone can submit it, so the attestor chooses the result but
 * not who profits from landing it.
 *
 * The signature is checkable forever: the contract emits it, and the fixture it refers to
 * is public. A wrong attestation is permanent, attributable evidence.
 *
 * ATTESTOR_PK is server-only and testnet-only, and never leaves this process.
 */
export const dynamic = "force-dynamic";

function attestor() {
  const key = process.env.ATTESTOR_PK;
  if (!key) throw new Error("ATTESTOR_PK is not set on the server");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

export async function POST(request: Request) {
  let espnId: string | undefined;
  let micro: Partial<MicroKey> | undefined;
  try {
    const body = (await request.json()) as { espnId?: string; micro?: Partial<MicroKey> };
    espnId = body.espnId;
    micro = body.micro;
  } catch {
    /* handled below */
  }
  if (!espnId || !/^\d{1,20}$/.test(espnId)) {
    return NextResponse.json({ error: "Expected an ESPN event id." }, { status: 400 });
  }

  try {
    const fixture = await findFixture(espnId);
    if (!fixture) return NextResponse.json({ error: "Unknown fixture." }, { status: 404 });

    // An in-play micro market: the window's opening scoreline is committed to by the
    // market id, so settling is a comparison anyone can redo against the scoreboard.
    if (micro && typeof micro.closesAt === "number") {
      const key: MicroKey = {
        espnId,
        closesAt: micro.closesAt,
        openHome: Number(micro.openHome ?? 0),
        openAway: Number(micro.openAway ?? 0),
      };
      if (!Number.isInteger(key.openHome) || !Number.isInteger(key.openAway) || key.openHome < 0 || key.openAway < 0) {
        return NextResponse.json({ error: "Bad opening scoreline." }, { status: 400 });
      }
      if (Math.floor(Date.now() / 1000) < key.closesAt) {
        return NextResponse.json({ error: "That window has not closed yet." }, { status: 409 });
      }
      const outcome = microOutcome(key, fixture.home.score ?? 0, fixture.away.score ?? 0);
      const eventId = microEventId(key);
      const id = sportsMarketId(eventId, key.closesAt);
      const digest = keccak256(
        encodeAbiParameters(parseAbiParameters("uint256, address, bytes32, uint8"), [
          BigInt(monadTestnet.id), CONTRACTS.tickSports, id, outcome,
        ])
      );
      const signature = await attestor().signMessage({ message: { raw: digest } });
      return NextResponse.json({
        marketId: id, eventId, closesAt: key.closesAt, outcome, signature, attestor: attestor().address,
        evidence: {
          descriptor: microDescriptor(key),
          fixture: fixture.name,
          openedAt: `${key.openHome}-${key.openAway}`,
          closedAt: `${fixture.home.score}-${fixture.away.score}`,
        },
      });
    }

    if (!fixture.completed || fixture.outcome === null) {
      return NextResponse.json({ error: "That fixture has not finished yet.", state: fixture.state }, { status: 409 });
    }

    const id = sportsMarketId(fixture.eventId, fixture.kickoff);
    // Exactly TickSports.attestationDigest: chain and contract are inside it, so a
    // signature cannot be replayed onto another deployment of the same code.
    const digest = keccak256(
      encodeAbiParameters(parseAbiParameters("uint256, address, bytes32, uint8"), [
        BigInt(monadTestnet.id),
        CONTRACTS.tickSports,
        id,
        fixture.outcome,
      ])
    );
    const signature = await attestor().signMessage({ message: { raw: digest } });

    return NextResponse.json({
      marketId: id,
      eventId: fixture.eventId,
      closesAt: fixture.kickoff,
      outcome: fixture.outcome,
      signature,
      attestor: attestor().address,
      // Everything a reader needs to check the attestation against the scoreboard.
      evidence: {
        source: `https://site.api.espn.com/apis/site/v2/sports/${fixture.leagueKey === "nba" ? "basketball" : fixture.leagueKey === "nfl" ? "football" : "soccer"}/${fixture.leagueKey}/scoreboard`,
        fixture: fixture.name,
        score: `${fixture.home.abbr} ${fixture.home.score} - ${fixture.away.score} ${fixture.away.abbr}`,
      },
    });
  } catch (e) {
    console.error(`[sports/attest] ${(e as Error).message.split("\n")[0]}`);
    return NextResponse.json({ error: "Could not attest that fixture." }, { status: 500 });
  }
}
