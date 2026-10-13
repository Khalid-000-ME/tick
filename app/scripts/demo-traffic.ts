/**
 * Puts real activity on Monad testnet so the app looks alive while the demo is recorded.
 *
 * Nothing here is faked: every stake, settlement, claim, join and message is a transaction signed by
 * a real key and written to the chain. What it is, honestly, is our own wallets playing the product
 * against itself on a test network. It makes the screens full; it is not user traction, and it must
 * never be described as such.
 *
 *   npx tsx scripts/demo-traffic.ts fund        # top the demo traders up from the operator
 *   npx tsx scripts/demo-traffic.ts social      # join them to a group and a room, post some chat
 *   npx tsx scripts/demo-traffic.ts trade 6     # play 6 windows, both sides, then settle and claim
 *
 * Needs the app running for /api/strike and /api/price/refresh.
 */
import { formatUnits, parseAbi } from "viem";
import { feedBySymbol } from "../lib/pyth.js";
import { CONTRACTS, TickAbi, monadTestnet, participant, sleep, pub, walletFor } from "./lib/chain.js";
import { requireEnv } from "./lib/env.js";
import { privateKeyToAccount } from "viem/accounts";

const APP = process.env.DEMO_APP ?? "http://localhost:3000";
const WINDOW_S = 30;
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;
const STAKE_GAS = 300_000n;

/** The traders in the demo. Deterministic, so the same addresses come back every run. */
const TRADERS = [21, 22, 23, 24].map((i) => participant(i));
/** Each gets this much USDC on the Tick deposit, and this much MON for gas. */
const TOP_UP_USDC = 3n * 10n ** 6n;
const TOP_UP_MON = 2n * 10n ** 17n; // 0.2 MON

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
]);
const social = parseAbi([
  "function joinGroup(uint64 id)",
  "function joinRoom(uint64 id)",
  "function postToGroup(uint64 id, string text)",
  "function postToRoom(uint64 id, string text)",
]);

const operator = (() => {
  const raw = requireEnv("OPERATOR_PK");
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return { account: privateKeyToAccount(pk), wallet: walletFor(pk) };
})();

const usdc = (n: bigint) => formatUnits(n, 6);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

async function send(label: string, p: Promise<`0x${string}`>) {
  const hash = await p;
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${r.status === "success" ? "ok  " : "FAIL"} ${label}  ${hash.slice(0, 12)}…`);
  return r;
}

/** Give every demo trader gas and a Tick deposit to stake from. */
async function fund() {
  console.log(`operator ${operator.account.address}`);
  for (const t of TRADERS) {
    const [mon, bal, dep] = await Promise.all([
      pub.getBalance({ address: t.account.address }),
      pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [t.account.address] }),
      pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [t.account.address] }) as Promise<bigint>,
    ]);
    console.log(`${t.account.address}  MON ${formatUnits(mon, 18)}  USDC ${usdc(bal)}  deposit ${usdc(dep)}`);

    if (mon < TOP_UP_MON / 2n) {
      await send("gas", operator.wallet.sendTransaction({ to: t.account.address, value: TOP_UP_MON }));
    }
    if (dep < TOP_UP_USDC) {
      if (bal < TOP_UP_USDC) {
        await send("usdc", operator.wallet.writeContract({ address: USDC, abi: erc20, functionName: "transfer", args: [t.account.address, TOP_UP_USDC] }));
      }
      const allowed = (await pub.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [t.account.address, CONTRACTS.tick] })) as bigint;
      if (allowed < TOP_UP_USDC) {
        await send("approve", t.wallet.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [CONTRACTS.tick, 2n ** 255n] }));
      }
      await send("deposit", t.wallet.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposit", args: [TOP_UP_USDC] }));
    }
  }
}

/** Put the traders in a group and a room, and leave some chat behind them. */
async function socialise(groupId: bigint, roomId: bigint) {
  const lines = [
    "in for the next one",
    "above, no question",
    "that window was brutal",
    "who is settling these",
    "up 3 on the day",
    "one more and I am out",
  ];
  for (const t of TRADERS) {
    try { await send(`join group  ${t.account.address.slice(0, 8)}`, t.wallet.writeContract({ address: CONTRACTS.tickSocial, abi: social, functionName: "joinGroup", args: [groupId] })); } catch { console.log("  already in the group"); }
    try { await send(`join room   ${t.account.address.slice(0, 8)}`, t.wallet.writeContract({ address: CONTRACTS.tickSocial, abi: social, functionName: "joinRoom", args: [roomId] })); } catch { console.log("  already in the room"); }
    await send("say", t.wallet.writeContract({ address: CONTRACTS.tickSocial, abi: social, functionName: "postToRoom", args: [roomId, pick(lines)] }));
  }
}

/** Play one window: several traders take sides, so the market is two-sided and pays out. */
async function playWindow(symbol: string) {
  const feed = feedBySymbol(symbol);
  while (Math.floor(Date.now() / 1000) % WINDOW_S > 3) await sleep(250);
  const closesAt = Math.floor(Date.now() / 1000 / WINDOW_S) * WINDOW_S + WINDOW_S;
  const strike = BigInt(((await (await fetch(`${APP}/api/strike?feedId=${feed.id}&closesAt=${closesAt}`)).json()) as { strike: string }).strike);
  const terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) };
  await fetch(`${APP}/api/price/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id }) });

  console.log(`${symbol} window closing at ${new Date(closesAt * 1000).toISOString().slice(11, 19)}`);
  // Both sides, always, so the window settles and pays instead of voiding for being one-sided.
  const sides = [true, false, Math.random() > 0.5, Math.random() > 0.5];
  await Promise.all(TRADERS.map(async (t, i) => {
    const amount = BigInt(1 + Math.floor(Math.random() * 3)) * 10n ** 5n * 5n; // 0.5 to 1.5 USDC
    try {
      await send(`stake ${sides[i] ? "ABOVE" : "BELOW"} ${usdc(amount)}`, t.wallet.writeContract({
        address: CONTRACTS.tick, abi: TickAbi, functionName: "stakeOn", args: [terms, sides[i], amount], gas: STAKE_GAS,
      }));
    } catch (e) { console.log(`  skip ${t.account.address.slice(0, 8)}: ${(e as Error).message.split("\n")[0].slice(0, 70)}`); }
  }));
  return { feed, terms, closesAt };
}

async function main() {
  const mode = process.argv[2] ?? "trade";
  if (mode === "fund") return fund();
  if (mode === "social") return socialise(BigInt(process.argv[3] ?? 1), BigInt(process.argv[4] ?? 2));

  const rounds = Number(process.argv[3] ?? 4);
  for (let i = 0; i < rounds; i++) {
    console.log(`\n— round ${i + 1} of ${rounds} —`);
    await playWindow(pick(["BTC/USD", "ETH/USD"]));
    // Let the window close and the app's own settler take it, which is the path the product uses.
    await sleep((WINDOW_S + 14) * 1000);
  }
  console.log("\ndone. Markets settle on their own; /settlers shows who collected the bounties.");
}

main().catch((e) => { console.error(e); process.exit(1); });
