/**
 * Runs the real handlers over the real events that are on Monad testnet, in memory, with no
 * database and no hosted service, so what it prints is what the deployed indexer will hold.
 *
 * The events are fetched from the node (narrow block ranges, which is all its RPC allows) and
 * fed to Envio's test indexer as simulated items. Replaying blocks straight from HyperSync
 * would need an Envio API token, which is not something a test should depend on.
 */
import fs from "node:fs";
import { createPublicClient, http, parseAbiItem } from "viem";
import { createTestIndexer } from "envio";

const RPC = "https://testnet-rpc.monad.xyz";
const pub = createPublicClient({ transport: http(RPC) });
const CHUNK = 95n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The node allows 25 requests a second to everyone at once, so a refusal is waited out, not fatal. */
async function patient<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 8 || !/limited|429|rate/i.test(String((e as Error).message))) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
}

const dep = JSON.parse(fs.readFileSync("../app/lib/chain/deployed.json", "utf8")) as { contracts: Record<string, string>; socialDeployBlock: number; feedDeployBlock: number };
const SOCIAL = dep.contracts.TickSocial as `0x${string}`;
const FEED = dep.contracts.TickFeed as `0x${string}`;
const PROFILES = dep.contracts.TickProfiles as `0x${string}`;

const events = {
  TickSocial: [
    "event GroupCreated(uint64 indexed id, address indexed creator, string name, string avatar)",
    "event GroupChanged(uint64 indexed id, string name, string avatar)",
    "event GroupJoined(uint64 indexed id, address indexed member)",
    "event RoomCreated(uint64 indexed id, uint64 indexed groupId, address indexed creator, string name)",
    "event RoomJoined(uint64 indexed id, address indexed member)",
    "event GroupPosted(uint64 indexed id, address indexed from, string text)",
    "event RoomPosted(uint64 indexed id, address indexed from, string text)",
  ],
  TickFeed: [
    "event Posted(uint64 indexed id, address indexed author, string caption, bool card, bytes image)",
    "event Liked(uint64 indexed id, address indexed by, bool on)",
  ],
} as const;

type Item = { contract: string; event: string; srcAddress: string; logIndex: number; block: { number: number; timestamp: number; hash: string }; transaction: { hash: string }; params: Record<string, unknown> };
const items: Item[] = [];
const stamps = new Map<bigint, number>();
const head = await patient(() => pub.getBlockNumber());
const end = Number(head) - 1;

async function collect(contract: "TickSocial" | "TickFeed", address: `0x${string}`, from: number) {
  const abiItems = events[contract].map((sig) => parseAbiItem(sig));
  for (let lo = BigInt(from); lo <= BigInt(end); lo += CHUNK + 1n) {
    const hi = lo + CHUNK > BigInt(end) ? BigInt(end) : lo + CHUNK;
    // One query per range for every event of the contract, then paced under the node's limit.
    const logs = await patient(() => pub.getLogs({ address, events: abiItems as never, fromBlock: lo, toBlock: hi }));
    for (const l of logs as unknown as { eventName: string; args: Record<string, unknown>; blockNumber: bigint; blockHash: string; logIndex: number; transactionHash: string }[]) {
      if (!stamps.has(l.blockNumber)) {
        stamps.set(l.blockNumber, Number((await patient(() => pub.getBlock({ blockNumber: l.blockNumber }))).timestamp));
        await sleep(60);
      }
      items.push({
        contract, event: l.eventName, srcAddress: address, logIndex: l.logIndex,
        block: { number: Number(l.blockNumber), timestamp: stamps.get(l.blockNumber)!, hash: l.blockHash },
        transaction: { hash: l.transactionHash },
        params: l.args,
      });
    }
    await sleep(120);
  }
}
await collect("TickSocial", SOCIAL, dep.socialDeployBlock);
await collect("TickFeed", FEED, dep.feedDeployBlock);

// Profiles: a log scan from their deploy block is thousands of calls, so the three wallets that
// have one are read directly and fed in as the ProfileSet event that created them.
const profAbi = JSON.parse(fs.readFileSync("abis/TickProfiles.json", "utf8"));
let slot = 0;
for (const user of ["0x1111d87736c9C90Bb9eAE83297BE83ae990699cE", "0xc15394cdcb3bc24999d21480f014a227384ac17e", "0x73197a601361c73647b829978d6024b6ec5375da"] as const) {
  const [username, displayName, avatar] = (await patient(() => pub.readContract({ address: PROFILES, abi: profAbi, functionName: "profileOf", args: [user] }))) as readonly [string, string, string];
  if (username) items.push({ contract: "TickProfiles", event: "ProfileSet", srcAddress: PROFILES, logIndex: slot++, block: { number: dep.socialDeployBlock - 1, timestamp: 1, hash: "0x00" }, transaction: { hash: "0x00" }, params: { user, username, displayName, avatar } });
}
items.sort((a, b) => a.block.number - b.block.number || a.logIndex - b.logIndex);
console.log(`replaying ${items.length} real events up to block ${end}`);

const indexer = createTestIndexer();
const first = items[0].block.number;
await indexer.process({ chains: { 10143: { startBlock: first, endBlock: end, simulate: items as never } } });

const j = (rows: unknown[]) => JSON.stringify(rows.slice(0, 4), (_k, v) => (typeof v === "bigint" ? v.toString() : typeof v === "string" && v.length > 80 ? `${v.slice(0, 30)}…[${v.length} chars]` : v), 1);
for (const name of ["Profile", "Group", "GroupMember", "Room", "RoomMember", "Message", "Post", "Like"] as const) {
  const rows = await (indexer as unknown as Record<string, { getAll: () => Promise<unknown[]> }>)[name].getAll();
  console.log(`\n${name} (${rows.length})`, rows.length ? j(rows) : "");
}
