import { hexToBytes, parseAbiItem } from "viem";
import sharp from "sharp";
import { TickFeedAbi } from "@/lib/chain/abi";
import { CONTRACTS } from "@/lib/chain/config";
import { pub } from "@/lib/server/oracle";

/**
 * A feed photo, read back from the chain.
 *
 * The bytes live in the post's own log, not on any server of ours. The post records the one
 * block it landed in, and Monad's RPC answers a log query for a single block even though it
 * refuses wide ranges, so this is one contract read and one log read. Once found a photo can
 * never change, so it is cached for good, in memory here and in the browser.
 *
 * Anyone can post any bytes, so nothing is served as it came: it is decoded and re-drawn as
 * a plain WebP, which drops metadata and turns anything that is not an image into a 404.
 */
export const dynamic = "force-dynamic";

const EVENT = parseAbiItem("event Posted(uint64 indexed id, address indexed author, bytes image)");
const KEEP = 150;
const cache = new Map<number, Buffer>();

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });

  let image = cache.get(id);
  if (!image) {
    try {
      const post = (await pub.readContract({ address: CONTRACTS.tickFeed, abi: TickFeedAbi, functionName: "postInfo", args: [BigInt(id)] })) as { blockNumber: bigint; imageBytes: number };
      if (!post.imageBytes) return new Response("Not found", { status: 404 });
      const logs = await pub.getLogs({ address: CONTRACTS.tickFeed, event: EVENT, args: { id: BigInt(id) }, fromBlock: post.blockNumber, toBlock: post.blockNumber });
      const raw = logs[0]?.args.image;
      if (!raw) return new Response("Not found", { status: 404 });
      image = await sharp(Buffer.from(hexToBytes(raw)), { limitInputPixels: 25_000_000 }).rotate().webp({ quality: 80 }).toBuffer();
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (cache.size >= KEEP) cache.delete(cache.keys().next().value as number);
    cache.set(id, image);
  }

  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
