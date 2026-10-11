"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Info } from "@phosphor-icons/react";
import { formatEther, parseAbi } from "viem";
import { AccountShell } from "@/components/AccountShell";
import { Erc20Abi, TickAbi, TickSportsAbi } from "@/lib/chain/abi";
import { CONTRACTS, explorerAddress, monadTestnet, toUsd } from "@/lib/chain/config";
import { readClient } from "@/lib/useWallet";
import { gasShortfall } from "@/lib/gasCheck";
import { requestGas } from "@/lib/requestGas";
import { useTickWallet } from "@/lib/useTickWallet";

/** Tick and TickSports expose the same balance interface, so one ABI serves both. */
const BalanceAbi = parseAbi(["function deposits(address) view returns (uint256)", "function withdraw(uint256)"]);

interface Balances {
  mon: number;
  wallet: number;
  tick: number;
  sports: number;
}

export function FundView() {
  const wallet = useTickWallet();
  const { account, status, walletClient } = wallet;
  const [bal, setBal] = useState<Balances | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const [mon, wal, tick, sports] = await Promise.all([
        readClient.getBalance({ address: account }),
        readClient.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account] }),
        readClient.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account] }),
        // The sports contract holds its own balance, so it is listed and withdrawn separately.
        readClient.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [account] }),
      ]);
      setBal({ mon: Number(formatEther(mon)), wallet: toUsd(wal as bigint), tick: toUsd(tick as bigint), sports: toUsd(sports as bigint) });
    } catch {
      /* a failed poll keeps the last numbers on screen */
    }
  }, [account]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function withdrawAll(from: "tick" | "sports" = "tick") {
    setNote(null);
    if (!walletClient || !account) {
      setNote("The wallet is not ready to sign yet. Reconnect it and try again.");
      return;
    }
    setWithdrawing(true);
    try {
      const short = await gasShortfall(readClient, account, [220_000n]);
      if (short) {
        setNote(short);
        return;
      }
      const address = from === "sports" ? CONTRACTS.tickSports : CONTRACTS.tick;
      const raw = await readClient.readContract({ address, abi: BalanceAbi, functionName: "deposits", args: [account] });
      if (raw === 0n) {
        setNote("Nothing to withdraw: your Tick balance is empty.");
        return;
      }
      const hash = await walletClient.writeContract({
        address,
        abi: BalanceAbi,
        functionName: "withdraw",
        args: [raw],
        account,
        chain: monadTestnet,
        gas: 220_000n,
      });
      const rc = await readClient.waitForTransactionReceipt({ hash });
      setNote(rc.status === "success" ? `${toUsd(raw).toFixed(2)} USDC moved back to your wallet.` : "The withdrawal reverted on chain. Nothing was moved.");
      await load();
    } catch (e) {
      setNote(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]);
    } finally {
      setWithdrawing(false);
    }
  }

  function copy(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    });
  }

  return (
    <AccountShell active="fund" wallet={wallet}>
      <section className="page-intro">
        <h1>Fund your account</h1>
        <p>Stakes are paid in USDC from your Tick balance. Send USDC to your wallet address and the app moves it in when you stake.</p>
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
            <div className="stat">
              <span>In Tick (stakeable)</span>
              <strong>{bal ? bal.tick.toFixed(2) : "-"}</strong>
              {bal && bal.tick > 0 && (
                <button type="button" className="btn-ghost small" disabled={withdrawing} onClick={() => void withdrawAll("tick")}>
                  {withdrawing ? "Withdrawing…" : "Withdraw to wallet"}
                </button>
              )}
            </div>
            <div className="stat">
              <span>Sports balance</span>
              <strong>{bal ? bal.sports.toFixed(2) : "0.00"}</strong>
              {bal && bal.sports > 0 && (
                <button type="button" className="btn-ghost small" disabled={withdrawing} onClick={() => void withdrawAll("sports")}>
                  {withdrawing ? "Withdrawing..." : "Withdraw to wallet"}
                </button>
              )}
            </div>
            <div className="stat"><span>In wallet · USDC</span><strong>{bal ? bal.wallet.toFixed(2) : "-"}</strong></div>
            <div className="stat"><span>Gas · MON</span><strong>{bal ? bal.mon.toFixed(3) : "-"}</strong></div>
          </section>

          <section className="fund-grid">
            <article className="fund-option">
              <h2>Send USDC from another wallet</h2>
              <p>Transfer USDC on Monad Testnet to the address above. It shows up in your wallet balance within a block or two.</p>
              <div className="fund-token">
                <span>USDC contract</span>
                <code>{CONTRACTS.usdc}</code>
                <button type="button" className="btn-ghost small" onClick={() => copy("token", CONTRACTS.usdc)}>
                  {copied === "token" ? "Copied" : "Copy"}
                </button>
              </div>
            </article>

            <article className="fund-option">
              <h2>Get test USDC</h2>
              <p>Circle&apos;s faucet sends free testnet USDC. Choose Monad Testnet and paste your address.</p>
              <a className="btn-solid" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Open Circle&apos;s faucet</a>
            </article>

            <article className="fund-option">
              <h2>Get MON for gas</h2>
              <p>Every transaction is paid in MON. {bal && bal.mon < 0.05 ? "Your balance is low." : "Top up from the testnet faucet when it runs low."}</p>
              {bal && bal.mon < 0.05 && (
                <button
                  type="button"
                  className="btn-solid"
                  onClick={async () => {
                    setNote((await requestGas(account)) ? "Sent 0.2 MON to your wallet." : "Could not send gas right now; use the Monad faucet instead.");
                    await load();
                  }}
                >
                  Get 0.2 MON now
                </button>
              )}
              <a className="btn-ghost" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Open the Monad faucet</a>
            </article>

            <article className="fund-option is-muted">
              <h2>Buy stablecoins with a card <span className="soon-pill">Coming soon</span></h2>
              <p>
                A Stripe-powered checkout is planned, so you can buy USDC with a card or bank transfer without leaving Tick
                and have it land straight in your wallet. It is not live on testnet, where USDC is free from the faucet above.
              </p>
            </article>
          </section>

          {note && (
            <div className="page-note" role="status">
              <Info weight="bold" />
              <p>{note}</p>
              <button type="button" onClick={() => setNote(null)} aria-label="Dismiss">×</button>
            </div>
          )}
        </>
      )}
    </AccountShell>
  );
}
