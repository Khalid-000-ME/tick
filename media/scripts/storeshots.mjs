import { chromium } from "playwright";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/store/raw";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });
const B = "http://localhost:3000";
const PAGES = [
  ["feed", `${B}/feed`, 0],
  ["trade", `${B}/trade?feed=BTC%2FUSD&window=30`, 0],
  ["room", `${B}/rooms/2`, 0],
  ["groups", `${B}/groups`, 0],
  ["card", `${B}/w/0xc15394cdcb3bc24999d21480f014a227384ac17e`, 0],
  ["markets", `${B}/markets`, 0],
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
for (const [name, url, scroll] of PAGES) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(5500);
  if (scroll) await p.evaluate((y) => window.scrollTo(0, y), scroll);
  await p.waitForTimeout(600);
  await p.evaluate(() => { document.querySelector("nextjs-portal")?.remove(); });
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.close();
  console.log(name);
}
await b.close();
