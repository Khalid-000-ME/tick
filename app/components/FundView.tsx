"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, GasPump, Info } from "@phosphor-icons/react";
import { formatEther, formatUnits, getAddress, parseUnits } from "viem";
import { AccountShell } from "@/components/AccountShell";
import { CONTRACTS, explorerAddress, explorerTx, monadTestnet } from "@/lib/chain/config";
import { fillGas, fmt, gasStationInfo, quoteGas, readFunds, recipientProblem, sendUsdc, stakesFor, type Funds } from "@/lib/funds";
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
  const [noteHref, setNoteHref] = useState<string | null>(null);

  // Withdrawal form. Editing either field drops back out of the confirm step, so what was
  // confirmed is always exactly what is on screen.
  const [wTo, setWTo] = useState("");
  const [wAmt, setWAmt] = useState("");
  const [confirming, setConfirming] = useState(false);

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
    setNoteHref(null);
    setBusy("Filling…");
    const r = await fillGas(walletClient, account, fillUnits, setBusy);
    setNote(r.message);
    setBusy(null);
    await load();
  }

  async function doWithdraw() {
    if (!walletClient || !account) return setNote("The wallet is not ready to sign yet. Reconnect it and try again.");
    setNote(null);
    setNoteHref(null);
    setBusy("Sending…");
    const r = await sendUsdc(walletClient, account, wTo, wUnits, setBusy);
    if (r.ok) {
      setWTo("");
      setWAmt("");
    }
    setConfirming(false);
    setNote(r.message);
    setNoteHref(r.hash ? explorerTx(r.hash) : null);
    setBusy(null);
    await load();
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
  const toProblem = recipientProblem(wTo, account);
  const wUnits = parseUsdc(wAmt);
  const overBalance = !!funds && wUnits > funds.total;
  const canReview = !toProblem && wUnits > 0n && !!funds && !overBalance;

  return (
    <AccountShell active="fund" wallet={wallet}>
      <section className="page-intro">
        <h1>Fund your account</h1>
        <p>One balance. Every market.</p>
      </section>

      {status !== "ready" || !account ? (
        <div className="page-empty">Connect a wallet to see your deposit address.</div>
      ) : (
        <>
          <section className="stat-row fund-balances" aria-label="Balances">
            <div className="stat">
              <span>Balance · USDC</span>
              <strong>{funds ? fmt(funds.total) : "-"}</strong>
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
                <p>Pay in USDC. We top up your gas.</p>
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

          <section className="fund-card fund-withdraw" aria-label="Withdraw">
            <header>
              <h2>Withdraw</h2>
              <p>Send USDC to any wallet on Monad.</p>
            </header>
            <label className="wd-field">
              <span>To</span>
              <input
                className="wd-input"
                value={wTo}
                onChange={(e) => { setWTo(e.target.value); setConfirming(false); }}
                placeholder="Paste a wallet address, 0x..."
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!toProblem && wTo.trim() !== ""}
              />
            </label>
            {toProblem && wTo.trim() !== "" && <p className="wd-error" role="alert">{toProblem}</p>}
            <label className="wd-field">
              <span>Amount</span>
              <div className="wd-amount">
                <b>$</b>
                <input
                  inputMode="decimal"
                  value={wAmt}
                  onChange={(e) => { setWAmt(e.target.value.replace(/[^0-9.]/g, "")); setConfirming(false); }}
                  placeholder="0.00"
                  aria-label="USDC to withdraw"
                />
                <button type="button" disabled={!funds || funds.total === 0n} onClick={() => { if (funds) { setWAmt(formatUnits(funds.total, 6)); setConfirming(false); } }}>Max</button>
              </div>
            </label>
            <p className={overBalance ? "wd-error" : "wd-avail"}>{overBalance ? `More than your ${funds ? fmt(funds.total) : "0.00"} USDC balance.` : `Available: ${funds ? fmt(funds.total) : "-"} USDC`}</p>
            {!confirming ? (
              <button type="button" className="btn-solid" disabled={!canReview || !!busy} onClick={() => setConfirming(true)}>Review withdrawal</button>
            ) : (
              <div className="wd-confirm">
                <p>Send <strong>${wAmt} USDC</strong> to</p>
                <code>{wTo.trim() && !toProblem ? getAddress(wTo.trim()) : ""}</code>
                <p className="wd-warn">Monad Testnet only. This cannot be undone.</p>
                <div className="wd-actions">
                  <button type="button" className="btn-solid" disabled={!!busy} onClick={() => void doWithdraw()}>{busy ?? "Confirm and send"}</button>
                  <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              </div>
            )}
          </section>

          <section className="fund-grid">
            <article className="fund-option">
              <h2>Get test USDC</h2>
              <p>Free testnet USDC from Circle.</p>
              <a className="btn-solid" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Open Circle&apos;s faucet</a>
            </article>

            <article className="fund-option">
              <h2>Send from another wallet</h2>
              <p>USDC on Monad Testnet, to the address above.</p>
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
              <p>Pay by card with Stripe.</p>
            </article>
          </section>

          {note && (
            <div className="page-note" role="status">
              <Info weight="bold" />
              <p>
                {note}
                {noteHref && <> <a href={noteHref} target="_blank" rel="noreferrer">View transaction <ArrowUpRight weight="bold" /></a></>}
              </p>
              <button type="button" onClick={() => { setNote(null); setNoteHref(null); }} aria-label="Dismiss">×</button>
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

/** A USDC amount typed as text, to base units. Anything malformed or beyond six decimals is zero. */
function parseUsdc(v: string): bigint {
  const t = v.trim();
  if (t === "" || t === "." || !/^\d*\.?\d{0,6}$/.test(t)) return 0n;
  return parseUnits(t, 6);
}
