"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type WalletClient } from "viem";
import { TickProfilesAbi } from "@/lib/chain/abi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";

/**
 * Profiles on chain: read one, read many at once, and save your own.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

export interface Profile {
  username: string;
  displayName: string;
  avatar: string;
}

const EMPTY: Profile = { username: "", displayName: "", avatar: "" };
const cache = new Map<string, Profile>();

/** Many addresses in one multicall, cached, for lists like the leaderboard. */
export async function fetchProfiles(addresses: string[]): Promise<Map<string, Profile>> {
  const want = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => !cache.has(a));
  if (want.length) {
    const res = await pub.multicall({
      allowFailure: true,
      contracts: want.map((a) => ({ address: CONTRACTS.tickProfiles, abi: TickProfilesAbi, functionName: "profileOf" as const, args: [a as `0x${string}`] as const })),
    });
    want.forEach((a, i) => {
      const r = res[i];
      if (r.status === "success") {
        const [username, displayName, avatar] = r.result as readonly [string, string, string, bigint];
        cache.set(a, { username, displayName, avatar });
      }
    });
  }
  return new Map(addresses.map((a) => [a.toLowerCase(), cache.get(a.toLowerCase()) ?? EMPTY]));
}

export function useProfiles(addresses: string[]) {
  const [map, setMap] = useState<Map<string, Profile>>(new Map());
  const key = addresses.join(",");
  useEffect(() => {
    if (!addresses.length) return;
    let off = false;
    void fetchProfiles(addresses).then((m) => { if (!off) setMap(m); }).catch(() => {});
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/** Your own profile, with saving. */
export function useMyProfile(account: `0x${string}` | null, walletClient: WalletClient | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!account) return;
    cache.delete(account.toLowerCase());
    const m = await fetchProfiles([account]);
    setProfile(m.get(account.toLowerCase()) ?? EMPTY);
  }, [account]);

  // Loaded with a cancel flag, so switching accounts mid-fetch cannot let the previous
  // account's profile land last.
  useEffect(() => {
    if (!account) return;
    let off = false;
    cache.delete(account.toLowerCase());
    void fetchProfiles([account]).then((m) => {
      if (!off) setProfile(m.get(account.toLowerCase()) ?? EMPTY);
    });
    return () => {
      off = true;
    };
  }, [account]);

  const available = useCallback(
    async (username: string) => {
      if (!account) return false;
      return (await pub.readContract({ address: CONTRACTS.tickProfiles, abi: TickProfilesAbi, functionName: "available", args: [username, account] })) as boolean;
    },
    [account]
  );

  const save = useCallback(
    async (next: Profile): Promise<{ ok: boolean; message: string }> => {
      if (!walletClient || !account) return { ok: false, message: "Connect first." };
      setSaving(true);
      try {
        const hash = await walletClient.writeContract({
          address: CONTRACTS.tickProfiles, abi: TickProfilesAbi, functionName: "setProfile",
          args: [next.username, next.displayName, next.avatar], account, chain: monadTestnet, gas: 600_000n,
        });
        const rc = await pub.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") return { ok: false, message: "Saving reverted. The username may have just been taken." };
        await reload();
        window.dispatchEvent(new Event("tick:profile"));
        return { ok: true, message: "Profile saved." };
      } catch (e) {
        const data = (e as { cause?: { data?: { errorName?: string } } }).cause?.data;
        if (data?.errorName === "UsernameTaken") return { ok: false, message: "That username is taken." };
        if (data?.errorName === "BadUsername") return { ok: false, message: "Usernames are 3 to 20 characters: a-z, 0-9 and _." };
        return { ok: false, message: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0] };
      } finally {
        setSaving(false);
      }
    },
    [walletClient, account, reload]
  );

  // Other parts of the page (the header) refresh when the profile is saved.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener("tick:profile", on);
    return () => window.removeEventListener("tick:profile", on);
  }, [reload]);

  // Signed out means no profile, derived rather than stored, so it can never go stale.
  return { profile: account ? profile : null, save, saving, available, reload };
}
