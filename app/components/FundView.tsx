"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, GasPump, Info } from "@phosphor-icons/react";
import { formatEther } from "viem";
import { AccountShell } from "@/components/AccountShell";
import { CONTRACTS, explorerAddress, monadTestnet } from "@/lib/chain/config";
import { consolidateToWallet, fillGas, fmt, gasStationInfo, quoteGas, readFunds, stakesFor, type Funds } from "@/lib/funds";
import { useTickWallet } from "@/lib/useTickWallet";

/** USDC amounts offered for a gas fill. */
const FILLS = [0.1, 0.25, 0.5, 1];

export function FundView() {
  const wallet = useTickWallet();
  const { account, status, walletClient } = wallet;
  const [funds, setFunds] = useState<Funds | null>(null);
  const [station, setStation] = useState<{ reserve: bigint; maxFill: bigint; gasPrice: bigint } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [fill, setFill] = useState("0.25");
  const [quote, setQuote] = useState<{ amount: string; mon: bigint } | null>(null);

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const [f, s] = await Promise.all([readFunds(account), gasStationInfo()]);
      setFunds(f);
      setStation(s);
    } catch {
      /* a failed poll keeps the last numbers on screen */
    }
  }, [account]);

  useEffect(() => {
    let off = false;
    const poll = async () => {
      if (off) return;
      await load();
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [load]);

  // The live quote for whatever is typed, read from the contract so it is the rate the
  // fill will actually get.
  const fillUnits = toUnits(fill);
  useEffect(() => {
    let off = false;
    const t = setTimeout(() => {
      void quoteGas(fillUnits).then((mon) => { if (!off) setQuote({ amount: fill, mon }); }).catch(() => {});
    }, 200);
    return () => { off = true; clearTimeout(t); };
  }, [fill, fillUnits]);
  const quoted = quote?.amount === fill ? quote.mon : null;

  async function doFill() {
    if (!walletClient || !account) return setNote("The wallet is not ready to sign yet. Reconnect it and try again.");
    setNote(null);
    setBusy("Filling…");
    const r = await fillGas(walletClient, account, fillUnits, setBusy);
    setNote(r.message);
    setBusy(null);
    await load();
  }

  async function toWallet() {
    if (!walletClient || !account || !funds) return;
    setNote(null);
    setBusy("Moving…");
    try {
      const r = await consolidateToWallet(walletClient, account, funds, setBusy);
      setNote(r ?? `All ${fmt(funds.total)} USDC is in your wallet now, ready to send anywhere.`);
    } catch (e) {
      setNote(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]);
    } finally {
      setBusy(null);
      await load();
    }
  }

  function copy(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    });
  }

  const tankStakes = funds && station ? stakesFor(funds.mon, station.gasPrice) : null;
  const fillStakes = quoted !== null && station ? stakesFor(quoted, station.gasPrice) : null;
  const overMax = station ? fillUnits > station.maxFill : false;
  const parked = funds ? funds.tick + funds.sports : 0n;

  return (
    <AccountShell active="fund" wallet={wallet}>
      <section className="page-intro">
        <h1>Fund your account</h1>
        <p>One balance for every market. Add USDC to your address, and fill your gas tank with USDC.</p>
      </section>

      {status !== "ready" || !account ? (
        <div className="page-empty">Connect a wallet to see your deposit address.</div>
      ) : (
        <>
          <section className="stat-row fund-balances" aria-label="Balances">
            <div className="stat">
              <span>Balance · USDC</span>
              <strong>{funds ? fmt(funds.total) : "-"}</strong>
              {funds && parked > 0n && (
                <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => void toWallet()}>
                  Move all to wallet
                </button>
              )}
            </div>
            <div className="stat">
              <span>Gas tank</span>
              <strong>{tankStakes === null ? "-" : `${tankStakes} stakes`}</strong>
              <small>{funds ? `${Number(formatEther(funds.mon)).toFixed(3)} MON` : ""}</small>
            </div>
          </section>

          <section className="fund-card fund-gas">
            <div className="fund-gas-head">
              <GasPump weight="bold" />
              <div>
                <h2>Fill gas with USDC</h2>
                <p>Every transaction needs a little MON. Pay in USDC and the platform fills your tank in one transaction.</p>
              </div>
            </div>
            <div className="fund-gas-row">
              <div className="match-amounts">
                {FILLS.map((v) => (
                  <button key={v} type="button" className={fill === String(v) ? "is-active" : ""} onClick={() => setFill(String(v))}>${v}</button>
                ))}
              </div>
              <label className="amount-custom">
                <span>$</span>
                <input inputMode="decimal" value={fill} onChange={(e) => setFill(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="USDC to spend on gas" />
              </label>
            </div>
            <p className="fund-quote">
              {fillUnits <= 0n
                ? "Enter an amount."
                : overMax
                  ? `Up to ${fmt(station!.maxFill)} USDC per fill.`
                  : quoted === null
                    ? "Quoting…"
                    : <>Fills <strong>{Number(formatEther(quoted)).toFixed(3)} MON</strong>, about {fillStakes} stakes.</>}
            </p>
            <button type="button" className="btn-solid" disabled={!!busy || fillUnits <= 0n || overMax || quoted === null || (funds ? funds.total < fillUnits : true)} onClick={() => void doFill()}>
              {busy ?? `Fill for $${fill || "0"}`}
            </button>
          </section>

          <section className="fund-card">
            <span className="fund-label">Your address · Monad Testnet</span>
            <div className="fund-address">
              <code>{account}</code>
              <button type="button" className="btn-solid small" onClick={() => copy("addr", account)}>
                {copied === "addr" ? <><Check weight="bold" /> Copied</> : <><Copy weight="bold" /> Copy</>}
              </button>
            </div>
            <p className="fund-hint">
              Send USDC on <strong>Monad Testnet</strong> (chain {monadTestnet.id}) only.{" "}
              <a href={explorerAddress(account)} target="_blank" rel="noreferrer">Explorer</a>
            </p>
          </section>

          <section className="fund-grid">
            <article className="fund-option">
              <h2>Get test USDC</h2>
              <p>Circle&apos;s faucet sends free testnet USDC. Choose Monad Testnet and paste your address.</p>
              <a className="btn-solid" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Open Circle&apos;s faucet</a>
            </article>

            <article className="fund-option">
              <h2>Send from another wallet</h2>
              <p>Transfer USDC on Monad Testnet to your address. It lands within a block or two.</p>
              <div className="fund-token">
                <span>USDC contract</span>
                <code>{CONTRACTS.usdc}</code>
                <button type="button" className="btn-ghost small" onClick={() => copy("token", CONTRACTS.usdc)}>
                  {copied === "token" ? "Copied" : "Copy"}
                </button>
              </div>
            </article>

            <article className="fund-option is-muted">
              <h2>Buy with a card <span className="soon-pill">Coming soon</span></h2>
              <p>A Stripe-powered checkout to buy USDC with a card or bank transfer, landing straight in your balance.</p>
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

function toUnits(v: string): bigint {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n;
}
