/**
 * In-play micro markets, end to end.
 *
 * A micro market commits its window's OPENING SCORELINE inside its own id, so settling is
 * a comparison anyone can redo from the public scoreboard with nothing remembered in
 * between. This proves that: the id is rebuilt from the public descriptor, two wallets
 * take opposite sides, and the attestor's signature over the derived outcome settles it.
 *
 * A synthetic fixture stands in when no match is in play — the contract cannot tell the
 * difference, and the derivation is checked separately against the real route.
 */
import { createPublicClient, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Erc20Abi, TickSportsAbi } from "../lib/chain/abi.js";
import { CONTRACTS, monadTestnet } from "../lib/chain/config.js";
import { microDescriptor, microEventId, microOutcome, type MicroKey } from "../lib/sports.js";
import { deployer, deployerWallet, participant, sleep, txUrl } from "./lib/chain.js";
import { requireEnv } from "./lib/env.js";

const APP = "http://localhost:3101";
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });
const STAKE = 2n * 10n ** 6n;
const usd = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const checks: [string, boolean][] = [];

async function fund(addr: `0x${string}`) {
  const mon = await pub.getBalance({ address: addr });
  if (mon < 2n * 10n ** 17n) {
    const h = await deployerWallet().sendTransaction({ to: addr, value: 3n * 10n ** 17n, account: deployer(), chain: null });
    if ((await pub.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("MON top-up reverted");
  }
  const bal = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [addr] })) as bigint;
  if (bal < STAKE) {
    const h = await deployerWallet().writeContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "transfer", args: [addr, STAKE - bal], account: deployer(), chain: null, gas: 220_000n });
    if ((await pub.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("USDC funding reverted — is the deployer out?");
  }
  const allow = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [addr, CONTRACTS.tickSports] })) as bigint;
  return { allow };
}

async function main() {
  // --- the outcome rule, stated as a table so a reader can see it is a pure comparison
  const base: MicroKey = { espnId: "999", closesAt: 0, openHome: 1, openAway: 0 };
  const table: [number, number, number, string][] = [
    [2, 0, 1, "home scored -> HOME"],
    [1, 1, 2, "away scored -> AWAY"],
    [1, 0, 3, "nobody scored -> VOID, refunded"],
    [2, 1, 3, "both scored -> VOID, order unknowable from a scoreline"],
  ];
  for (const [h, a, want, label] of table) checks.push([label, microOutcome(base, h, a) === want]);

  const attestorPk = requireEnv("ATTESTOR_PK") as `0x${string}`;
  const attestorAcct = privateKeyToAccount(attestorPk.startsWith("0x") ? attestorPk : (`0x${attestorPk}` as `0x${string}`));

  // --- a window that opens now at 1-0 and closes in 40s; home then scores
  const closesAt = Math.floor(Date.now() / 1000) + 40;
  const key: MicroKey = { espnId: "e2e-micro", closesAt, openHome: 1, openAway: 0 };
  const eventId = microEventId(key);
  console.log(`descriptor ${microDescriptor(key)}\neventId    ${eventId}`);

  const terms = { eventId, closesAt: BigInt(closesAt) } as const;
  const id = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "marketId", args: [terms] })) as `0x${string}`;

  const a = participant(41);
  const b = participant(42);
  for (const p of [a, b]) {
    const { allow } = await fund(p.account.address);
    if (allow < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve", args: [CONTRACTS.tickSports, 2n ** 255n], account: p.account, chain: null, gas: 180_000n });
      await pub.waitForTransactionReceipt({ hash: h });
    }
    const dep = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [p.account.address] })) as bigint;
    if (dep < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposit", args: [STAKE - dep], account: p.account, chain: null, gas: 280_000n });
      if ((await pub.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("deposit reverted");
    }
  }

  for (const [p, home] of [[a, true], [b, false]] as const) {
    const h = await p.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "stakeOn", args: [terms, home, STAKE], account: p.account, chain: null, gas: 400_000n });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  ${home ? "HOME" : "AWAY"} staked ${rc.status}`);
    if (rc.status !== "success") throw new Error("stake reverted; the window would settle empty");
  }

  console.log("waiting for the window to close…");
  while (Math.floor(Date.now() / 1000) < closesAt) await sleep(1000);

  // Home scored during the window: 1-0 -> 2-0.
  const outcome = microOutcome(key, 2, 0);
  const digest = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "attestationDigest", args: [terms, outcome] })) as `0x${string}`;
  const signature = await attestorAcct.signMessage({ message: { raw: digest } });

  const sh = await a.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "settleAttested", args: [terms, outcome, signature], account: a.account, chain: null, gas: 1_800_000n });
  const rc = await pub.waitForTransactionReceipt({ hash: sh });
  console.log(`  settled outcome=${outcome} ${rc.status}  ${txUrl(sh)}`);
  checks.push(["the scoreline delta settled the window on chain", rc.status === "success"]);

  const owedWinner = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "previewClaim", args: [id, a.account.address] })) as bigint;
  const owedLoser = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "previewClaim", args: [id, b.account.address] })) as bigint;
  console.log(`  winner owed ${usd(owedWinner)}   loser owed ${usd(owedLoser)}`);
  checks.push(["the side that scored is owed more than it staked", owedWinner > STAKE]);
  checks.push(["the other side is owed nothing", owedLoser === 0n]);

  // --- the live route behaves when nothing is in play
  const r = await fetch(`${APP}/api/sports/micro`);
  const body = (await r.json()) as { markets?: unknown[]; live?: number };
  console.log(`\n/api/sports/micro: ${body.live} matches in play, ${body.markets?.length ?? 0} windows`);
  checks.push(["the in-play route answers cleanly with no match live", r.ok && Array.isArray(body.markets)]);

  console.log();
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((e) => {
  console.error((e as { shortMessage?: string }).shortMessage ?? e);
  process.exit(1);
});
