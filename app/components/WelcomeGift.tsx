"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { pickWallet } from "@/lib/pickWallet";
import { Gift, X } from "@phosphor-icons/react";

/**
 * Claims the welcome USDC for a signed-in user, once, and says so.
 *
 * The server decides everything (see app/api/welcome): this only asks, with the user's
 * verified Privy token, as soon as a wallet exists. A claim that settles either way (given,
 * or already given before) is remembered in this browser so it is not asked again; a failure
 * that is the server's problem is left unmarked so the next visit tries once more.
 */
export function WelcomeGift() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const address = pickWallet(wallets)?.address ?? null;
  const [note, setNote] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!ready || !authenticated || !address) return;
    const key = `tick.welcome.${address.toLowerCase()}`;
    if (asked.current.has(key)) return;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* blocked storage: the server still refuses a second claim */
    }
    asked.current.add(key);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ address }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; claimed?: boolean; amount?: number; error?: string; code?: string };
        if (body.ok) {
          try {
            localStorage.setItem(key, "1");
          } catch {
            /* nothing to remember it in */
          }
          if (body.claimed) setNote(`${body.amount} testnet USDC added to your balance.`);
        } else if (body.code === "empty" || body.code === "limit") {
          setNote(body.error ?? null);
        }
      } catch {
        /* offline or the server is down: tried again on the next visit */
      }
    })();
  }, [ready, authenticated, address, getAccessToken]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 9000);
    return () => clearTimeout(t);
  }, [note]);

  if (!note) return null;
  return (
    <div className="gift-toast" role="status">
      <Gift weight="fill" />
      <span>{note}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}><X weight="bold" /></button>
    </div>
  );
}
