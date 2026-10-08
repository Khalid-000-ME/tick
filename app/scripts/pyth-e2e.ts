/**
 * End-to-end proof on Monad testnet, with real transactions throughout.
 *
 *   npx tsx scripts/pyth-e2e.ts            # BTC/USD (crypto, works any hour)
 *   npx tsx scripts/pyth-e2e.ts AAPL       # equity, US market hours only
 *
 * What it proves, in order:
 *   1. A signed Pyth update fetched from Hermes lands on chain.
 *   2. Stakes are accepted while that price is fresh.
 *   3. A stake is REFUSED once the price goes stale — the cutoff, on chain.
 *   4. Settlement reads Pyth and needs no reporter: a wallet with no role settles it.
 *   5. Winners claim; payouts never exceed the pools.
 *
 * It also measures inclusion latency, because the acceptance margin can never be
 * tighter than inclusion time. The margin is justified by these numbers or not at all.
 */
import { formatUnits } from "viem";
import {
  CONTRACTS,
  PythAbi,
  TickAbi,
  Terms,
  deployer,
  deployerWallet,
  ensureFunded,
  marketId,
  participant,
  pub,
  registerParticipantPk,
  sendTimed,
  sleep,
  txUrl,
} from "./lib/chain.js";
import {
  FEEDS,
  equityMarketLikelyOpen,
  fetchPriceUpdate,
  feedBySymbol,
  fmtPrice,
  snapToGrid,
  toDecimal,
  fetchUpdateForWindow,
} from "../lib/pyth.js";
import { ACCEPT_MARGIN_S, SETTLE_TOLERANCE_S, WINDOW_S } from "../lib/chain/config.js";

const usd = (v: bigint) => `${formatUnits(v, 6)} USDC`;

/** Fetch from Hermes and put it on chain. Returns the publishTime now stored. */
async function refreshPrice(feedId: `0x${string}`, label: string) {
  const upd = await fetchPriceUpdate([feedId]);
  const fee = (await pub.readContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "getUpdateFee",
    args: [upd.updateData],
  })) as bigint;

  const w = deployerWallet();
  const res = await sendTimed(label, () =>
    w.writeContract({
      address: CONTRACTS.pyth,
      abi: PythAbi,
      functionName: "updatePriceFeeds",
      args: [upd.updateData],
      value: fee,
      account: deployer(),
      chain: null,
    })
  );
  return { ...res, parsed: upd.parsed[0], host: upd.host, fee };
}

async function onChainPrice(feedId: `0x${string}`) {
  return (await pub.readContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "getPriceUnsafe",
    args: [feedId],
  })) as { price: bigint; conf: bigint; expo: number; publishTime: bigint };
}

/**
 * Simulates a stake and reports the decoded custom error. viem surfaces a bare
 * "reverted" from a write, which told me nothing when the first run failed; a simulation
 * names PriceTooStale / NotOpen / OffStrikeGrid and makes the cause obvious.
 */
async function preflight(
  label: string,
  from: `0x${string}`,
  terms: Terms,
  above: boolean,
  amount: bigint
) {
  try {
    await pub.simulateContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "stakeOn",
      args: [terms, above, amount],
      account: from,
    });
  } catch (e) {
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    const detail = (e as { cause?: { data?: { errorName?: string; args?: unknown[] } } }).cause?.data;
    const named = detail?.errorName
      ? `${detail.errorName}(${(detail.args ?? []).map(String).join(", ")})`
      : msg.split("\n")[0];
    throw new Error(`${label} would revert: ${named}`);
  }
}

async function main() {
  const symbol = process.argv[2] ?? "BTC/USD";
  const feed = feedBySymbol(symbol);

  console.log(`\nTick end-to-end — ${feed.symbol} (${feed.label})`);
  console.log(`Tick ${CONTRACTS.tick}`);
  console.log(`Pyth ${CONTRACTS.pyth}`);
  console.log(`acceptMargin ${ACCEPT_MARGIN_S}s · window ${WINDOW_S}s · settleTolerance ${SETTLE_TOLERANCE_S}s`);

  if (feed.kind === "equity" && !equityMarketLikelyOpen()) {
    console.log(
      `\nNOTE: the US market looks closed, so ${feed.symbol} will not be publishing fresh\n` +
        `prices and every stake will correctly fail the cutoff. That is the mechanism\n` +
        `working, not a failure. Run a crypto feed to see the full flow now.`
    );
  }

  // Confirm the on-chain grid matches what this script believes.
  const cfg = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "feeds",
    args: [feed.id],
  })) as readonly [boolean, bigint, number, number, number];
  const [enabled, strikeStep, windowSeconds] = cfg;
  if (!enabled) throw new Error(`${feed.symbol} is not listed on chain`);
  if (strikeStep !== feed.strikeStep) {
    throw new Error(`strike grid drift: chain ${strikeStep} vs registry ${feed.strikeStep}`);
  }
  console.log(`\nlisted on chain: strikeStep ${strikeStep} window ${windowSeconds}s — registry agrees`);

  // ---------------------------------------------------------------- 1. refresh
  console.log(`\n1. put a signed Pyth price on chain`);
  const first = await refreshPrice(feed.id, "updatePriceFeeds");
  console.log(`   hermes host ${first.host}, fee ${first.fee} wei`);
  console.log(`   ${feed.symbol} = $${fmtPrice(first.parsed.price, first.parsed.expo)} published ${first.parsed.publishTime}`);

  const live = await onChainPrice(feed.id);
  if (live.expo !== feed.expo) throw new Error(`expo drift: chain ${live.expo} vs registry ${feed.expo}`);

  // ---------------------------------------------------------------- participants
  const a = participant(1);
  const b = participant(2);
  registerParticipantPk(a.account.address, a.pk);
  registerParticipantPk(b.account.address, b.pk);

  console.log(`\n3. fund two independent wallets`);
  for (const p of [a, b]) {
    // 0.5 MON: settle costs ~1.2M gas and Monad charges the LIMIT, so 0.06 MON
    // was rejected outright by the RPC rather than reverting.
    await ensureFunded(p.account.address, 5n * 10n ** 17n, 12n * 10n ** 6n);
    const dep = (await pub.readContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "deposits",
      args: [p.account.address],
    })) as bigint;
    if (dep < 10n * 10n ** 6n) {
      await sendTimed(`deposit ${p.account.address.slice(0, 8)}`, () =>
        p.wallet.writeContract({
          address: CONTRACTS.tick,
          abi: TickAbi,
          functionName: "deposit",
          args: [10n * 10n ** 6n],
          account: p.account,
          chain: null,
        })
      );
    }
  }

  // ---------------------------------------------------------------- market
  // Strike on the grid, nudged one step below the current price so ABOVE is the likely
  // outcome but not a certainty. Close far enough ahead to leave room to stake.
  const snapped = snapToGrid(live.price, feed.strikeStep);  // on the grid
  const strike = snapped - feed.strikeStep;
  const now = Number((await pub.getBlock()).timestamp);
  let closesAt = (Math.floor(now / WINDOW_S) + 1) * WINDOW_S;
  // Two stakes at ~2s each plus a refresh needs well over half a window, and a
  // too-near boundary was what made the first run revert with NotOpen.
  while (closesAt - now < 22) closesAt += WINDOW_S;
  const terms: Terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) };
  const id = marketId(terms);

  console.log(`\n2. market: "${feed.symbol} >= $${fmtPrice(strike, feed.expo)} at close"`);
  console.log(`   id ${id}`);
  console.log(`   closes at ${closesAt} (${closesAt - now}s from now)`);

  // ---------------------------------------------------------------- 4. stake
  // The price must be fresh when the stake is INCLUDED, so refresh immediately before.
  console.log(`\n4. stake while the price is fresh (the cutoff is open)`);
  await refreshPrice(feed.id, "refresh before staking");

  await preflight("alice ABOVE", a.account.address, terms, true, 4n * 10n ** 6n);
  const stakeA = await sendTimed("alice stakes ABOVE 4 USDC", () =>
    a.wallet.writeContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "stakeOn",
      args: [terms, true, 4n * 10n ** 6n],
      account: a.account,
      chain: null,
    })
  );
  await preflight("bob BELOW", b.account.address, terms, false, 6n * 10n ** 6n);
  const stakeB = await sendTimed("bob stakes BELOW 6 USDC", () =>
    b.wallet.writeContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "stakeOn",
      args: [terms, false, 6n * 10n ** 6n],
      account: b.account,
      chain: null,
    })
  );

  const [above, below] = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "pools",
    args: [id],
  })) as readonly [bigint, bigint];
  console.log(`   pools: ABOVE ${usd(above)} / BELOW ${usd(below)}`);
  if (above === 0n || below === 0n) {
    console.log(`   WARNING: a one-sided pool will VOID and refund rather than pay out.`);
  }

  // ---------------------------------------------------------------- 5. the cutoff
  console.log(`\n5. THE CUTOFF: let the price go stale, then try to stake`);
  const status = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "cutoffStatus",
    args: [feed.id],
  })) as readonly [boolean, bigint, bigint, bigint];
  console.log(`   cutoffStatus before waiting: open=${status[0]} priceAge=${status[1]}s margin=${status[2]}s`);

  await sleep((ACCEPT_MARGIN_S + 3) * 1000);

  const after = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "cutoffStatus",
    args: [feed.id],
  })) as readonly [boolean, bigint, bigint, bigint];
  console.log(`   cutoffStatus after  waiting: open=${after[0]} priceAge=${after[1]}s margin=${after[2]}s`);

  let refusedReason = "";
  try {
    await pub.simulateContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "stakeOn",
      args: [terms, true, 1n * 10n ** 6n],
      account: a.account,
    });
    console.log(`   *** a stale-price stake was ACCEPTED — the cutoff is not working ***`);
  } catch (e) {
    refusedReason = ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0];
    console.log(`   refused, as it must be: ${refusedReason}`);
  }

  // ---------------------------------------------------------------- 6. settle
  console.log(`\n6. wait for close, then settle from Pyth`);
  for (;;) {
    const ts = Number((await pub.getBlock()).timestamp);
    if (ts >= closesAt) break;
    await sleep(Math.min(3000, (closesAt - ts) * 1000));
  }

  // The contract takes only the FIRST signed Pyth price at or after the close, fetched from
  // Hermes. Nothing needs posting to Pyth's own storage first.
  const { updateData, publishTime } = await fetchUpdateForWindow(feed.id, closesAt, SETTLE_TOLERANCE_S);
  console.log(`   settlement price published ${publishTime} (close ${closesAt}, tolerance ${SETTLE_TOLERANCE_S}s)`);

  // Anyone may settle. Use a participant wallet with no privileged role at all.
  const settled = await sendTimed("settle (by a wallet with no role)", () =>
    b.wallet.writeContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "settleWithUpdate",
      args: [terms, updateData],
      value: 10n,
      account: b.account,
      chain: null,
      gas: 1_800_000n,
    })
  );

  const s = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "settlements",
    args: [id],
  })) as readonly [number, bigint, bigint, number, bigint, bigint];
  const names = ["UNRESOLVED", "ABOVE", "BELOW", "VOID"];
  console.log(`   outcome ${names[s[0]]}  settlePrice $${fmtPrice(s[2], feed.expo)}`);
  console.log(`   totals: ABOVE ${usd(s[4])} / BELOW ${usd(s[5])}`);

  // ---------------------------------------------------------------- 7. claim
  console.log(`\n7. claim`);
  let paid = 0n;
  for (const [name, p] of [["alice", a], ["bob", b]] as const) {
    const preview = (await pub.readContract({
      address: CONTRACTS.tick,
      abi: TickAbi,
      functionName: "previewClaim",
      args: [id, p.account.address],
    })) as bigint;
    if (preview === 0n) {
      console.log(`  ${name.padEnd(34)} nothing to claim`);
      continue;
    }
    await sendTimed(`${name} claims ${usd(preview)}`, () =>
      p.wallet.writeContract({
        address: CONTRACTS.tick,
        abi: TickAbi,
        functionName: "claim",
        args: [id],
        account: p.account,
        chain: null,
      })
    );
    paid += preview;
  }

  const fees = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "feesAccrued",
    args: [deployer().address],
  })) as bigint;

  console.log(`\nledger`);
  console.log(`  staked         ${usd(above + below)}`);
  console.log(`  paid out       ${usd(paid)}`);
  console.log(`  fees accrued   ${usd(fees)}`);
  console.log(`  solvency       ${paid + fees <= above + below ? "ok — payouts + fees <= staked" : "*** VIOLATED ***"}`);

  const lat = [first.ms, stakeA.ms, stakeB.ms, settled.ms].sort((x, y) => x - y);
  console.log(`\ninclusion latency (ms): min ${lat[0]} median ${lat[Math.floor(lat.length / 2)]} max ${lat[lat.length - 1]}`);
  console.log(
    `The acceptance margin can never be tighter than inclusion time, so these numbers\n` +
      `are what ${ACCEPT_MARGIN_S}s has to be justified against.`
  );
  console.log(`\nmarket ${id}`);
  console.log(`settle tx ${txUrl(settled.hash)}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
  process.exit(1);
});
