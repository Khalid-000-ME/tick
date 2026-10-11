"use client";

import { AmountPicker } from "@/components/AmountPicker";
import { NewsPanel } from "@/components/NewsPanel";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, SealCheck } from "@phosphor-icons/react";
import { AccountShell } from "@/components/AccountShell";
import { FixtureBanner } from "@/components/CardBanner";
import { MicroOrders } from "@/components/MicroMarkets";
import { OddsChart, type OddsPoint } from "@/components/OddsChart";
import { fixtureStatus, payout, until, type SportsEvent } from "@/components/SportsCard";
import { createPublicClient, http } from "viem";
import { TickSportsAbi } from "@/lib/chain/abi";
import { ATTESTOR, CONTRACTS, explorerAddress, monadTestnet, toUsd } from "@/lib/chain/config";
import { useSportsStake } from "@/lib/useSportsStake";
import { sportsStatus, useSportsPositions } from "@/lib/useSportsPositions";
import { StakeSheet } from "@/components/StakeSheet";
import { useSettings } from "@/lib/useSettings";
import { useTickWallet } from "@/lib/useTickWallet";

/**
 * One fixture: the match-result market, its odds over time, the in-play windows, and how
 * it was or will be settled.
 *
 * The board cards only point here. Everything that needs a decision or an explanation
 * lives on this page, said once.
 */
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

export function SportsMarketView({ espnId }: { espnId: string }) {
  const wallet = useTickWallet();
  const [event, setEvent] = useState<SportsEvent | null | undefined>(undefined);
  const [series, setSeries] = useState<OddsPoint[]>([]);
  const { settings, update: updateSettings } = useSettings();
  const [amount, setAmount] = useState(1);
  const amountTouched = useRef(false);
  useEffect(() => {
    if (!amountTouched.current) setAmount(settings.defaultAmount);
  }, [settings.defaultAmount]);
  const [pending, setPending] = useState<"HOME" | "AWAY" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [initialWindow, setInitialWindow] = useState<number | undefined>(undefined);
  const [owed, setOwed] = useState(0n);
  const [claiming, setClaiming] = useState(false);
  const stake = useSportsStake(wallet.walletClient, wallet.account);
  const sportsPositions = useSportsPositions(wallet.account, wallet.walletClient);
  // Bumped after a stake confirms, so the pool and odds reload at once instead of on the
  // next poll.
  const [refreshKey, setRefreshKey] = useState(0);

  // The board links here with the in-play window that was clicked.
  useEffect(() => {
    const w = Number(new URLSearchParams(window.location.search).get("window"));
    if (w > 0) setInitialWindow(w);
  }, []);

  useEffect(() => {
    let off = false;
    async function load() {
      try {
        const res = await fetch("/api/sports/events");
        const body = (await res.json()) as { events?: SportsEvent[] };
        const e = body.events?.find((x) => x.espnId === espnId) ?? null;
        if (off) return;
        setEvent(e);
        if (e) {
          const t = Math.floor(Date.now() / 1000);
          setSeries((prev) => (prev.length && prev[prev.length - 1].above === e.impliedHome ? prev : [...prev, { t, above: e.impliedHome }].slice(-200)));
        }
      } catch {
        if (!off) setEvent((prev) => prev ?? null);
      }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [espnId, refreshKey]);

  async function place(side: "HOME" | "AWAY") {
    if (!event) return;
    setPending(null);
    const team = side === "HOME" ? event.home.short : event.away.short;
    const res = await stake.submit({ eventId: event.eventId, closesAt: BigInt(event.kickoff) }, side === "HOME", amount, team);
    setNotice(res.message);
    if (res.ok) {
      sportsPositions.record({
        id: event.id, kind: "match", espnId: event.espnId, eventId: event.eventId, closesAt: event.kickoff,
        side, amount, label: team, fixture: `${event.away.abbr} @ ${event.home.abbr}`, league: event.league,
      });
    }
    void res.confirm?.then((d) => {
      setNotice(d.message);
      setRefreshKey((k) => k + 1);
    });
  }

  async function settle() {
    setSettling(true);
    try {
      const r = await fetch("/api/sports/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ espnId }) });
      const b = (await r.json()) as { ok?: boolean; error?: string; explorer?: string };
      setNotice(b.ok ? "Settled. Winnings are claimable from your portfolio." : b.error ?? "Could not settle yet.");
    } finally {
      setSettling(false);
    }
  }

  // What this wallet is owed once the market settles. The portfolio tracks price markets
  // only, so without this a sports winner would have no way to collect.
  useEffect(() => {
    if (!event || event.settledOutcome === 0 || !wallet.account) return;
    let off = false;
    void (pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "previewClaim", args: [event.id, wallet.account] }) as Promise<bigint>)
      .then((v) => { if (!off) setOwed(v); })
      .catch(() => {});
    return () => { off = true; };
  }, [event, wallet.account]);

  async function claim() {
    if (!event || !wallet.walletClient || !wallet.account) return;
    setClaiming(true);
    try {
      const hash = await wallet.walletClient.writeContract({
        address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "claim", args: [event.id],
        account: wallet.account, chain: monadTestnet, gas: 300_000n,
      });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status === "success") {
        setNotice(`${toUsd(owed).toFixed(2)} USDC added to your sports balance.`);
        setOwed(0n);
      } else setNotice("The claim reverted.");
    } catch (e) {
      setNotice(((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]);
    } finally {
      setClaiming(false);
    }
  }

  if (event === undefined) {
    return <AccountShell active="markets" wallet={wallet}><div className="page-empty">Loading the match...</div></AccountShell>;
  }
  if (event === null) {
    return (
      <AccountShell active="markets" wallet={wallet}>
        <div className="page-empty">This fixture is no longer on the scoreboard. <Link href="/markets">Back to markets</Link></div>
      </AccountShell>
    );
  }

  const status = fixtureStatus(event);
  const homeOdds = event.impliedHome;
  const sides = [
    { side: "HOME" as const, team: event.home, odds: homeOdds, mine: event.poolHome, theirs: event.poolAway, tone: "up" },
    { side: "AWAY" as const, team: event.away, odds: 100 - homeOdds, mine: event.poolAway, theirs: event.poolHome, tone: "down" },
  ];
  const settled = event.settledOutcome !== 0;
  const finishedUnsettled = !settled && event.completed;
  const pick = pending ? sides.find((s) => s.side === pending)! : null;

  return (
    <AccountShell active="markets" wallet={wallet}>
      <Link href="/markets" className="match-back"><ArrowLeft /> Markets</Link>

      <div className="match-hero has-banner">
        <FixtureBanner league={event.league} status={status.text} live={status.live} home={event.home} away={event.away} showScore={event.state !== "pre"} tall />
        <h1 className="match-title">{event.away.name} at {event.home.name}</h1>
      </div>

      <div className="match-grid">
        <div className="match-main">
          <section className="match-panel">
            <header className="match-panel-head">
              <h2>Winner</h2>
              <span className="match-meta">{event.open ? `closes at kickoff, in ${until(event.secondsToKickoff)}` : status.text}</span>
            </header>
            <div className="match-legend">
              <span className="tone-up"><i />{event.home.abbr} {homeOdds.toFixed(0)}%</span>
              <span className="tone-down"><i />{event.away.abbr} {(100 - homeOdds).toFixed(0)}%</span>
            </div>
            <OddsChart series={series} above={homeOdds} tall />
            <p className="match-meta">${event.volume.toFixed(2)} pool</p>
          </section>

          <section className="match-panel">
            <header className="match-panel-head"><h2>Result</h2></header>
            {settled ? (
              <>
                <p className="match-result">
                  <SealCheck weight="fill" />
                  {status.text}
                  {event.home.score !== null && <span> · {event.away.abbr} {event.away.score} : {event.home.score} {event.home.abbr}</span>}
                </p>
                {owed > 0n && (
                  <button type="button" className="btn-solid" disabled={claiming} onClick={() => void claim()}>
                    {claiming ? "Claiming..." : `Claim ${toUsd(owed).toFixed(2)} USDC`}
                  </button>
                )}
              </>
            ) : finishedUnsettled ? (
              <button type="button" className="btn-solid" disabled={settling} onClick={() => void settle()}>
                {settling ? "Settling..." : "Settle from the final score"}
              </button>
            ) : (
              <p className="match-meta">Settles from the final score once the match ends. A draw refunds both sides.</p>
            )}
            <p className="match-note">
              Attested by Tick&apos;s key from the public scoreboard, not by Pyth, in a separate contract.
              {" "}Key <a href={explorerAddress(ATTESTOR)} target="_blank" rel="noreferrer">{ATTESTOR.slice(0, 8)}...</a>.
            </p>
          </section>

          <NewsPanel
            topic="sports"
            variant="panel"
            title={`${event.league} news`}
            league={event.league}
            teams={[event.home.name, event.home.short, event.away.name, event.away.short]}
            limit={8}
          />
        </div>

        <aside className="match-side-col">
          <section className="match-panel">
            <header className="match-panel-head"><h2>Pick the winner</h2></header>
            <div className="match-sides">
              {sides.map((s) => (
                <button key={s.side} type="button" className={`match-side tone-${s.tone}`} disabled={!event.open || stake.busy} onClick={() => (settings.stakeMode === "tap" ? void place(s.side) : setPending(s.side))}>
                  <span>{s.team.short}</span>
                  <strong>{s.odds.toFixed(0)}%</strong>
                  <small>pays {payout(s.mine, s.theirs).toFixed(2)}x</small>
                </button>
              ))}
            </div>
            <AmountPicker value={amount} compact onChange={(n) => { amountTouched.current = true; setAmount(n); }} />
            {!event.open && <p className="match-note">Staking closed at kickoff.</p>}
            {sportsPositions.positions.filter((p) => p.espnId === espnId).length > 0 && (
              <ul className="match-mine">
                {sportsPositions.positions.filter((p) => p.espnId === espnId).map((p) => (
                  <li key={`${p.id}:${p.side}`}>
                    <span>{p.label}</span>
                    <span className="mono">{p.amount.toFixed(2)} USDC</span>
                    <span className={`match-mine-status is-${sportsStatus(p)}`}>{sportsStatus(p)}</span>
                  </li>
                ))}
              </ul>
            )}
            {stake.busy && <p className="match-note">{stake.step || "Working..."}</p>}
          </section>

          {event.state === "in" && (
            <MicroOrders
              espnId={espnId}
              initialWindow={initialWindow}
              walletClient={wallet.walletClient}
              account={wallet.account}
              onNotice={setNotice}
              onStaked={(m, home, amt) =>
                sportsPositions.record({
                  id: m.id, kind: "micro", espnId: m.espnId, eventId: m.eventId, closesAt: m.closesAt,
                  side: home ? "HOME" : "AWAY", amount: amt,
                  label: `${home ? m.home.abbr : m.away.abbr}, next ${m.windowLabel}`,
                  fixture: `${m.away.abbr} @ ${m.home.abbr}`, league: m.league,
                  micro: { openHome: m.openHome, openAway: m.openAway },
                })
              }
            />
          )}
        </aside>
      </div>

      {pick && settings.stakeMode !== "tap" && (
        <StakeSheet
          mode={settings.stakeMode}
          tone={pick.tone === "up" ? "up" : "down"}
          eyebrow={event.league}
          title={<>{amount} USDC on <em>{pick.team.short}</em></>}
          detail={`Pays about ${(amount * payout(pick.mine, pick.theirs)).toFixed(2)} USDC if they win. A draw refunds.`}
          confirmLabel="Stake"
          onCancel={() => setPending(null)}
          onConfirm={() => void place(pick.side)}
          onAlwaysTap={() => { updateSettings({ stakeMode: "tap" }); void place(pick.side); }}
        />
      )}

      {notice && (
        <div className="page-note board-note" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </AccountShell>
  );
}
