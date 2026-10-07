"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Info } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { TestUSDAbi, TickAbi } from "@/lib/chain/abi";
import { CONTRACTS, explorerAddress, monadTestnet, toUsd } from "@/lib/chain/config";
import { readClient } from "@/lib/useWallet";
import { useTickWallet } from "@/lib/useTickWallet";
import { formatEther } from "viem";

interface Balances {
  mon: number;
  wallet: number;
  tick: number;
  lastClaim: number;
  cooldown: number;
  faucetAmount: number;
}

export function FundView() {
  const wallet = useTickWallet();
  const { account, walletClient, status } = wallet;
  const [bal, setBal] = useState<Balances | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const [mon, wal, tick, last, cool, amt] = await Promise.all([
        readClient.getBalance({ address: account }),
        readClient.readContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "balanceOf", args: [account] }),
        readClient.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account] }),
        readClient.readContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "lastClaim", args: [account] }),
        readClient.readContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "FAUCET_COOLDOWN", args: [] }),
        readClient.readContract({ address: CONTRACTS.testUsd, abi: TestUSDAbi, functionName: "FAUCET_AMOUNT", args: [] }),
      ]);
      setBal({
        mon: Number(formatEther(mon)),
        wallet: toUsd(wal as bigint),
        tick: toUsd(tick as bigint),
        lastClaim: Number(last),
        cooldown: Number(cool),
        faucetAmount: toUsd(amt as bigint),
      });
    } catch {
      /* a failed poll keeps the last numbers on screen */
    }
  }, [account]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); setNow(Math.floor(Date.now() / 1000)); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  function copy(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    });
  }

  const readyAt = bal ? bal.lastClaim + bal.cooldown : 0;
  const cooling = bal !== null && bal.lastClaim > 0 && now < readyAt;
  const minsLeft = Math.max(1, Math.ceil((readyAt - now) / 60));

  async function faucet() {
    if (!walletClient || !account) return;
    setBusy(true);
    setMessage(null);
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.testUsd,
        abi: TestUSDAbi,
        functionName: "claim",
        args: [],
        account,
        chain: monadTestnet,
      });
      await readClient.waitForTransactionReceipt({ hash });
      setMessage(`${bal?.faucetAmount ?? ""} tUSD sent to your wallet.`);
      await load();
    } catch (e) {
      const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
      setMessage(m.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountShell active="fund" wallet={wallet}>
      <section className="page-intro">
        <h1>Fund your account</h1>
        <p>Stakes are paid from your Tick balance. Send funds to your wallet address and the app moves them in when you stake.</p>
      </section>

      {status !== "ready" || !account ? (
        <div className="page-empty">Connect a wallet to see your deposit address.</div>
      ) : (
        <>
          <section className="fund-card">
            <span className="fund-label">Your wallet address · Monad Testnet</span>
            <div className="fund-address">
              <code>{account}</code>
              <button type="button" className="btn-solid small" onClick={() => copy("addr", account)}>
                {copied === "addr" ? <><Check weight="bold" /> Copied</> : <><Copy weight="bold" /> Copy</>}
              </button>
            </div>
            <p className="fund-hint">
              Only send on <strong>Monad Testnet</strong> (chain {monadTestnet.id}). Tokens sent on any other network will not arrive.{" "}
              <a href={explorerAddress(account)} target="_blank" rel="noreferrer">View on the explorer</a>
            </p>
          </section>

          <section className="stat-row" aria-label="Balances">
            <div className="stat"><span>In Tick (stakeable)</span><strong>{bal ? bal.tick.toFixed(2) : "—"}</strong></div>
            <div className="stat"><span>In wallet · tUSD</span><strong>{bal ? bal.wallet.toFixed(2) : "—"}</strong></div>
            <div className="stat"><span>Gas · MON</span><strong>{bal ? bal.mon.toFixed(3) : "—"}</strong></div>
          </section>

          <section className="fund-grid">
            <article className="fund-option">
              <h2>Send from another wallet</h2>
              <p>Transfer the staking token to the address above. It shows up in your wallet balance within a block or two.</p>
              <div className="fund-token">
                <span>Token contract</span>
                <code>{CONTRACTS.testUsd}</code>
                <button type="button" className="btn-ghost small" onClick={() => copy("token", CONTRACTS.testUsd)}>
                  {copied === "token" ? "Copied" : "Copy"}
                </button>
              </div>
            </article>

            <article className="fund-option">
              <h2>Get test tUSD</h2>
              <p>Free on testnet: {bal ? bal.faucetAmount : 500} tUSD per claim, once every {bal ? Math.round(bal.cooldown / 3600) : 6} hours.</p>
              <button type="button" className="btn-solid" disabled={busy || cooling || !bal} onClick={() => void faucet()}>
                {busy ? "Claiming…" : cooling ? `Available in ${minsLeft} min` : "Claim test tUSD"}
              </button>
            </article>

            <article className="fund-option">
              <h2>Get MON for gas</h2>
              <p>Every transaction is paid in MON. {bal && bal.mon < 0.05 ? "Your balance is low." : "Top up from the testnet faucet when it runs low."}</p>
              <a className="btn-ghost" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Open the Monad faucet</a>
            </article>

            <article className="fund-option is-muted">
              <h2>Buy with a card</h2>
              <p>
                Not available on testnet. Card purchases settle in real USDC on a supported mainnet, which Tick does not run yet.
              </p>
            </article>
          </section>

          {message && (
            <div className="page-note" role="status">
              <Info weight="bold" />
              <p>{message}</p>
              <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
            </div>
          )}
        </>
      )}
    </AccountShell>
  );
}
