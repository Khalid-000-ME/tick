import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/pitch/stills";
mkdirSync(OUT, { recursive: true });
const B = "http://localhost:3000";
const PK = keccak256(toHex("tick-participant-21"));
const A = privateKeyToAccount(PK);
const RPC = readFileSync("/Users/khalid/Projects/colosseum/tick/app/.env.local", "utf8").match(/^NEXT_PUBLIC_MONAD_RPC=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const inject = readFileSync("/Users/khalid/Projects/colosseum/tick/media/scripts/record-in.mjs", "utf8")
  .match(/const injectWallet = \(address, rpc, chainHex\) => `([\s\S]*?)`;/)[1];
const script = inject.replace("${JSON.stringify(address)}", JSON.stringify(A.address)).replace("${JSON.stringify(chainHex)}", '"0x279f"').replace("${JSON.stringify(rpc)}", JSON.stringify(RPC));

const PAGES = [
  ["01-room", `${B}/rooms/2`], ["02-trade", `${B}/trade?feed=BTC%2FUSD&window=30`],
  ["03-card", `${B}/w/0xc15394cdcb3bc24999d21480f014a227384ac17e`], ["04-portfolio", `${B}/portfolio`],
  ["05-chat", `${B}/groups/1`], ["06-feed", `${B}/feed`],
  ["07-leaderboard", `${B}/leaderboard`], ["08-markets", `${B}/markets`],
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
await ctx.addInitScript(script);
for (const [name, url] of PAGES) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(5200);
  await p.evaluate(() => { document.querySelector("nextjs-portal")?.remove(); });
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.close();
  console.log(name);
}
await b.close();
