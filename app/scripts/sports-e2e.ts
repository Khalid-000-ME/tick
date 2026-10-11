/**
 * The attested sports path, end to end on Monad testnet.
 *
 * Two halves, because a finished fixture cannot be staked — its kickoff has passed:
 *   1. CONTRACT. Two wallets take opposite sides of a market closing in a minute. After
 *      kickoff a stranger submits the attestor's signature, the winner is paid and the
 *      loser gets nothing. Proves settleAttested, the bounty and the payouts on chain.
 *   2. ATTESTATION. A real completed ESPN fixture goes through /api/sports/attest, and the
 *      signature it returns is checked against the digest the deployed contract computes.
 *      Proves the referee signs the public result and nothing else.
 */
import { createPublicClient, encodeAbiParameters, formatUnits, http, keccak256, parseAbiParameters, recoverMessageAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TickSportsAbi, Erc20Abi } from "../lib/chain/abi.js";
import { CONTRACTS, monadTestnet } from "../lib/chain/config.js";
import { deployer, deployerWallet, participant, sleep, txUrl } from "./lib/chain.js";
import { requireEnv } from "./lib/env.js";

const APP = "http://localhost:3101";
const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });
const STAKE = 2n * 10n ** 6n;
const usd = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const checks: [string, boolean][] = [];

async function ensure(addr: `0x${string}`) {
  const mon = await pub.getBalance({ address: addr });
  if (mon < 2n * 10n ** 17n) {
    const h = await deployerWallet().sendTransaction({ to: addr, value: 3n * 10n ** 17n, account: deployer(), chain: null });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const bal = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [addr] })) as bigint;
  if (bal < STAKE) {
    const h = await deployerWallet().writeContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "transfer", args: [addr, STAKE - bal], account: deployer(), chain: null, gas: 220_000n });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    if (rc.status !== "success") throw new Error(`funding ${addr} with USDC reverted — is the deployer out? ${txUrl(h)}`);
  }
}

async function main() {
  const attestorPk = requireEnv("ATTESTOR_PK") as `0x${string}`;
  const attestorAcct = privateKeyToAccount(attestorPk.startsWith("0x") ? attestorPk : (`0x${attestorPk}` as `0x${string}`));
  const onChainAttestor = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "attestor" })) as string;
  console.log(`sports contract ${CONTRACTS.tickSports}\nattestor        ${onChainAttestor}`);
  checks.push(["the deployed attestor is the key this server holds", onChainAttestor.toLowerCase() === attestorAcct.address.toLowerCase()]);

  // ---- 1. contract path
  const a = participant(31);
  const b = participant(32);
  const settler = participant(33);
  for (const p of [a, b]) await ensure(p.account.address);
  await ensure(settler.account.address);

  for (const p of [a, b]) {
    const allow = (await pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [p.account.address, CONTRACTS.tickSports] })) as bigint;
    if (allow < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve", args: [CONTRACTS.tickSports, 2n ** 255n], account: p.account, chain: null, gas: 180_000n });
      await pub.waitForTransactionReceipt({ hash: h });
    }
    const dep = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [p.account.address] })) as bigint;
    if (dep < STAKE) {
      const h = await p.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposit", args: [STAKE - dep], account: p.account, chain: null, gas: 280_000n });
      const rc = await pub.waitForTransactionReceipt({ hash: h });
      if (rc.status !== "success") throw new Error(`deposit reverted ${txUrl(h)}`);
    }
  }

  const kickoff = Math.floor(Date.now() / 1000) + 45;
  const terms = { eventId: keccak256(toHex(`espn:e2e-${kickoff}`)), closesAt: BigInt(kickoff) } as const;
  const id = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "marketId", args: [terms] })) as `0x${string}`;
  console.log(`\nmarket ${id.slice(0, 12)}…  kickoff in 45s`);

  for (const [p, home] of [[a, true], [b, false]] as const) {
    const h = await p.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "stakeOn", args: [terms, home, STAKE], account: p.account, chain: null, gas: 400_000n });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`  staked ${home ? "HOME" : "AWAY"} ${rc.status}  ${txUrl(h)}`);
    if (rc.status !== "success") throw new Error("stake reverted; the market would settle empty and prove nothing");
  }

  console.log("waiting for kickoff…");
  while (Math.floor(Date.now() / 1000) < kickoff) await sleep(1000);

  // The attestor signs the digest the contract itself computes.
  const digest = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "attestationDigest", args: [terms, 1] })) as `0x${string}`;
  const signature = await attestorAcct.signMessage({ message: { raw: digest } });

  const before = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [settler.account.address] })) as bigint;
  const sh = await settler.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "settleAttested", args: [terms, 1, signature], account: settler.account, chain: null, gas: 1_800_000n });
  const src = await pub.waitForTransactionReceipt({ hash: sh });
  const after = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [settler.account.address] })) as bigint;
  console.log(`  settled by a stranger ${src.status}  bounty ${usd(after - before)}  ${txUrl(sh)}`);
  checks.push(["a stranger settled it with the attestor's signature", src.status === "success"]);

  const ch = await a.wallet.writeContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "claim", args: [id], account: a.account, chain: null, gas: 300_000n });
  await pub.waitForTransactionReceipt({ hash: ch });
  const winner = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "deposits", args: [a.account.address] })) as bigint;
  const loserPreview = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "previewClaim", args: [id, b.account.address] })) as bigint;
  console.log(`  winner balance ${usd(winner)}   loser owed ${usd(loserPreview)}`);
  checks.push(["the winning side was paid more than it staked", winner > STAKE]);
  checks.push(["the losing side is owed nothing", loserPreview === 0n]);

  // ---- 2. the referee only signs a finished, public result
  const evRes = await fetch(`${APP}/api/sports/events`);
  const { events } = (await evRes.json()) as { events: { espnId: string; completed: boolean; name: string; outcome: number | null; kickoff: number; eventId: `0x${string}` }[] };
  const done = events.find((e) => e.completed && e.outcome !== null);
  const upcoming = events.find((e) => !e.completed);
  console.log(`\nscoreboard: ${events.length} fixtures, ${events.filter((e) => e.completed).length} finished`);

  if (done) {
    const r = await fetch(`${APP}/api/sports/attest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ espnId: done.espnId }) });
    const att = (await r.json()) as { signature: `0x${string}`; outcome: number; marketId: `0x${string}`; evidence?: { score: string } };
    console.log(`  ${done.name} -> outcome ${att.outcome} (${att.evidence?.score})`);

    const expected = keccak256(encodeAbiParameters(parseAbiParameters("uint256, address, bytes32, uint8"), [BigInt(monadTestnet.id), CONTRACTS.tickSports, att.marketId, att.outcome]));
    const onChainDigest = (await pub.readContract({ address: CONTRACTS.tickSports, abi: TickSportsAbi, functionName: "attestationDigest", args: [{ eventId: done.eventId, closesAt: BigInt(done.kickoff) }, att.outcome] })) as string;
    const signer = await recoverMessageAddress({ message: { raw: expected }, signature: att.signature });
    checks.push(["the route's digest is the one the contract computes", onChainDigest.toLowerCase() === expected.toLowerCase()]);
    checks.push(["its signature recovers to the deployed attestor", signer.toLowerCase() === onChainAttestor.toLowerCase()]);
  }

  if (upcoming) {
    const r = await fetch(`${APP}/api/sports/attest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ espnId: upcoming.espnId }) });
    checks.push(["it refuses to sign a fixture that has not finished", r.status === 409]);
  }

  console.log();
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((e) => {
  console.error((e as { shortMessage?: string }).shortMessage ?? e);
  process.exit(1);
});
