"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickSocialAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
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

export interface Group { id: number; name: string; creator: string; createdAt: number; members: number; rooms: number }
export interface Room { id: number; name: string; creator: string; groupId: number; createdAt: number; members: number }
export interface Standing { address: string; bets: number; staked: number; returned: number; net: number }

// One helper for every view, so the call sites read as questions rather than as viem calls.
// The cast is only to keep the helper generic over the ABI's function names.
const read = <T,>(functionName: string, args: readonly unknown[]) =>
  pub.readContract({ address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName, args } as never) as Promise<T>;

export async function fetchGroups(): Promise<Group[]> {
  const count = Number(await read<bigint>("groupCount", []));
  if (count === 0) return [];
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1));
  const res = await pub.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName: "groupInfo" as const, args: [id] as const })),
  });
  return res.flatMap((r, i) => {
    if (r.status !== "success") return [];
    const [name, creator, createdAt, members, rooms] = r.result as readonly [string, string, bigint, bigint, bigint];
    return [{ id: i + 1, name, creator, createdAt: Number(createdAt), members: Number(members), rooms: Number(rooms) }];
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
    const [name, creator, groupId, createdAt, members] = r.result as readonly [string, string, bigint, bigint, bigint];
    return [{ id: ids[i], name, creator, groupId: Number(groupId), createdAt: Number(createdAt), members: Number(members) }];
  });
}

export async function fetchRoom(id: number): Promise<{ room: Room; group: Group | null; members: string[] } | null> {
  const rooms = await fetchRooms([id]);
  if (rooms.length === 0) return null;
  const room = rooms[0];
  const members = (await read<readonly string[]>("roomMembers", [BigInt(id)])).map((m) => m.toLowerCase());
  let group: Group | null = null;
  if (room.groupId !== 0) {
    const [name, creator, createdAt, count, roomCount] = await read<readonly [string, string, bigint, bigint, bigint]>("groupInfo", [BigInt(room.groupId)]);
    group = { id: room.groupId, name, creator, createdAt: Number(createdAt), members: Number(count), rooms: Number(roomCount) };
  }
  return { room, group, members };
}

export function useSocial(account: `0x${string}` | null, walletClient: WalletClient | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [mine, setMine] = useState<Room[]>([]);
  const [myGroups, setMyGroups] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [all, roomIds, groupIds] = await Promise.all([
        fetchGroups(),
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
    async (functionName: "createGroup" | "joinGroup" | "createRoom" | "joinRoom", args: readonly unknown[]): Promise<{ ok: boolean; message: string }> => {
      if (!walletClient || !account) return { ok: false, message: "Log in first." };
      try {
        await requestGas(account);
        if ((await walletClient.getChainId()) !== monadTestnet.id) await walletClient.switchChain({ id: monadTestnet.id });
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tickSocial, abi: TickSocialAbi, functionName, args, account, chain: monadTestnet, gas: 500_000n,
        } as never);
        const rc = await pub.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") return { ok: false, message: "That reverted on chain. Nothing changed." };
        await reload();
        return { ok: true, message: "Done." };
      } catch (e) {
        const name = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName;
        if (name === "AlreadyIn") return { ok: false, message: "You are already in that one." };
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
