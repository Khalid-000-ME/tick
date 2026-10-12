"use client";

import { bytesToHex, createPublicClient, http, type WalletClient } from "viem";
import { TickFeedAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { requestGas } from "@/lib/requestGas";

/**
 * The feed's reads and writes, and the photo squeeze that makes a post affordable.
 *
 * A photo is kept in the post's log, and every byte of it is paid for in gas, so it is
 * shrunk in the browser first: centre-fitted, then stepped down in size and quality until it
 * fits a budget that costs a few tenths of a token. The contract's own bound is looser; this
 * is the one that matters for what a post costs.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 400 });

export interface FeedPost {
  id: number;
  author: string;
  at: number;
  likes: number;
  blockNumber: number;
  imageBytes: number;
  card: boolean;
  caption: string;
}

export const PAGE = 12;
/** What a post's photo is squeezed to. Roughly 0.15 of the gas token. */
export const PHOTO_BUDGET = 30_000;
/** The contract's own limit, never to be exceeded. */
export const PHOTO_MAX = 46_000;

/** Gas for a post. Monad charges a calldata floor of about 40 gas a byte, above the usual 16. */
export const postGas = (imageBytes: number) => 300_000n + 42n * BigInt(imageBytes);

type Raw = { author: string; at: bigint; likes: number; blockNumber: bigint; imageBytes: number; card: boolean; caption: string };
const toPost = (id: bigint, p: Raw): FeedPost => ({
  id: Number(id), author: p.author.toLowerCase(), at: Number(p.at), likes: Number(p.likes),
  blockNumber: Number(p.blockNumber), imageBytes: Number(p.imageBytes), card: p.card, caption: p.caption,
});

/** A page of the feed, newest first. `before` is the lowest id already shown. */
export async function fetchFeed(before = 0, count = PAGE): Promise<FeedPost[]> {
  const [ids, page] = (await pub.readContract({
    address: CONTRACTS.tickFeed, abi: TickFeedAbi, functionName: "latest", args: [BigInt(count), BigInt(before)],
  })) as readonly [readonly bigint[], readonly Raw[]];
  return ids.map((id, i) => toPost(id, page[i]));
}

export async function fetchLikedBy(account: string, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const res = await pub.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: CONTRACTS.tickFeed, abi: TickFeedAbi, functionName: "liked" as const, args: [BigInt(id), account as `0x${string}`] as const })),
  });
  return new Set(ids.filter((_, i) => res[i].status === "success" && res[i].result === true));
}

export async function fetchPostsBy(author: string): Promise<FeedPost[]> {
  const ids = (await pub.readContract({ address: CONTRACTS.tickFeed, abi: TickFeedAbi, functionName: "postsBy", args: [author as `0x${string}`] })) as readonly bigint[];
  const res = await pub.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: CONTRACTS.tickFeed, abi: TickFeedAbi, functionName: "postInfo" as const, args: [id] as const })),
  });
  return res.flatMap((r, i) => (r.status === "success" ? [toPost(ids[i], r.result as Raw)] : [])).reverse();
}

/**
 * Squeeze a photo to fit the budget, or say it cannot be done. Returns the bytes of a WebP
 * square-cropped to its shorter side's centre, so every photo sits in the feed the same way.
 */
export async function squeezePhoto(file: File): Promise<Uint8Array> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2;
  const sy = (bmp.height - side) / 2;
  let best: Blob | null = null;
  for (const size of [720, 600, 480, 400, 320]) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(size, side);
    canvas.getContext("2d")!.drawImage(bmp, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    for (const q of [0.78, 0.64, 0.5, 0.38]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
      if (!blob) continue;
      best = blob;
      if (blob.size <= PHOTO_BUDGET) return new Uint8Array(await blob.arrayBuffer());
    }
  }
  if (best && best.size <= PHOTO_MAX) return new Uint8Array(await best.arrayBuffer());
  throw new Error("That photo is too detailed to fit. Try a simpler one.");
}

type Fn = "post" | "like";

/** One write, with the starter gas a new wallet needs and the network switch if it is elsewhere. */
export async function sendFeed(
  walletClient: WalletClient | null,
  account: `0x${string}` | null,
  functionName: Fn,
  args: readonly unknown[],
  gas: bigint
): Promise<{ ok: boolean; message: string }> {
  if (!walletClient || !account) return { ok: false, message: "Log in first." };
  try {
    await requestGas(account);
    if ((await walletClient.getChainId()) !== monadTestnet.id) await walletClient.switchChain({ id: monadTestnet.id });
    const hash = await walletClient.writeContract({ address: CONTRACTS.tickFeed, abi: TickFeedAbi, functionName, args, account, chain: monadTestnet, gas } as never);
    const rc = await pub.waitForTransactionReceipt({ hash });
    return rc.status === "success" ? { ok: true, message: "Done." } : { ok: false, message: "That reverted on chain. Nothing changed." };
  } catch (e) {
    const name = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName;
    if (name === "Empty") return { ok: false, message: "Add words, a photo, or your card." };
    if (name === "TooLong") return { ok: false, message: "That is too long. Keep words under 280 characters." };
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    if (/user rejected|denied/i.test(msg)) return { ok: false, message: "You rejected the transaction." };
    if (/missing or invalid parameters/i.test(msg)) return { ok: false, message: "Your gas tank is too low for that. Open Fund and tap Fill gas." };
    return { ok: false, message: msg.split("\n")[0] };
  }
}

export const encodeImage = (bytes: Uint8Array) => (bytes.length ? bytesToHex(bytes) : "0x");
