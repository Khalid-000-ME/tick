import { indexer } from "envio";

const UNRESOLVED = 0;

indexer.onEvent({ contract: "Tick", event: "Staked" }, async ({ event, context }) => {
  const marketId = event.params.marketId;

  // The first stake in a window creates the market; later stakes find it already there.
  await context.Market.getOrCreate({
    id: marketId,
    feedId: event.params.feedId,
    strike: event.params.strike,
    closesAt: Number(event.params.closesAt),
    outcome: UNRESOLVED,
    settlePrice: undefined,
    totalAbove: undefined,
    totalBelow: undefined,
    settler: undefined,
    bounty: undefined,
    settledAt: undefined,
  });

  context.Stake.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    market_id: marketId,
    user: event.params.user.toLowerCase(),
    above: event.params.above,
    amount: event.params.amount,
    stakedAt: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "Tick", event: "Settled" }, async ({ event, context }) => {
  const market = await context.Market.get(event.params.marketId);
  // A Settled with no prior Staked cannot happen on this deployment: settling an empty
  // market reverts. Skipping keeps a replayed range from inventing a row.
  if (!market) return;

  context.Market.set({
    ...market,
    outcome: Number(event.params.outcome),
    settlePrice: event.params.settlePrice,
    totalAbove: event.params.totalAbove,
    totalBelow: event.params.totalBelow,
    settler: event.params.settler.toLowerCase(),
    bounty: event.params.bounty,
    settledAt: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "Tick", event: "Claimed" }, async ({ event, context }) => {
  context.Claim.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    market_id: event.params.marketId,
    user: event.params.user.toLowerCase(),
    payout: event.params.payout,
    claimedAt: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});
