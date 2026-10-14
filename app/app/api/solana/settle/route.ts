import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { SOLANA, settleIx, readMarket, marketPda, type Terms } from "@/lib/solana/program";

/**
 * The fallback settler for Solana, mirroring /api/settle on the Monad side.
 *
 * Settlement is permissionless and paid, so the point is that anyone can do it. This route only
 * steps in after a grace period, leaving the bounty to whoever gets there first. It takes the terms
 * rather than a market address because the program stores a market under the hash of its terms, so
 * the terms are the only way to name one.
 */
export const dynamic = "force-dynamic";

const GRACE_SECONDS = Number(process.env.SOLANA_SETTLE_GRACE_S ?? 10);

function settler(): Keypair | null {
  const raw = process.env.SOLANA_TREASURY_SK?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : Uint8Array.from(Buffer.from(raw, "base64"));
  return Keypair.fromSecretKey(bytes);
}

export async function POST(req: Request) {
  const payer = settler();
  if (!payer) return NextResponse.json({ error: "Solana settling is not configured." }, { status: 503 });

  let body: { feedId?: string; strike?: string; expo?: number; closesAt?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const { feedId, strike, expo, closesAt } = body;
  if (!feedId || !strike || typeof expo !== "number" || typeof closesAt !== "number") {
    return NextResponse.json({ error: "Missing terms." }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < closesAt) return NextResponse.json({ error: "The window is still open." }, { status: 425 });
  // An outside bot gets first refusal on the bounty; this only covers the windows nobody took.
  if (now < closesAt + GRACE_SECONDS) {
    return NextResponse.json({ ok: false, waiting: true, message: "Leaving it to an outside settler for now." });
  }

  const terms: Terms = {
    feedId: Uint8Array.from(Buffer.from(feedId.replace(/^0x/, ""), "hex")),
    strike: BigInt(strike),
    expo,
    closesAt: BigInt(closesAt),
  };

  const connection = new Connection(SOLANA.rpc, "confirmed");
  const market = await readMarket(connection, terms).catch(() => null);
  if (!market) return NextResponse.json({ error: "No such market." }, { status: 404 });
  if (market.settled) return NextResponse.json({ ok: true, already: true });

  const tx = new Transaction();
  const ata = getAssociatedTokenAddressSync(SOLANA.mint, payer.publicKey, true);
  try { await getAccount(connection, ata); } catch {
    tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, ata, payer.publicKey, SOLANA.mint));
  }
  tx.add(settleIx(payer.publicKey, terms));

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    return NextResponse.json({ ok: true, signature, market: marketPda(terms).toBase58() });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // The usual reason: someone else settled it a moment ago, which is the system working.
    if (/AlreadySettled|already/i.test(msg)) return NextResponse.json({ ok: true, already: true });
    return NextResponse.json({ error: msg.split("\n")[0].slice(0, 160) }, { status: 502 });
  }
}
