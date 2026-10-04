/**
 * An OUTSIDE settler bot. Anything it does, anyone can do — it uses no privileged key and
 * no part of the app's server, only the public chain and Hermes.
 *
 *   SETTLER_PK=0x... npx tsx scripts/settler.ts        # loop
 *   SETTLER_PK=0x... npx tsx scripts/settler.ts once   # one pass
 *
 * WHY IT EXISTS. settle() is permissionless but costs ~1.2M gas, so it only happens if
 * someone is paid to do it. Tick pays whoever settles a market half of that market's fee
 * (capped), credited to their Tick balance. This is the thing that proves the claim:
 * run it with a fresh funded key and it settles markets and earns the bounty, with the
 * app's own server switched off.
 *
 * HOW IT FINDS WORK. The chain stores only a market's hash, so the Staked event carries
 * the full terms (feed, strike, close). The bot reads recent Staked events, drops markets
 * that are settled or not yet closed, fetches Hermes' signed update for the close, and
 * calls settleWithUpdate. It simulates first, because a reverted transaction still costs
 * the whole gas limit on Monad.
 *
 * It only settles markets worth settling: if the bounty will not cover roughly what the
 * gas costs it, it says so and skips — the economics are visible, not assumed.
 */
import { decodeEventLog, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, TickAbi, pub, sleep, txUrl, walletFor } from "./lib/chain.js";
import { SETTLE_TOLERANCE_S, SETTLE_WINDOW_S } from "../lib/chain/config.js";
import { fetchUpdateForWindow } from "../lib/pyth.js";
import { marketId } from "../lib/chain/market.js";
import { loadEnv } from "./lib/env.js";

loadEnv();

const key = (process.env.SETTLER_PK ?? process.env.DEPLOYER_PK) as `0x${string}` | undefined;
if (!key) throw new Error("Set SETTLER_PK (any funded key) — the bot needs MON for gas.");
if (!process.env.SETTLER_PK) console.warn("SETTLER_PK not set; falling back to DEPLOYER_PK. Fine for testnet, not a habit.");

const account = privateKeyToAccount(key);
const wallet = walletFor(key);
const LOOKBACK_BLOCKS = 1500n; // ~10 min at Monad's block time, matching settleWindow
const CHUNK = 100n;

interface Market {
  id: `0x${string}`;
  terms: { feedId: `0x${string}`; strike: bigint; expo: number; closesAt: bigint };
}

async function discover(): Promise<Market[]> {
  const head = await pub.getBlockNumber();
  const found = new Map<string, Market>();
  for (let from = head - LOOKBACK_BLOCKS; from <= head; from += CHUNK) {
    const logs = await pub
      .getLogs({
        address: CONTRACTS.tick,
        fromBlock: from < 0n ? 0n : from,
        toBlock: from + CHUNK - 1n > head ? head : from + CHUNK - 1n,
      })
      .catch(() => []);
    for (const log of logs) {
      try {
        const ev = decodeEventLog({ abi: TickAbi, data: log.data, topics: log.topics });
        if (ev.eventName !== "Staked") continue;
        const a = ev.args as unknown as { marketId: `0x${string}`; feedId: `0x${string}`; strike: bigint; closesAt: bigint };
        // expo is not in the event: the feed's exponent is fixed per feed, read from the id.
        found.set(a.marketId, { id: a.marketId, terms: { feedId: a.feedId, strike: a.strike, expo: 0, closesAt: a.closesAt } });
      } catch {
        /* not a Staked log */
      }
    }
  }
  return [...found.values()];
}

async function expoOf(feedId: `0x${string}`): Promise<number> {
  const p = (await pub.readContract({
    address: CONTRACTS.pyth,
    abi: [{ type: "function", name: "getPriceUnsafe", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ type: "tuple", components: [{ name: "price", type: "int64" }, { name: "conf", type: "uint64" }, { name: "expo", type: "int32" }, { name: "publishTime", type: "uint256" }] }] }] as const,
    functionName: "getPriceUnsafe",
    args: [feedId],
  })) as { expo: number };
  return p.expo;
}

async function pass() {
  const now = Math.floor(Date.now() / 1000);
  const markets = await discover();
  let settled = 0;

  for (const m of markets) {
    const closesAt = Number(m.terms.closesAt);
    if (now < closesAt || now > closesAt + SETTLE_WINDOW_S) continue;

    m.terms.expo = await expoOf(m.terms.feedId);
    const id = marketId(m.terms);
    if (id !== m.id) continue; // would only differ if the exponent changed; skip rather than guess

    const s = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settlements", args: [id] })) as readonly [number, ...unknown[]];
    if (s[0] !== 0) continue;

    try {
      const { updateData } = await fetchUpdateForWindow(m.terms.feedId, closesAt, SETTLE_TOLERANCE_S);
      const { request } = await pub.simulateContract({
        address: CONTRACTS.tick,
        abi: TickAbi,
        functionName: "settleWithUpdate",
        args: [m.terms, updateData],
        value: 10n,
        account,
      });

      const before = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] })) as bigint;
      const hash = await wallet.writeContract(request);
      const rc = await pub.waitForTransactionReceipt({ hash });
      const after = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] })) as bigint;

      console.log(`settled ${id.slice(0, 10)}… ${rc.status}  bounty +${formatUnits(after - before, 6)} tUSD  gas ${rc.gasUsed}  ${txUrl(hash)}`);
      settled++;
    } catch (e) {
      console.log(`skip ${id.slice(0, 10)}…  ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]}`);
    }
  }
  return { seen: markets.length, settled };
}

async function main() {
  console.log(`settler ${account.address}  tick ${CONTRACTS.tick}`);
  const once = process.argv[2] === "once";
  do {
    const r = await pass();
    console.log(`pass: ${r.seen} market(s) seen, ${r.settled} settled`);
    if (once) break;
    await sleep(15_000);
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
