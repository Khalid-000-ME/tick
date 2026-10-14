import { NextResponse } from "next/server";
import { Connection, Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";
import { SOLANA } from "@/lib/solana/program";
import { fetchPriceUpdate } from "@/lib/pyth";

/**
 * Posts a fresh Pyth price on Solana, for feeds nobody else is keeping alive.
 *
 * Devnet's sponsored feed accounts are maintained by whoever volunteers, and BTC/USD has stopped:
 * it has been frozen at one price for twenty minutes while ETH and SOL keep updating. The program
 * refuses anything older than ten seconds, correctly, so that market is simply unusable until
 * someone posts a price.
 *
 * So we post one. The receiver program verifies the Wormhole signatures itself, which is what makes
 * this safe to let a server do: we are paying for the post and choosing the moment, not vouching for
 * the number. The account it writes is an ordinary PriceUpdateV2 that the Tick program checks
 * exactly as it checks a sponsored one, including that it is `Full` verified.
 *
 * The posted account is ephemeral and closed by the receiver when the transaction ends, so the
 * caller gets back an address that is only good for the stake it is about to make.
 */
export const dynamic = "force-dynamic";

type Signable = { partialSign?: (k: Keypair) => void; sign?: (k: Keypair[]) => void };

/** Signs whichever transaction shape the SDK hands over, legacy or versioned. */
function signWith(payer: Keypair, tx: unknown) {
  const t = tx as Signable;
  if (typeof t.partialSign === "function") t.partialSign(payer);
  else if (typeof t.sign === "function") t.sign([payer]);
  else throw new Error("Unsignable transaction from the Pyth receiver.");
}

function treasury(): Keypair | null {
  const raw = process.env.SOLANA_TREASURY_SK?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : Uint8Array.from(Buffer.from(raw, "base64"));
  return Keypair.fromSecretKey(bytes);
}

export async function POST(req: Request) {
  const payer = treasury();
  if (!payer) return NextResponse.json({ error: "Solana posting is not configured." }, { status: 503 });

  let body: { feedId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const feedId = body.feedId?.replace(/^0x/, "");
  if (!feedId || !/^[0-9a-f]{64}$/i.test(feedId)) {
    return NextResponse.json({ error: "Not a feed id." }, { status: 400 });
  }

  try {
    // The app's own Hermes client, so this uses the same bearer token and the same host failover
    // as every other price read, and the key never leaves the server.
    const update = await fetchPriceUpdate([`0x${feedId}`]);
    if (!update.updateData.length) return NextResponse.json({ error: "Hermes returned no update." }, { status: 502 });
    // Hermes gives hex; the receiver wants base64.
    const data = update.updateData.map((hex) => Buffer.from(hex.replace(/^0x/, ""), "hex").toString("base64"));

    // Loaded through CommonJS on purpose. The receiver's ESM build reaches jito-ts, whose own
    // imports have no file extensions, which Node's ESM resolver refuses; the CJS resolver handles
    // them. Nothing here runs in the browser, so this costs nothing.
    const require = createRequire(import.meta.url);
    const { PythSolanaReceiver } = require("@pythnetwork/pyth-solana-receiver") as typeof import("@pythnetwork/pyth-solana-receiver");

    const connection = new Connection(SOLANA.rpc, "confirmed");
    // The receiver only needs something that can sign; Anchor's Wallet class is not exported
    // consistently across its ESM and CJS builds, and this is the whole of what it does.
    const signAny = (tx: unknown) => signWith(payer, tx);
    const wallet = {
      publicKey: payer.publicKey,
      payer,
      // The SDK carries its own copy of web3.js, so `instanceof VersionedTransaction` is false for
      // its transactions even when they are exactly that. Ask the object what it can do instead.
      signTransaction: async <T>(tx: T) => { signAny(tx); return tx; },
      signAllTransactions: async <T>(txs: T[]) => { txs.forEach(signAny); return txs; },
    };
    const receiver = new PythSolanaReceiver({ connection, wallet: wallet as never });

    // closeUpdateAccounts keeps the rent: the account only has to live long enough to be read.
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
    await builder.addPostPriceUpdates(data);

    const priceAccount = builder.getPriceUpdateAccount(`0x${feedId}`).toBase58();
    // Legacy, not versioned: the SDK's own send path sets feePayer and recentBlockhash directly and
    // calls partialSign, which only a legacy transaction has.
    const txs = await builder.buildLegacyTransactions({ computeUnitPriceMicroLamports: 50_000 });
    const sent = await receiver.provider.sendAll(
      txs.map((t) => ({ tx: t.tx, signers: t.signers })),
      { skipPreflight: false, preflightCommitment: "confirmed" },
    );

    return NextResponse.json({ ok: true, priceAccount, signatures: sent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0].slice(0, 180) }, { status: 502 });
  }
}
