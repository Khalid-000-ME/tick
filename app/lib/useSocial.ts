"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickSocialAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { gql } from "@/lib/indexer";
import { requestGas } from "@/lib/requestGas";

/**
 * Groups and rooms, read from and written to TickSocial.
 *
 * Nothing about membership is kept on a server: the contract is the list. That makes a room
 * checkable end to end, since the table it draws is public results for addresses anyone can
 * read back. The cost is a transaction to make or join one, which the starter gas drip
 * covers for a new wallet.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 400 });

export interface Group { id: number; name: string; avatar: string; creator: string; createdAt: number; members: number; rooms: number; messages: number }
export interface Room { id: number; name: string; creator: string; groupId: number; createdAt: number; members: number; messages: number }
export interface Post { from: string; at: number; text: string }

type RawGroup = { name: string; avatar: string; creator: string; createdAt: bigint };
type RawRoom = { name: string; creator: string; groupId: bigint; createdAt: bigint };

const toGroup = (id: number, g: RawGroup, members: bigint, rooms: bigint, messages: bigint): Group => ({
  id, name: g.name, avatar: g.avatar, creator: g.creator, createdAt: Number(g.createdAt),
  members: Number(members), rooms: Number(rooms), messages: Number(messages),
});

const toRoom = (id: number, r: RawRoom, members: bigint, messages: bigint): Room => ({
  id, name: r.name, creator: r.creator, groupId: Number(r.groupId), createdAt: Number(r.createdAt),
  members: Number(members), messages: Number(messages),
});
export interface Standing { address: string; bets: number; staked: number; returned: number; net: number }

// One helper for every view, so the call sites read as questions rather than as viem calls.
// The cast is only to keep the helper generic over the ABI's function names.
const read = <T,>(functionName: string, args: readonly unknown[]) =>
  pub.readContract({ address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName, args } as never) as Promise<T>;

/** Every group. From the indexer in one request, unless `fresh`, which reads the contract. */
export async function fetchGroups(fresh = false): Promise<Group[]> {
  if (!fresh) {
    const data = await gql<{ Group: { n: number; name: string; avatar: string; creator: string; createdAt: number; memberCount: number; roomCount: number; messageCount: number }[] }>(
      "{ Group(order_by: { n: asc }, limit: 500) { n name avatar creator createdAt memberCount roomCount messageCount } }"
    );
    if (data) {
      return data.Group.map((g) => ({
        id: g.n, name: g.name, avatar: g.avatar, creator: g.creator, createdAt: g.createdAt,
        members: g.memberCount, rooms: g.roomCount, messages: g.messageCount,
      }));
    }
  }
  const count = Number(await read<bigint>("groupCount", []));
  if (count === 0) return [];
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1));
  const res = await pub.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName: "groupInfo" as const, args: [id] as const })),
  });
  return res.flatMap((r, i) => {
    if (r.status !== "success") return [];
    const [group, members, rooms, messages] = r.result as readonly [RawGroup, bigint, bigint, bigint];
    return [toGroup(i + 1, group, members, rooms, messages)];
  });
}

export async function fetchRooms(ids: readonly number[]): Promise<Room[]> {
  if (ids.length === 0) return [];
  const res = await pub.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName: "roomInfo" as const, args: [BigInt(id)] as const })),
  });
  return res.flatMap((r, i) => {
    if (r.status !== "success") return [];
    const [room, members, messages] = r.result as readonly [RawRoom, bigint, bigint];
    return [toRoom(ids[i], room, members, messages)];
  });
}

export async function fetchRoom(id: number): Promise<{ room: Room; group: Group | null; members: string[] } | null> {
  const rooms = await fetchRooms([id]);
  if (rooms.length === 0) return null;
  const room = rooms[0];
  const members = (await read<readonly string[]>("roomMembers", [BigInt(id)])).map((m) => m.toLowerCase());
  let group: Group | null = null;
  if (room.groupId !== 0) group = await fetchGroup(room.groupId);
  return { room, group, members };
}

export async function fetchGroup(id: number): Promise<Group | null> {
  try {
    const [group, members, rooms, messages] = await read<readonly [RawGroup, bigint, bigint, bigint]>("groupInfo", [BigInt(id)]);
    return toGroup(id, group, members, rooms, messages);
  } catch {
    return null;
  }
}

export async function fetchGroupMembers(id: number): Promise<string[]> {
  return (await read<readonly string[]>("groupMembers", [BigInt(id)])).map((m) => m.toLowerCase());
}

export async function fetchRoomsIn(id: number): Promise<Room[]> {
  const ids = await read<readonly bigint[]>("roomsInGroup", [BigInt(id)]);
  return fetchRooms(ids.map(Number));
}

/** The last `count` messages of a chat, oldest first, straight from the contract. */
export async function fetchChat(kind: "group" | "room", id: number, count = 60): Promise<Post[]> {
  const posts = await read<readonly { from: string; at: bigint; text: string }[]>(kind === "group" ? "groupChat" : "roomChat", [BigInt(id), BigInt(count)]);
  return posts.map((p) => ({ from: p.from.toLowerCase(), at: Number(p.at), text: p.text }));
}

export function useSocial(account: `0x${string}` | null, walletClient: WalletClient | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [mine, setMine] = useState<Room[]>([]);
  const [myGroups, setMyGroups] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (fresh = false) => {
    try {
      const [all, roomIds, groupIds] = await Promise.all([
        fetchGroups(fresh),
        account ? read<readonly bigint[]>("roomsOf", [account]) : Promise.resolve([] as readonly bigint[]),
        account ? read<readonly bigint[]>("groupsOf", [account]) : Promise.resolve([] as readonly bigint[]),
      ]);
      setGroups(all);
      setMyGroups(groupIds.map(Number));
      setMine((await fetchRooms(roomIds.map(Number))).reverse());
    } catch {
      /* a failed read keeps whatever is on screen */
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await reload();
    };
    void poll();
    return () => {
      off = true;
    };
  }, [reload]);

  /** One write, with the starter gas a new wallet needs to send it. */
  const send = useCallback(
    async (
      functionName: "createGroup" | "joinGroup" | "createRoom" | "joinRoom" | "setGroup" | "postToGroup" | "postToRoom",
      args: readonly unknown[]
    ): Promise<{ ok: boolean; message: string }> => {
      if (!walletClient || !account) return { ok: false, message: "Log in first." };
      try {
        await requestGas(account);
        if ((await walletClient.getChainId()) !== monadTestnet.id) await walletClient.switchChain({ id: monadTestnet.id });
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName, args, account, chain: monadTestnet, gas: 500_000n,
        } as never);
        const rc = await pub.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") return { ok: false, message: "That reverted on chain. Nothing changed." };
        // What you just made is read from the chain, which has it already.
        await reload(true);
        return { ok: true, message: "Done." };
      } catch (e) {
        const name = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName;
        if (name === "AlreadyIn") return { ok: false, message: "You are already in that one." };
        if (name === "NotMember") return { ok: false, message: "Join first, then you can post." };
        if (name === "NotCreator") return { ok: false, message: "Only whoever started the group can change it." };
        if (name === "BadText") return { ok: false, message: "A message is 1 to 280 characters." };
        if (name === "BadAvatar") return { ok: false, message: "That picture reference is too long." };
        if (name === "BadName") return { ok: false, message: "Names are 1 to 40 characters." };
        if (name === "NoGroup" || name === "NoRoom") return { ok: false, message: "That does not exist." };
        const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
        if (/user rejected|denied/i.test(msg)) return { ok: false, message: "You rejected the transaction." };
        return { ok: false, message: msg.split("\n")[0] };
      }
    },
    [walletClient, account, reload]
  );

  return { groups, mine, myGroups, loading, reload, send };
}
