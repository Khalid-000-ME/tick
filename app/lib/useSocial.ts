"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/** A group as the API returns it, with its size counted for the list. */
export interface Group { id: string; name: string; createdAt: number; members: string[]; memberCount?: number }
export interface Room { code: string; name: string; groupId: string | null; createdAt: number; createdBy: string; members: string[] }
export interface Standing { address: string; bets: number; staked: number; returned: number; net: number }

/**
 * Groups, rooms and the calls that change them.
 *
 * Every write carries the Privy access token, because the server will only add a wallet its
 * owner is signed in as. Reads are open, so a room's table loads for anyone holding the link.
 */
export function useSocial(address: string | null) {
  const { getAccessToken } = usePrivy();
  const [groups, setGroups] = useState<Group[]>([]);
  const [mine, setMine] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/social${address ? `?address=${address}` : ""}`, { cache: "no-store" });
      const body = (await res.json()) as { groups?: Group[]; mine?: Room[] };
      setGroups(body.groups ?? []);
      setMine(body.mine ?? []);
    } catch {
      /* the page keeps whatever it already had */
    } finally {
      setLoading(false);
    }
  }, [address]);

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

  const act = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; room?: Room; group?: Group }> => {
      if (!address) return { ok: false, error: "Log in first." };
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/social", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action, address, ...payload }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string; room?: Room; group?: Group };
        if (body.ok) await reload();
        return body;
      } catch {
        return { ok: false, error: "That did not go through. Try again." };
      }
    },
    [address, getAccessToken, reload]
  );

  return { groups, mine, loading, reload, act };
}
