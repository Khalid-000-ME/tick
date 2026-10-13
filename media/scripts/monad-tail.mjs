import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/raw";
mkdirSync(OUT, { recursive: true });
const CONTRACT = "0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2";
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  recordVideo: { dir: OUT, size: { width: 430, height: 932 } },
});
const p = await ctx.newPage();
await p.goto(`https://testnet.monadscan.com/address/${CONTRACT}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(7000);
for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 180); await p.waitForTimeout(700); }
await p.waitForTimeout(2500);
await p.close();
await ctx.close();
await b.close();
console.log("recorded");
