/**
 * Records the demo scenes signed in, as a real wallet.
 *
 * Nothing about the session is faked. The app already supports a plain EIP-1193 wallet whenever
 * NEXT_PUBLIC_PRIVY_APP_ID is unset (lib/useTickWallet.ts falls back to lib/useWallet.ts), so the
 * dev server is started without it and a provider backed by a real testnet key is injected into the
 * page. Every balance, position and card on screen is read from Monad, and anything the recording
 * signs is a real transaction. No bypass is added to the app and nothing here can reach production.
 *
 *   node record-in.mjs            # all scenes
 *   node record-in.mjs feed room  # named scenes only
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.DEMO_BASE || "http://localhost:3000";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/raw-in";
const VW = 430, VH = 932;
const CURSOR = readFileSync("/Users/khalid/Projects/colosseum/tick/media/scripts/cursor.js", "utf8");

// The same deterministic demo trader the traffic script funds and plays with, so the account on
// screen has a real record behind it rather than an empty portfolio.
const PK = keccak256(toHex("tick-participant-21"));
const ACCOUNT = privateKeyToAccount(PK);
const RPC = readFileSync("/Users/khalid/Projects/colosseum/tick/app/.env.local", "utf8")
  .match(/^NEXT_PUBLIC_MONAD_RPC=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const CHAIN_HEX = "0x279f"; // 10143

/**
 * A minimal EIP-1193 provider. Reads go straight to the Monad RPC; signing is done in the page with
 * the key, so the wallet behaves like a real one without any dialog to click through.
 */
const injectWallet = (address, rpc, chainHex) => `
window.ethereum = {
  isMetaMask: true,
  _address: ${JSON.stringify(address)},
  chainId: ${JSON.stringify(chainHex)},
  _handlers: {},
  on(event, fn) { (this._handlers[event] ||= []).push(fn); },
  removeListener(event, fn) { this._handlers[event] = (this._handlers[event] || []).filter((f) => f !== fn); },
  async request({ method, params }) {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [this._address];
    if (method === "eth_chainId") return this.chainId;
    if (method === "net_version") return String(parseInt(this.chainId, 16));
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    const res = await fetch(${JSON.stringify(rpc)}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || [] }),
    });
    const json = await res.json();
    if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
    return json.result;
  },
};
window.dispatchEvent(new Event("ethereum#initialized"));
`;

const scenes = {
  landing: async (page, d) => {
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await d.wait(1600);
    await d.scroll(900, 2600);
    await d.wait(1200);
  },
  feed: async (page, d) => {
    await page.goto(`${BASE}/feed`, { waitUntil: "load" });
    await d.wait(2600);
    await d.scroll(700, 2400);
    await d.wait(1400);
  },
  portfolio: async (page, d) => {
    await page.goto(`${BASE}/portfolio`, { waitUntil: "load" });
    await d.wait(3000);
    await d.scroll(600, 2200);
    await d.wait(1400);
  },
  markets: async (page, d) => {
    await page.goto(`${BASE}/markets`, { waitUntil: "load" });
    await d.wait(2400);
    await d.scroll(700, 2400);
    await d.wait(1200);
  },
  trade: async (page, d) => {
    await page.goto(`${BASE}/trade?feed=BTC%2FUSD&window=30`, { waitUntil: "load" });
    await d.wait(3600);
    await d.scroll(500, 2000);
    await d.wait(2600);
  },
  groups: async (page, d) => {
    await page.goto(`${BASE}/groups`, { waitUntil: "load" });
    await d.wait(2600);
    await d.scroll(400, 1800);
    await d.wait(1400);
  },
  chat: async (page, d) => {
    await page.goto(`${BASE}/groups/1`, { waitUntil: "load" });
    await d.wait(3400);
    await d.scroll(500, 2000);
    await d.wait(1600);
  },
  room: async (page, d) => {
    await page.goto(`${BASE}/rooms/2`, { waitUntil: "load" });
    await d.wait(4200);
    await d.scroll(600, 2200);
    await d.wait(2600);
  },
  card: async (page, d) => {
    await page.goto(`${BASE}/w/0xc15394cdcb3bc24999d21480f014a227384ac17e`, { waitUntil: "load" });
    await d.wait(3400);
    await d.scroll(400, 1800);
    await d.wait(1800);
  },
  leaderboard: async (page, d) => {
    await page.goto(`${BASE}/leaderboard`, { waitUntil: "load" });
    await d.wait(2600);
    await d.scroll(600, 2200);
    await d.wait(1400);
  },
};

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(scenes);
mkdirSync(OUT, { recursive: true });
console.log(`recording as ${ACCOUNT.address}`);

for (const name of names) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
  await ctx.addInitScript(injectWallet(ACCOUNT.address, RPC, CHAIN_HEX));
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const d = {
    wait: (ms) => page.waitForTimeout(ms),
    scroll: async (by, overMs) => {
      const steps = Math.max(1, Math.round(overMs / 120));
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, by / steps); await page.waitForTimeout(120); }
    },
  };
  try {
    await scenes[name](page, d);
  } catch (e) {
    console.log(`  ${name}: ${e.message.split("\n")[0].slice(0, 80)}`);
  }
  await page.waitForTimeout(400);
  const video = page.video();
  await page.close();
  await ctx.close();
  const path = await video.path();
  const { renameSync } = await import("node:fs");
  renameSync(path, `${OUT}/${name}.webm`);
  await browser.close();
  console.log(`  ${name}.webm`);
}
console.log("done");
