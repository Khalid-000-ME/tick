import { indexer } from "envio";

/** A trader's name and picture. Saved again, it replaces the row. */
indexer.onEvent({ contract: "TickProfiles", event: "ProfileSet" }, async ({ event, context }) => {
  context.Profile.set({
    id: event.params.user.toLowerCase(),
    username: event.params.username,
    displayName: event.params.displayName,
    avatar: event.params.avatar,
  });
});
