/**
 * The logged-in take: sign in with an email code, look around as a real account, then sign out.
 * The code cannot be known in advance, so the script waits for it to appear in /tmp/tickcode.txt.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = process.argv[2];
const CODE_FILE = "/tmp/tickcode.txt";
const OUT = path.resolve("../raw");
const CURSOR = fs.readFileSync("cursor.js", "utf8");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  recordVideo: { dir: OUT, size: { width: 430, height: 932 } },
});
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();
const d = (expr) => page.evaluate(`(async () => { await ${expr}; })()`);

try {
  await page.goto(`${BASE}/feed`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await d(`__demo.wait(700)`);

  // Log in → email
  await d(`__demo.tap('.auth-login', { ms: 700 })`);
  await page.waitForTimeout(1200);
  await d(`__demo.tap('.auth-methods button', { nth: 2, ms: 650 })`);
  await page.waitForTimeout(900);
  await page.fill('.auth-form input[type="email"]', EMAIL);
  await page.waitForTimeout(500);
  await d(`__demo.tap('.auth-primary', { ms: 600 })`);
  log(`code requested for ${EMAIL} — waiting for ${CODE_FILE}`);

  // Wait for the human to paste the code.
  let code = null;
  for (let i = 0; i < 300 && !code; i++) {
    if (fs.existsSync(CODE_FILE)) {
      const t = fs.readFileSync(CODE_FILE, "utf8").replace(/\D/g, "");
      if (t.length >= 6) code = t.slice(0, 6);
    }
    if (!code) await page.waitForTimeout(1000);
  }
  if (!code) throw new Error("no code arrived");
  log(`code ${code} — entering`);

  await page.fill('input[inputmode="numeric"]', code);
  await page.waitForTimeout(600);
  await d(`__demo.tap('.auth-primary', { ms: 600 })`);
  await page.waitForTimeout(9000);
  log("signed in");

  // A quick look around as a real account, then sign out.
  await d(`__demo.wait(1500)`);
  await d(`__demo.scroll(420, 1200)`);
  await d(`__demo.wait(1200)`);
  await page.goto(`${BASE}/portfolio`, { waitUntil: "load" });
  await page.waitForTimeout(5000);
  await d(`__demo.wait(2000)`);
  await page.goto(`${BASE}/feed`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await d(`__demo.tap('.terminal-wallet', { ms: 700 })`);
  await page.waitForTimeout(1200);
  await d(`__demo.tap('.wallet-pop .is-danger', { ms: 650 })`);
  await page.waitForTimeout(4000);
  log("signed out");
} catch (e) {
  log(`FAILED ${(e.message || "").split("\n")[0]}`);
}
await page.waitForTimeout(600);
const video = page.video();
await ctx.close();
fs.renameSync(await video.path(), path.join(OUT, "login.webm"));
await browser.close();
log(`saved ${OUT}/login.webm`);
