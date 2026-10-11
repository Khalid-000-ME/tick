/**
 * Tick MCP server: lets Claude Code trade Tick from a conversation.
 *
 *   read:  tick_markets, tick_wallet, tick_positions
 *   write: tick_stake, tick_settle, tick_collect, tick_withdraw
 *
 * Every write is a real transaction on Monad testnet signed by ONE dedicated demo wallet
 * (TICK_MCP_PK in app/.env.local). That key is testnet-only, never printed, never returned
 * in a tool result. Nothing here is simulated: prices come from Pyth, outcomes from the
 * contract, history from the Envio index.
 *
 * stdout carries the MCP protocol, so this file must never console.log.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, Erc20Abi, PythAbi, TickAbi, marketId, monadTestnet, pub, sleep, txUrl, type Terms } from "../scripts/lib/chain.js";
import { FEEDS, feedBySymbol, fetchPriceUpdate, fetchUpdateForWindow, snapToGrid, type FeedSpec } from "../lib/pyth.js";
import { OUTCOME, SETTLE_TOLERANCE_S, SETTLE_WINDOW_S, WINDOW_S, toUsd } from "../lib/chain/config.js";
import { gasShortfall } from "../lib/gasCheck.js";

const MAX_STAKE = Number(process.env.TICK_MCP_MAX_STAKE ?? 3);
const GAS = { approve: 180_000n, deposit: 280_000n, stake: 300_000n, claim: 200_000n, withdraw: 220_000n, settle: 1_800_000n, post: (n: number) => 170_000n + 35_000n * BigInt(n) };

// ------------------------------------------------------------------ wallet

function signer() {
  const pk = process.env.TICK_MCP_PK;
  if (!pk) {
    throw new Error("TICK_MCP_PK is not set. Add a testnet-only key to app/.env.local (never with a NEXT_PUBLIC_ prefix).");
  }
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  return { account, client: createWalletClient({ account, chain: monadTestnet, transport: http() }) };
}

const usd = (raw: bigint) => `${toUsd(raw).toFixed(2)} USDC`;
const px = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nowSec = () => Math.floor(Date.now() / 1000);

// ------------------------------------------------------------------ market data

const strikeCache = new Map<string, bigint>();

/** Pyth's price at the instant the window opened: the same strike /api/strike serves the app. */
async function openStrike(feed: FeedSpec, closesAt: number): Promise<bigint> {
  const key = `${feed.id}:${closesAt}`;
  const hit = strikeCache.get(key);
  if (hit !== undefined) return hit;
  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) throw new Error("PYTH_API_KEY is not set (app/.env.local or contracts/.env).");
  for (const host of ["https://hermes.pyth.network", "https://pyth.dourolabs.app/hermes"]) {
    try {
      const res = await fetch(`${host}/v2/updates/price/${closesAt - WINDOW_S}?ids[]=${feed.id}&parsed=true&encoding=hex`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { parsed?: { price: { price: string; expo: number } }[] };
      const p = body.parsed?.[0]?.price;
      if (!p || p.expo !== feed.expo) continue;
      const strike = snapToGrid(BigInt(p.price), feed.strikeStep);
      strikeCache.set(key, strike);
      return strike;
    } catch {
      /* next host */
    }
  }
  throw new Error(`Window-open price for ${feed.symbol} is unavailable right now.`);
}

function window() {
  const closesAt = (Math.floor(nowSec() / WINDOW_S) + 1) * WINDOW_S;
  return { closesAt, left: closesAt - nowSec() };
}

async function cutoff(feed: FeedSpec) {
  const [ok, age, margin, price] = (await pub.readContract({
    address: CONTRACTS.tick,
    abi: TickAbi,
    functionName: "cutoffStatus",
    args: [feed.id],
  })) as readonly [boolean, bigint, bigint, bigint];
  return { ok, age: Number(age), margin: Number(margin), price };
}

/** Posts a signed Pyth price on chain, paid by the demo wallet, only if Hermes has something newer. */
async function postPrice(feed: FeedSpec) {
  const { account, client } = signer();
  const update = await fetchPriceUpdate([feed.id]);
  const stored = (await pub.readContract({ address: CONTRACTS.pyth, abi: PythAbi, functionName: "getPriceUnsafe", args: [feed.id] })) as { publishTime: bigint };
  if (!update.parsed.some((p) => BigInt(p.publishTime) > stored.publishTime)) return null;
  const fee = (await pub.readContract({ address: CONTRACTS.pyth, abi: PythAbi, functionName: "getUpdateFee", args: [update.updateData] })) as bigint;
  const hash = await client.writeContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "updatePriceFeeds",
    args: [update.updateData],
    value: fee,
    gas: GAS.post(1),
    account,
    chain: monadTestnet,
  });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

// ------------------------------------------------------------------ positions

interface Pos {
  id: `0x${string}`;
  feedId: `0x${string}`;
  symbol: string;
  strike: bigint;
  expo: number;
  closesAt: number;
  side: "ABOVE" | "BELOW";
  amount: bigint;
  stakedAt: number;
  hash?: string;
}

/** Stakes placed in this session, so tools work even if the indexer is not configured. */
const session = new Map<string, Pos>();

const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL;
const QUERY = `query($user:String!){Stake(where:{user:{_eq:$user}},order_by:{stakedAt:desc},limit:200){id above amount stakedAt txHash market{id feedId strike closesAt}}}`;

async function loadPositions(address: string): Promise<Pos[]> {
  const merged = new Map<string, Pos>(session);
  if (INDEXER) {
    try {
      const res = await fetch(INDEXER, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { user: address.toLowerCase() } }),
      });
      const json = (await res.json()) as {
        data?: { Stake: { above: boolean; amount: string; stakedAt: number; txHash: string; market: { id: string; feedId: string; strike: string; closesAt: number } }[] };
      };
      for (const r of json.data?.Stake ?? []) {
        const feed = FEEDS.find((f) => f.id.toLowerCase() === r.market.feedId.toLowerCase());
        if (!feed) continue;
        const side = r.above ? "ABOVE" : "BELOW";
        const key = `${r.market.id}-${side}`;
        const prev = merged.get(key);
        if (prev && prev.hash === r.txHash) continue;
        if (prev) {
          // Same market and side staked more than once: one position, amounts summed.
          if (!session.has(key)) prev.amount += BigInt(r.amount);
          continue;
        }
        merged.set(key, {
          id: r.market.id as `0x${string}`,
          feedId: r.market.feedId as `0x${string}`,
          symbol: feed.symbol,
          strike: BigInt(r.market.strike),
          expo: feed.expo,
          closesAt: r.market.closesAt,
          side,
          amount: BigInt(r.amount),
          stakedAt: r.stakedAt,
          hash: r.txHash,
        });
      }
    } catch {
      /* indexer down: session stakes only */
    }
  }
  return [...merged.values()].sort((a, b) => b.stakedAt - a.stakedAt);
}

async function settlementOf(id: `0x${string}`) {
  const s = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settlements", args: [id] })) as readonly [number, bigint, bigint, number, bigint, bigint];
  return { outcome: s[0], settlePrice: s[2] };
}

async function claimable(id: `0x${string}`, user: `0x${string}`) {
  return (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "previewClaim", args: [id, user] })) as bigint;
}

// ------------------------------------------------------------------ helpers

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): Out => ({ content: [{ type: "text", text }] });

async function guard(fn: () => Promise<string>): Promise<Out> {
  try {
    return ok(await fn());
  } catch (e) {
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e);
    return { content: [{ type: "text", text: msg.split("\n")[0] }], isError: true };
  }
}

const symbolSchema = z.string().describe(`Market symbol: ${FEEDS.map((f) => f.symbol).join(", ")}`);

// ------------------------------------------------------------------ server

const server = new McpServer({ name: "tick", version: "0.1.0" });

server.registerTool(
  "tick_markets",
  {
    title: "Live Tick markets",
    description:
      "Lists every Tick market with the live Pyth price, the current 30-second window (strike, seconds left), the staked pools on each side and whether the on-chain price is fresh enough to accept stakes.",
    inputSchema: {},
  },
  async () =>
    guard(async () => {
      const live = await fetchPriceUpdate(FEEDS.map((f) => f.id));
      const { closesAt, left } = window();
      const lines = await Promise.all(
        FEEDS.map(async (feed) => {
          const p = live.parsed.find((x) => x.id.toLowerCase() === feed.id.toLowerCase());
          const price = p ? Number(p.price) * 10 ** feed.expo : null;
          const strike = await openStrike(feed, closesAt).catch(() => null);
          const c = await cutoff(feed);
          let pools = "no stakes";
          if (strike !== null) {
            const id = marketId({ feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(closesAt) });
            const [a, b] = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "pools", args: [id] })) as readonly [bigint, bigint];
            if (a + b > 0n) pools = `ABOVE ${usd(a)} | BELOW ${usd(b)}`;
          }
          return (
            `${feed.symbol.padEnd(8)} live $${price === null ? "n/a" : px(price)}  strike $${strike === null ? "n/a" : px(Number(strike) * 10 ** feed.expo)}  ` +
            `pools: ${pools}  on-chain price ${c.age}s old (${c.ok ? "accepting stakes" : "stale, will be refreshed on stake"})`
          );
        })
      );
      return `Window closes in ${left}s (at ${new Date(closesAt * 1000).toISOString().slice(11, 19)} UTC)\n${lines.join("\n")}`;
    })
);

server.registerTool(
  "tick_wallet",
  {
    title: "Demo wallet",
    description: "Shows the demo wallet's address and its MON (gas), USDC and Tick (stakeable) balances.",
    inputSchema: {},
  },
  async () =>
    guard(async () => {
      const { account } = signer();
      const [mon, bal, dep] = await Promise.all([
        pub.getBalance({ address: account.address }),
        pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
        pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] }) as Promise<bigint>,
      ]);
      return (
        `Address: ${account.address}\nGas: ${Number(formatEther(mon)).toFixed(3)} MON\n` +
        `USDC in wallet: ${usd(bal)}\nIn Tick (stakeable): ${usd(dep)}\n` +
        `Fund USDC at https://faucet.circle.com (Monad Testnet) and MON at https://faucet.monad.xyz.`
      );
    })
);

server.registerTool(
  "tick_stake",
  {
    title: "Stake on a market",
    description:
      `Stakes USDC that a market's price will finish ABOVE or BELOW its strike when the current 30-second window closes. ` +
      `Does any one-time setup (approve, deposit), refreshes the on-chain Pyth price if it is too old, then sends the stake. ` +
      `Capped at ${MAX_STAKE} USDC per call. This sends real testnet transactions.`,
    inputSchema: {
      symbol: symbolSchema,
      side: z.enum(["ABOVE", "BELOW"]),
      amount: z.number().positive().describe("USDC to stake"),
    },
  },
  async ({ symbol, side, amount }) =>
    guard(async () => {
      if (amount > MAX_STAKE) throw new Error(`Refusing ${amount} USDC: this server caps a single stake at ${MAX_STAKE} (TICK_MCP_MAX_STAKE).`);
      const feed = feedBySymbol(symbol);
      const { account, client } = signer();
      const units = BigInt(Math.round(amount * 1e6));
      const notes: string[] = [];

      const [bal, dep, allowance] = await Promise.all([
        pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
        pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] }) as Promise<bigint>,
        pub.readContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "allowance", args: [account.address, CONTRACTS.tick] }) as Promise<bigint>,
      ]);

      const planned: bigint[] = [GAS.stake, GAS.post(1)];
      if (dep < units) planned.push(GAS.deposit, ...(allowance < bal ? [GAS.approve] : []));
      const short = await gasShortfall(pub, account.address, planned);
      if (short) throw new Error(short);

      if (dep < units) {
        if (bal < units - dep) throw new Error(`Not enough USDC: ${usd(bal)} in wallet and ${usd(dep)} in Tick, need ${amount}. Get USDC at https://faucet.circle.com.`);
        if (allowance < bal) {
          const h = await client.writeContract({ address: CONTRACTS.usdc, abi: Erc20Abi, functionName: "approve", args: [CONTRACTS.tick, 2n ** 255n], gas: GAS.approve, account, chain: monadTestnet });
          await pub.waitForTransactionReceipt({ hash: h });
          notes.push("approved USDC (one time)");
        }
        const h = await client.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposit", args: [bal], gas: GAS.deposit, account, chain: monadTestnet });
        await pub.waitForTransactionReceipt({ hash: h });
        notes.push(`moved ${usd(bal)} into Tick`);
      }

      // Strike lookup, a possible price post and the stake itself take several seconds, so a
      // window with less than 10s left would close mid-flight: take the next one.
      let w = window();
      if (w.left < 10) {
        notes.push(`waited ${w.left + 1}s for the next window`);
        await sleep((w.left + 1) * 1000);
        w = window();
      }

      const strike = await openStrike(feed, w.closesAt);
      const terms: Terms = { feedId: feed.id, strike, expo: feed.expo, closesAt: BigInt(w.closesAt) };
      const id = marketId(terms);

      const c = await cutoff(feed);
      if (!c.ok || c.age >= 7) {
        const posted = await postPrice(feed);
        notes.push(posted ? `refreshed the on-chain price (was ${c.age}s old)` : "on-chain price already as new as Pyth's");
      }

      const hash = await client.writeContract({
        address: CONTRACTS.tick,
        abi: TickAbi,
        functionName: "stakeOn",
        args: [terms, side === "ABOVE", units],
        gas: GAS.stake,
        account,
        chain: monadTestnet,
      });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") {
        const why = await pub
          .simulateContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "stakeOn", args: [terms, side === "ABOVE", units], account: account.address })
          .then(() => "it may have been refused because the price went stale or the window closed")
          .catch((e) => (e as { shortMessage?: string }).shortMessage ?? "see the transaction");
        throw new Error(`The stake reverted: ${why}. ${txUrl(hash)}`);
      }

      session.set(`${id}-${side}`, { id, feedId: feed.id, symbol: feed.symbol, strike, expo: feed.expo, closesAt: w.closesAt, side, amount: units, stakedAt: nowSec(), hash });
      const [a, b] = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "pools", args: [id] })) as readonly [bigint, bigint];
      return (
        `Staked ${amount} USDC ${side} on ${feed.symbol} at strike $${px(Number(strike) * 10 ** feed.expo)}.\n` +
        `Window closes in ${w.closesAt - nowSec()}s. Pools now: ABOVE ${usd(a)} | BELOW ${usd(b)}.\n` +
        (notes.length ? `Along the way: ${notes.join("; ")}.\n` : "") +
        `${txUrl(hash)}\nAfter the window closes run tick_settle, then tick_collect.`
      );
    })
);

server.registerTool(
  "tick_positions",
  {
    title: "My positions",
    description: "Lists the demo wallet's recent stakes with their outcome and payout, plus its win/loss record.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
  },
  async ({ limit }) =>
    guard(async () => {
      const { account } = signer();
      const positions = (await loadPositions(account.address)).slice(0, limit ?? 12);
      if (positions.length === 0) return "No stakes yet.";
      let wins = 0;
      let losses = 0;
      let net = 0;
      const rows = await Promise.all(
        positions.map(async (p) => {
          const s = await settlementOf(p.id);
          const t = nowSec();
          let verdict: string;
          if (s.outcome === OUTCOME.unresolved) {
            verdict = t < p.closesAt ? `live (${p.closesAt - t}s left)` : "closed, awaiting settlement";
          } else if (s.outcome === OUTCOME.void) {
            verdict = "VOID, refund due";
          } else {
            const won = (s.outcome === OUTCOME.above) === (p.side === "ABOVE");
            const payout = await claimable(p.id, account.address);
            const amt = toUsd(p.amount);
            if (won) {
              wins++;
              // previewClaim reads 0 once collected, so fall back to the stake for the record only.
              net += payout > 0n ? toUsd(payout) - amt : 0;
            } else {
              losses++;
              net -= amt;
            }
            verdict = won ? `WON${payout > 0n ? ` (+${(toUsd(payout) - amt).toFixed(2)}, collect it)` : " (collected)"}` : "LOST";
          }
          return `${new Date(p.stakedAt * 1000).toISOString().slice(11, 19)}  ${p.symbol.padEnd(8)} ${p.side.padEnd(5)} ${toUsd(p.amount).toFixed(2)} USDC @ $${px(Number(p.strike) * 10 ** p.expo)}  ${verdict}`;
        })
      );
      return `Record: ${wins}W ${losses}L, net ${net >= 0 ? "+" : ""}${net.toFixed(2)} USDC (collected wins not counted in net)\n${rows.join("\n")}`;
    })
);

server.registerTool(
  "tick_settle",
  {
    title: "Settle closed markets",
    description:
      "Settles the demo wallet's closed, unsettled markets by submitting Pyth's signed price for the close second. Anyone can do this; the caller earns half the market's fee as a bounty. Voids markets that nobody settled within the settle window.",
    inputSchema: {},
  },
  async () =>
    guard(async () => {
      const { account, client } = signer();
      const positions = await loadPositions(account.address);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of positions) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const t = nowSec();
        if (t < p.closesAt + 1) continue;
        if ((await settlementOf(p.id)).outcome !== OUTCOME.unresolved) continue;
        const terms: Terms = { feedId: p.feedId, strike: p.strike, expo: p.expo, closesAt: BigInt(p.closesAt) };

        if (t > p.closesAt + SETTLE_WINDOW_S) {
          const h = await client.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "voidStale", args: [terms], gas: GAS.settle, account, chain: monadTestnet });
          await pub.waitForTransactionReceipt({ hash: h });
          out.push(`${p.symbol}: past the settle window, voided so stakes can be refunded. ${txUrl(h)}`);
          continue;
        }

        const before = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] })) as bigint;
        const { updateData } = await fetchUpdateForWindow(p.feedId, p.closesAt, SETTLE_TOLERANCE_S);
        const { request } = await pub.simulateContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "settleWithUpdate", args: [terms, updateData], value: 10n, account });
        const h = await client.writeContract(request);
        await pub.waitForTransactionReceipt({ hash: h });
        const after = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] })) as bigint;
        const s = await settlementOf(p.id);
        const name = s.outcome === OUTCOME.above ? "ABOVE" : s.outcome === OUTCOME.below ? "BELOW" : "VOID";
        out.push(`${p.symbol} @ ${new Date(p.closesAt * 1000).toISOString().slice(11, 19)} settled ${name} at $${px(Number(s.settlePrice) * 10 ** p.expo)}. Bounty earned: ${usd(after - before)}. ${txUrl(h)}`);
      }
      return out.length ? out.join("\n") : "Nothing to settle: no closed, unsettled markets among this wallet's stakes.";
    })
);

server.registerTool(
  "tick_collect",
  {
    title: "Collect winnings and refunds",
    description: "Claims every settled market that owes the demo wallet money (wins and refunds from voided markets) into its Tick balance.",
    inputSchema: {},
  },
  async () =>
    guard(async () => {
      const { account, client } = signer();
      const positions = await loadPositions(account.address);
      const seen = new Set<string>();
      let total = 0n;
      const out: string[] = [];
      for (const p of positions) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if ((await settlementOf(p.id)).outcome === OUTCOME.unresolved) continue;
        const owed = await claimable(p.id, account.address);
        if (owed === 0n) continue;
        const h = await client.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "claim", args: [p.id], gas: GAS.claim, account, chain: monadTestnet });
        const rc = await pub.waitForTransactionReceipt({ hash: h });
        if (rc.status === "success") {
          total += owed;
          out.push(`${p.symbol}: collected ${usd(owed)}. ${txUrl(h)}`);
        }
      }
      return out.length ? `${out.join("\n")}\nTotal ${usd(total)} added to the Tick balance.` : "Nothing to collect.";
    })
);

server.registerTool(
  "tick_withdraw",
  {
    title: "Withdraw to wallet",
    description: "Moves USDC from the Tick balance back to the demo wallet. Omit amount to withdraw everything.",
    inputSchema: { amount: z.number().positive().optional() },
  },
  async ({ amount }) =>
    guard(async () => {
      const { account, client } = signer();
      const dep = (await pub.readContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "deposits", args: [account.address] })) as bigint;
      const units = amount === undefined ? dep : BigInt(Math.round(amount * 1e6));
      if (units === 0n) return "Nothing to withdraw: the Tick balance is empty.";
      if (units > dep) throw new Error(`Only ${usd(dep)} is in Tick.`);
      const short = await gasShortfall(pub, account.address, [GAS.withdraw]);
      if (short) throw new Error(short);
      const h = await client.writeContract({ address: CONTRACTS.tick, abi: TickAbi, functionName: "withdraw", args: [units], gas: GAS.withdraw, account, chain: monadTestnet });
      await pub.waitForTransactionReceipt({ hash: h });
      return `Withdrew ${usd(units)} to ${account.address}. ${txUrl(h)}`;
    })
);

server.connect(new StdioServerTransport()).catch((e) => {
  process.stderr.write(`tick mcp failed to start: ${(e as Error).message}\n`);
  process.exit(1);
});
