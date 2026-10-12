import { indexer } from "envio";

/**
 * Groups, rooms and their chat, from TickSocial's events.
 *
 * Counts are kept on the group and the room as they change, so a list of groups is one query
 * with no per-row counting. Ordering inside a transaction is guaranteed: a group is created
 * and then its creator joins it, so a Joined handler can rely on the group already existing.
 */
const at = (e: { block: { timestamp: number } }) => e.block.timestamp;
const lower = (a: string) => a.toLowerCase();

indexer.onEvent({ contract: "TickSocial", event: "GroupCreated" }, async ({ event, context }) => {
  context.Group.set({
    id: String(event.params.id),
    n: Number(event.params.id),
    name: event.params.name,
    avatar: event.params.avatar,
    creator: lower(event.params.creator),
    createdAt: at(event),
    memberCount: 0,
    roomCount: 0,
    messageCount: 0,
  });
});

indexer.onEvent({ contract: "TickSocial", event: "GroupChanged" }, async ({ event, context }) => {
  const g = await context.Group.get(String(event.params.id));
  if (!g) return;
  context.Group.set({ ...g, name: event.params.name, avatar: event.params.avatar });
});

indexer.onEvent({ contract: "TickSocial", event: "GroupJoined" }, async ({ event, context }) => {
  const id = String(event.params.id);
  const g = await context.Group.get(id);
  if (!g) return;
  const member = lower(event.params.member);
  context.GroupMember.set({ id: `${id}-${member}`, group_id: id, member });
  context.Group.set({ ...g, memberCount: g.memberCount + 1 });
});

indexer.onEvent({ contract: "TickSocial", event: "RoomCreated" }, async ({ event, context }) => {
  const groupId = Number(event.params.groupId);
  context.Room.set({
    id: String(event.params.id),
    n: Number(event.params.id),
    name: event.params.name,
    creator: lower(event.params.creator),
    groupId,
    createdAt: at(event),
    memberCount: 0,
    messageCount: 0,
  });
  if (groupId !== 0) {
    const g = await context.Group.get(String(groupId));
    if (g) context.Group.set({ ...g, roomCount: g.roomCount + 1 });
  }
});

indexer.onEvent({ contract: "TickSocial", event: "RoomJoined" }, async ({ event, context }) => {
  const id = String(event.params.id);
  const r = await context.Room.get(id);
  if (!r) return;
  const member = lower(event.params.member);
  context.RoomMember.set({ id: `${id}-${member}`, room_id: id, member });
  context.Room.set({ ...r, memberCount: r.memberCount + 1 });
});

indexer.onEvent({ contract: "TickSocial", event: "GroupPosted" }, async ({ event, context }) => {
  const g = await context.Group.get(String(event.params.id));
  if (!g) return;
  context.Message.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    kind: "group",
    refId: Number(event.params.id),
    sender: lower(event.params.from),
    text: event.params.text,
    at: at(event),
  });
  context.Group.set({ ...g, messageCount: g.messageCount + 1 });
});

indexer.onEvent({ contract: "TickSocial", event: "RoomPosted" }, async ({ event, context }) => {
  const r = await context.Room.get(String(event.params.id));
  if (!r) return;
  context.Message.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    kind: "room",
    refId: Number(event.params.id),
    sender: lower(event.params.from),
    text: event.params.text,
    at: at(event),
  });
  context.Room.set({ ...r, messageCount: r.messageCount + 1 });
});
