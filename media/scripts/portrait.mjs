import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/store/portrait";
mkdirSync(OUT, { recursive: true });
const B = "http://localhost:3000";
const PAGES = [
  ["01-feed", `${B}/feed`],
  ["02-trade", `${B}/trade?feed=BTC%2FUSD&window=30`],
  ["03-room", `${B}/rooms/2`],
  ["04-chat", `${B}/groups/1`],
  ["05-card", `${B}/w/0xc15394cdcb3bc24999d21480f014a227384ac17e`],
  ["06-markets", `${B}/markets`],
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
for (const [name, url] of PAGES) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(5500);
  await p.evaluate(() => { document.querySelector("nextjs-portal")?.remove(); });
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.close();
  console.log(name);
}
await b.close();
