/**
 * The keeper. Two jobs, both necessary for the cutoff to be usable.
 *
 *   npx tsx scripts/keeper.ts                      # BTC/USD, refresh every 3s
 *   npx tsx scripts/keeper.ts BTC/USD,ETH/USD 3    # several feeds
 *
 * 1. REFRESH. Pyth on Monad is a pull oracle: nothing updates it unless someone pays to.
 *    Measured with no keeper running, the stored BTC price was ~7 hours old and AAPL ~137
 *    days. Without a refresher every stake fails the cutoff, so the keeper is not an
 *    optimisation, it is what makes the market open at all.
 *
 * 2. SETTLE. Settlement needs a price published within settleTolerance of the window
 *    close, so the keeper refreshes right after each boundary. It settles nothing itself
 *    beyond that: anyone can call settle, and the outcome is a comparison.
 *
 * WHY REFRESH AND STAKES MUST NOT SHARE A BLOCK. updatePriceFeeds writes Pyth's price
 * slot. A stake in the same block reads what that write produced, which is a
 * read-after-write conflict and re-executes on Monad — measured at 5 conflicts in
 * test/Concurrency.t.sol. A slower refresh cadence means fewer blocks contain a refresh
 * and so fewer stakes contend, but a staler price and therefore a wider margin. That
 * tension is the real cost of the mechanism and it is not hidden here.
 */
import { CONTRACTS, PythAbi, deployer, deployerWallet, pub, txUrl } from "./lib/chain.js";
import { FEEDS, fetchPriceUpdate, feedBySymbol, fmtPrice } from "../lib/pyth.js";
import { ACCEPT_MARGIN_S } from "../lib/chain/config.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refresh(feedIds: `0x${string}`[]) {
  const upd = await fetchPriceUpdate(feedIds);
  const fee = (await pub.readContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "getUpdateFee",
    args: [upd.updateData],
  })) as bigint;

  const w = deployerWallet();
  const hash = await w.writeContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "updatePriceFeeds",
    args: [upd.updateData],
    value: fee,
    account: deployer(),
    chain: null,
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return { hash, rc, parsed: upd.parsed };
}

async function main() {
  const symbols = (process.argv[2] ?? "BTC/USD").split(",").map((s) => s.trim());
  const everyMs = Number(process.argv[3] ?? 3) * 1000;
  const feeds = symbols.map(feedBySymbol);

  console.log(`keeper: refreshing ${feeds.map((f) => f.symbol).join(", ")} every ${everyMs}ms`);
  console.log(`Pyth ${CONTRACTS.pyth}`);
  console.log(`acceptMargin ${ACCEPT_MARGIN_S}s — a stake is only accepted while the price is younger than this`);
  console.log(`ctrl-c to stop\n`);

  let n = 0;
  let spentWei = 0n;
  const startBal = await pub.getBalance({ address: deployer().address });

  for (;;) {
    const t0 = Date.now();
    try {
      const { hash, rc, parsed } = await refresh(feeds.map((f) => f.id));
      n += 1;
      spentWei += rc.gasUsed * (rc.effectiveGasPrice ?? 0n);

      const blk = await pub.getBlock({ blockNumber: rc.blockNumber });
      const ages = parsed.map((p) => Number(blk.timestamp) - p.publishTime);
      const quotes = parsed
        .map((p, i) => `${feeds[i]?.symbol ?? p.id.slice(0, 10)} $${fmtPrice(p.price, p.expo)} (${ages[i]}s)`)
        .join("  ");

      const worst = Math.max(...ages);
      const flag = worst > ACCEPT_MARGIN_S ? " <- STALE: stakes would be refused" : "";
      console.log(`#${String(n).padStart(4)} ${quotes}${flag}  ${txUrl(hash)}`);
    } catch (e) {
      console.error(`#${n + 1} refresh failed: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
    }

    if (n > 0 && n % 20 === 0) {
      const bal = await pub.getBalance({ address: deployer().address });
      const used = startBal - bal;
      console.log(
        `  --- ${n} refreshes, ${(Number(used) / 1e18).toFixed(4)} MON spent ` +
          `(${(Number(used) / 1e18 / n).toFixed(5)} MON each). Integrity is a recurring gas bill.`
      );
    }

    const elapsed = Date.now() - t0;
    if (elapsed < everyMs) await sleep(everyMs - elapsed);
  }
}

main().catch((e) => {
  console.error(`FAILED: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
  process.exit(1);
});
