import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction, createMintToInstruction, getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { verifyAccessToken, ownsWallet, linkedAccountsOf } from "@/lib/server/privyAuth";

/**
 * The opening gift on Solana: devnet SOL for fees and the stake token to trade with.
 *
 * The same shape as the Monad welcome gift. The address in the body proves nothing on its own, so
 * it is checked against the wallets Privy says this user owns before anything is sent, which is
 * what stops one person draining the faucet with invented addresses.
 */
export const dynamic = "force-dynamic";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const MINT = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_MINT || "BwfDBd4SJyBsstSRNp2b9EZZ1gATb1qrywiDNKDNL7jA");
const GIFT_UNITS = BigInt(process.env.SOLANA_GIFT_UNITS ?? 5_000_000);   // 5.00
const LAMPORTS = Number(process.env.SOLANA_GIFT_LAMPORTS ?? 20_000_000); // 0.02 SOL, enough for rent and fees

/** Only ever used on devnet, and never returned to the browser. */
function treasury(): Keypair | null {
  const raw = process.env.SOLANA_TREASURY_SK?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : Uint8Array.from(Buffer.from(raw, "base64"));
  return Keypair.fromSecretKey(bytes);
}

export async function POST(req: Request) {
  const payer = treasury();
  if (!payer) return NextResponse.json({ error: "Solana funding is not configured." }, { status: 503 });

  let body: { address?: string; token?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const { address, token } = body;
  if (!address || !token) return NextResponse.json({ error: "Missing address or token." }, { status: 400 });

  // The browser's Privy token decides who this is; the address must be one they actually own.
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID, secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return NextResponse.json({ error: "Privy is not configured." }, { status: 503 });
  const did = await verifyAccessToken(token, appId);
  if (!did) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const accounts = await linkedAccountsOf(did, appId, secret);
  if (!accounts) return NextResponse.json({ error: "Could not check that wallet." }, { status: 502 });
  if (!ownsWallet(accounts, address, "solana")) {
    return NextResponse.json({ error: "That wallet is not on your account." }, { status: 403 });
  }

  let who: PublicKey;
  try { who = new PublicKey(address); } catch { return NextResponse.json({ error: "Not a Solana address." }, { status: 400 }); }

  const connection = new Connection(RPC, "confirmed");
  const ata = getAssociatedTokenAddressSync(MINT, who, true);

  // Already funded: say so rather than topping up on every page load.
  try {
    const existing = await getAccount(connection, ata);
    if (existing.amount >= GIFT_UNITS) {
      return NextResponse.json({ ok: true, already: true, balance: existing.amount.toString() });
    }
  } catch { /* no token account yet, which is the normal first-time path */ }

  const tx = new Transaction();
  const sol = await connection.getBalance(who);
  if (sol < LAMPORTS / 2) {
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: who, lamports: LAMPORTS }));
  }
  try { await getAccount(connection, ata); } catch {
    tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, ata, who, MINT));
  }
  tx.add(createMintToInstruction(MINT, ata, payer.publicKey, GIFT_UNITS));

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    return NextResponse.json({ ok: true, signature, units: GIFT_UNITS.toString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0].slice(0, 160) }, { status: 502 });
  }
}
