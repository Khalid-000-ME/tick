import { indexer } from "envio";

/**
 * The feed, from TickFeed's events. A post's photo is kept as hex on the row so it can be
 * served without a log query, and likes are one row per (post, user) that comes and goes with
 * the like, so the count on the post can always be checked against the rows.
 */
indexer.onEvent({ contract: "TickFeed", event: "Posted" }, async ({ event, context }) => {
  const image = event.params.image;
  // "0x" is a post with no photo.
  const hasPhoto = image.length > 2;
  context.Post.set({
    id: String(event.params.id),
    n: Number(event.params.id),
    author: event.params.author.toLowerCase(),
    at: event.block.timestamp,
    caption: event.params.caption,
    card: event.params.card,
    imageBytes: hasPhoto ? (image.length - 2) / 2 : 0,
    likes: 0,
    blockNumber: event.block.number,
    image: hasPhoto ? image : undefined,
  });
});

indexer.onEvent({ contract: "TickFeed", event: "Liked" }, async ({ event, context }) => {
  const postId = String(event.params.id);
  const post = await context.Post.get(postId);
  if (!post) return;
  const user = event.params.by.toLowerCase();
  const rowId = `${postId}-${user}`;
  if (event.params.on) {
    context.Like.set({ id: rowId, postId: Number(event.params.id), user });
    context.Post.set({ ...post, likes: post.likes + 1 });
  } else {
    context.Like.deleteUnsafe(rowId);
    context.Post.set({ ...post, likes: Math.max(0, post.likes - 1) });
  }
});
