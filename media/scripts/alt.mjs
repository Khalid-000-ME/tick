import { chromium } from "playwright";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/store/raw";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });
const B = "http://localhost:3000";
const PAGES = [
  


  ["groupchat", `${B}/groups/1`, 0], ["leaderboard", `${B}/leaderboard`, 0],


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
