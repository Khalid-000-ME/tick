/** The dApp Store wants portrait previews at 9:16. Captured at 540x960 CSS with a 2x screen, which is
 *  1080x1920 and the app's phone layout. */
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const SHOTS = [
  ["01-feed", "/feed", 4200, 0],
  ["02-trade", "/trade?feed=BTC%2FUSD&window=30", 6000, 0],
  ["03-room", "/rooms/2", 6500, 0],
  ["04-groups", "/groups/1", 6000, 0],
  ["05-card", "/w/0xc15394cdcb3bc24999d21480f014a227384ac17e", 3000, 0],
  ["06-markets", "/markets", 5000, 320],
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
await ctx.addInitScript(() => {
  const s = document.createElement("style");
  s.textContent = "nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}";
  (document.head || document.documentElement).appendChild(s);
});
const page = await ctx.newPage();
for (const [name, path, wait, scroll] of SHOTS) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  if (scroll) { await page.evaluate((y) => window.scrollTo(0, y), scroll); await page.waitForTimeout(900); }
  await page.screenshot({ path: `../store/${name}.png` });
  console.log(name);
}
await b.close();
