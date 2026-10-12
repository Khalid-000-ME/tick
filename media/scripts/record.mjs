/**
 * Records the demo, one scene per file, in a phone-sized viewport.
 *
 * Scenes are separate so a single one can be retaken without redoing the rest, and so the login take
 * (which needs a code from a real inbox) can be recorded on its own and dropped into the same cut.
 * The cursor is the page's own (cursor.js), so the video captures it.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE || "http://localhost:3000";
const OUT = path.resolve("../raw");
const CURSOR = fs.readFileSync("cursor.js", "utf8");
const VW = 430, VH = 932;

const SCENES = {
  // Each returns when its beat is done; the recorder adds a little tail so nothing cuts abruptly.
  landing: async (page, d) => {
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await d(`__demo.wait(2600)`);
    await d(`__demo.scroll(document.querySelector('section.rs').offsetTop + 600, 1500)`);
    await d(`__demo.wait(900)`);
    await d(`__demo.scroll(document.querySelector('section.rs').offsetTop + 2600, 2200)`);
    await d(`__demo.wait(1400)`);
  },
  feed: async (page, d) => {
    await page.goto(`${BASE}/feed`, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    await d(`__demo.wait(1200)`);
    await d(`__demo.scroll(520, 1500)`);
    await d(`__demo.wait(1600)`);
  },
  markets: async (page, d) => {
    await page.goto(`${BASE}/markets`, { waitUntil: "load" });
    await page.waitForTimeout(3800);
    await d(`__demo.wait(900)`);
    await d(`__demo.scroll(360, 1200)`);
    await d(`__demo.wait(700)`);
    await d(`__demo.tap('.board-card .card-hit', { ms: 820 })`);
    await page.waitForTimeout(4200);
  },
  trade: async (page, d) => {
    await page.goto(`${BASE}/trade?feed=BTC%2FUSD&window=30`, { waitUntil: "load" });
    await page.waitForTimeout(5200);
    await d(`__demo.wait(2600)`);
    await d(`__demo.show()`);
    await d(`__demo.move(innerWidth*0.27, innerHeight*0.72, 760)`);
    await d(`__demo.wait(700)`);
    await d(`__demo.hide()`);
    await d(`__demo.wait(1200)`);
  },
  groups: async (page, d) => {
    await page.goto(`${BASE}/groups`, { waitUntil: "load" });
    await page.waitForTimeout(4200);
    await d(`__demo.wait(1100)`);
    await d(`__demo.tap('.gl-row', { ms: 800 })`);
    await page.waitForTimeout(5200);
    await d(`__demo.wait(1800)`);
  },
  room: async (page, d) => {
    await page.goto(`${BASE}/rooms/2`, { waitUntil: "load" });
    await page.waitForTimeout(6000);
    await d(`__demo.wait(1800)`);
    await d(`__demo.scroll(620, 1500)`);
    await d(`__demo.wait(2400)`);
  },
  card: async (page, d) => {
    await page.goto(`${BASE}/w/0xc15394cdcb3bc24999d21480f014a227384ac17e`, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    await d(`__demo.wait(2600)`);
  },
};

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(SCENES);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const name of names) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
    colorScheme: "dark",
  });
  // Dark throughout: the demo sits on a dark backdrop, and the app's own theme is remembered per
  // browser, so it is set before the page's theme bootstrap runs.
  await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
  // The cursor and the dev-badge hiding must exist before the first paint of every page.
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
  const d = (expr) => page.evaluate(`(async () => { await ${expr}; })()`);
  const t0 = Date.now();
  try {
    await SCENES[name](page, d);
    await page.waitForTimeout(700);
  } catch (e) {
    console.log(`${name}: FAILED ${(e.message || "").split("\n")[0]}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  const dest = path.join(OUT, `${name}.webm`);
  fs.renameSync(src, dest);
  console.log(`${name}  ${secs}s  ${(fs.statSync(dest).size / 1e6).toFixed(1)}MB${errs.length ? `  errors: ${errs.slice(0, 2).join(" | ")}` : ""}`);
}
await browser.close();
