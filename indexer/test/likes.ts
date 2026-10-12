/** Offline check of the one path the real chain has not produced yet: a like taken back. */
import { createTestIndexer } from "envio";

const BASE = 70_500_000;
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const FEED = "0x26608eDF8e677431fFDDda4d1630D6B99d383433";
const mk = (event: string, params: Record<string, unknown>, block: number) => ({
  contract: "TickFeed", event, srcAddress: FEED, logIndex: 0,
  block: { number: BASE + block, timestamp: 1000 + block, hash: "0x00" }, transaction: { hash: `0x${block}` }, params,
});

const indexer = createTestIndexer();
await indexer.process({
  chains: {
    10143: {
      startBlock: BASE + 1, endBlock: BASE + 6,
      simulate: [
        mk("Posted", { id: 1n, author: A, caption: "hi", card: true, image: "0x52494646" }, 1),
        mk("Liked", { id: 1n, by: A, on: true }, 2),
        mk("Liked", { id: 1n, by: B, on: true }, 3),
        mk("Liked", { id: 1n, by: A, on: false }, 4),
        mk("Liked", { id: 1n, by: B, on: false }, 5),
        mk("Liked", { id: 1n, by: B, on: true }, 6),
      ] as never,
    },
  },
});
const post = (await indexer.Post.getAll())[0];
const likes = await indexer.Like.getAll();
const ok = post.likes === 1 && likes.length === 1 && likes[0].user === B && post.imageBytes === 4 && post.image === "0x52494646";
console.log("likes", post.likes, "rows", likes.map((l) => l.user.slice(-2)), "imageBytes", post.imageBytes, ok ? "OK" : "WRONG");
process.exit(ok ? 0 : 1);
