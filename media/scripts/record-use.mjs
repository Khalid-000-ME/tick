/**
 * Records someone actually using Tick: placing a stake, sending a message, posting a card.
 *
 * The difference from record-in.mjs is that the injected wallet signs. Reads go to the Monad RPC as
 * before; anything that needs a signature is handed to Node through a Playwright binding, signed
 * there with a real testnet key and broadcast. So every tap in these clips produces a transaction
 * that exists on chain, and what you see afterwards is the app reading its own result back.
 *
 *   node record-use.mjs             # all interactions
 *   node record-use.mjs stake chat  # named ones
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, renameSync } from "node:fs";
import { createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.DEMO_BASE || "http://localhost:3000";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/raw-use";
const VW = 540, VH = 960;
const CURSOR = readFileSync("/Users/khalid/Projects/colosseum/tick/media/scripts/cursor.js", "utf8");

const PK = keccak256(toHex("tick-participant-21"));
const ACCOUNT = privateKeyToAccount(PK);
const ENV = readFileSync("/Users/khalid/Projects/colosseum/tick/app/.env.local", "utf8");
const RPC = ENV.match(/^NEXT_PUBLIC_MONAD_RPC=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const CHAIN_HEX = "0x279f";

const monad = {
  id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const signer = createWalletClient({ account: ACCOUNT, chain: monad, transport: http(RPC) });

const provider = (address, rpc, chainHex) => `
window.ethereum = {
  isMetaMask: true,
  _address: ${JSON.stringify(address)},
  chainId: ${JSON.stringify(chainHex)},
  _handlers: {},
  on(e, fn) { (this._handlers[e] ||= []).push(fn); },
  removeListener(e, fn) { this._handlers[e] = (this._handlers[e] || []).filter((f) => f !== fn); },
  async request({ method, params }) {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [this._address];
    if (method === "eth_chainId") return this.chainId;
    if (method === "net_version") return String(parseInt(this.chainId, 16));
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    // Signing happens in the harness, with the real key, and the transaction is broadcast there.
    if (method === "eth_sendTransaction") return await window.__tickSend(params[0]);
    if (method === "personal_sign") return await window.__tickSign(params[0]);
    const res = await fetch(${JSON.stringify(rpc)}, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || [] }),
    });
    const json = await res.json();
    if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
    return json.result;
  },
};
window.dispatchEvent(new Event("ethereum#initialized"));
`;

/** Move the on-screen pointer to an element and press it, so the tap is visible in the recording. */
async function tap(page, selector, { nth = 0 } = {}) {
  const el = page.locator(selector).nth(nth);
  await el.waitFor({ state: "visible", timeout: 15000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await page.evaluate(([x, y]) => window.__demo?.move(x, y), [x, y]);
  await page.waitForTimeout(650);
  await page.evaluate(([x, y]) => window.__demo?.press(x, y), [x, y]);
  await page.waitForTimeout(160);
  await el.click();
}

async function type(page, selector, text) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 15000 });
  const box = await el.boundingBox();
  if (box) {
    await page.evaluate(([x, y]) => window.__demo?.move(x, y), [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)]);
    await page.waitForTimeout(500);
  }
  await el.click({ force: true });
  await el.type(text, { delay: 55 });
  await page.waitForTimeout(500);
}

const smoothScroll = (page, by, overMs) => page.evaluate(([by, overMs]) => new Promise((done) => {
  const start = window.scrollY, t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / overMs);
    window.scrollTo(0, start + by * ease(t));
    t < 1 ? requestAnimationFrame(step) : done();
  };
  requestAnimationFrame(step);
}), [by, overMs]);


/** Taps something by its visible text, and shrugs if that control is not on this screen. */
async function tapText(page, text, opts = {}) {
  try {
    const el = page.getByText(text, { exact: opts.exact ?? false }).first();
    await el.waitFor({ state: "visible", timeout: 6000 });
    const box = await el.boundingBox();
    if (box) {
      const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
      await page.evaluate(([x, y]) => window.__demo?.move(x, y), [x, y]);
      await page.waitForTimeout(600);
      await page.evaluate(([x, y]) => window.__demo?.press(x, y), [x, y]);
      await page.waitForTimeout(150);
    }
    await el.click({ timeout: 4000 });
    return true;
  } catch { return false; }
}

const scenes = {
  /** Take a side on a live window, and stay on screen while it lands. */
  stake: async (page) => {
    await page.goto(`${BASE}/trade?feed=BTC%2FUSD&window=30`, { waitUntil: "load" });
    await page.waitForTimeout(4500);
    await smoothScroll(page, 420, 1500);
    await page.waitForTimeout(900);
    await tap(page, ".amount-presets button", { nth: 3 });     // the $1 chip
    await page.waitForTimeout(900);
    await tap(page, ".side-picker button.side-up");                              // Above
    // A side opens the confirm sheet: the order, priced, before it is sent.
    await page.waitForTimeout(1800);
    await tap(page, "button.confirm-go");
    console.log("    confirmed; legend:", await page.locator(".side-picker legend").first().innerText().catch(() => "?"));
    // From here it is a real transaction: signed, broadcast, mined, and read back by the app.
    await page.waitForTimeout(16000);
    await smoothScroll(page, 260, 1200);
    await page.waitForTimeout(4000);
  },

  /** Say something in the group, on chain. */
  chat: async (page) => {
    await page.goto(`${BASE}/groups/1`, { waitUntil: "load" });
    await page.waitForTimeout(4500);
    await type(page, 'input[aria-label="Message"]', "called that one, above by a hair");
    await tap(page, 'form button[type="submit"], button:has-text("Send")');
    await page.waitForTimeout(12000);
  },

  /** Post the card to the feed. */
  post: async (page) => {
    await page.goto(`${BASE}/feed`, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await type(page, 'textarea[placeholder="What happened in those thirty seconds?"]', "thirty seconds, and the card does the talking");
    await tap(page, 'button:has-text("Post")');
    await page.waitForTimeout(14000);
    await smoothScroll(page, 420, 1400);
    await page.waitForTimeout(2500);
  },

  /** The room: the window everyone in the group is calling, and the board that re-sorts. */
  room: async (page) => {
    await page.goto(`${BASE}/rooms/2`, { waitUntil: "load" });
    await page.waitForTimeout(4500);
    await tapText(page, "$0.5");
    await page.waitForTimeout(1100);
    await tapText(page, "$1", { exact: true });
    await page.waitForTimeout(1400);
    await smoothScroll(page, 620, 2000);
    await page.waitForTimeout(2600);
    await smoothScroll(page, -300, 1200);
    await page.waitForTimeout(1600);
  },

  /** The markets list, switching between crypto and sport. */
  markets: async (page) => {
    await page.goto(`${BASE}/markets`, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await tapText(page, "Sports");
    await page.waitForTimeout(2600);
    await tapText(page, "Markets", { exact: true });
    await page.waitForTimeout(2200);
    await smoothScroll(page, 560, 2000);
    await page.waitForTimeout(1800);
  },

  /** The portfolio, filtered down to what is still open. */
  portfolio: async (page) => {
    await page.goto(`${BASE}/portfolio`, { waitUntil: "load" });
    await page.waitForTimeout(4200);
    await smoothScroll(page, 320, 1200);
    await page.waitForTimeout(1200);
    await tapText(page, "Open");
    await page.waitForTimeout(2600);
    await smoothScroll(page, 420, 1600);
    await page.waitForTimeout(1800);
  },

  /** The card, and the share actions that carry it out of the app. */
  card: async (page) => {
    await page.goto(`${BASE}/w/0xc15394cdcb3bc24999d21480f014a227384ac17e`, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await tapText(page, "Copy link");
    await page.waitForTimeout(2400);
    await smoothScroll(page, 420, 1600);
    await page.waitForTimeout(2000);
  },

  /** The feed, sorted the other way and back. */
  feed: async (page) => {
    await page.goto(`${BASE}/feed`, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await tapText(page, "Top", { exact: true });
    await page.waitForTimeout(2400);
    await tapText(page, "Latest", { exact: true });
    await page.waitForTimeout(1800);
    await smoothScroll(page, 620, 2200);
    await page.waitForTimeout(1800);
  },

  /** Groups, opening the one Marco is in. */
  groups: async (page) => {
    await page.goto(`${BASE}/groups`, { waitUntil: "load" });
    await page.waitForTimeout(3800);
    await tapText(page, "Sigma Traders");
    await page.waitForTimeout(3600);
    await smoothScroll(page, 420, 1600);
    await page.waitForTimeout(1800);
  },

  /** The board everyone is racing. */
  leaderboard: async (page) => {
    await page.goto(`${BASE}/leaderboard`, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await smoothScroll(page, 700, 2400);
    await page.waitForTimeout(2200);
    await smoothScroll(page, -400, 1400);
    await page.waitForTimeout(1600);
  },

  /** The landing page and its scroll story. */
  landing: async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForTimeout(2600);
    await smoothScroll(page, 1500, 4200);
    await page.waitForTimeout(1800);
    await smoothScroll(page, 1500, 4200);
    await page.waitForTimeout(1600);
  },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
mkdirSync(OUT, { recursive: true });
console.log(`using the app as ${ACCOUNT.address}`);

for (const name of names) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  });
  await ctx.exposeBinding("__tickSend", async (_s, tx) => {
    const hash = await signer.sendTransaction({
      to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined,
      gas: tx.gas ? BigInt(tx.gas) : undefined,
    });
    console.log(`    tx ${hash}`);
    return hash;
  });
  await ctx.exposeBinding("__tickSign", async (_s, message) => signer.signMessage({ message: { raw: message } }));
  await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
  await ctx.addInitScript(provider(ACCOUNT.address, RPC, CHAIN_HEX));
  await ctx.addInitScript(CURSOR);

  const page = await ctx.newPage();
  try { await scenes[name](page); }
  catch (e) { console.log(`  ${name}: ${e.message.split("\n")[0].slice(0, 90)}`); }
  await page.waitForTimeout(500);
  const video = page.video();
  await page.close();
  await ctx.close();
  renameSync(await video.path(), `${OUT}/${name}.webm`);
  await browser.close();
  console.log(`  ${name}.webm`);
}
console.log("done");
