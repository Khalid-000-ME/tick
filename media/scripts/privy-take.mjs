/**
 * Records a real Privy sign-in and what the embedded wallet does afterwards.
 *
 * This is the one recording that uses Privy properly rather than the app's fallback wallet path:
 * email login, Privy's own code screen, the embedded wallet appearing, and then a stake signed by
 * that wallet. It pauses at the code screen and waits for the six digits to be written to
 * /tmp/tickcode.txt, so the person reading the inbox can paste them in without the recording
 * stopping.
 *
 *   node privy-take.mjs you@example.com
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";

const EMAIL = process.argv[2];
if (!EMAIL) throw new Error("usage: node privy-take.mjs <email>");
const BASE = process.env.DEMO_BASE || "http://localhost:3000";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/raw-privy";
const CODE_FILE = "/tmp/tickcode.txt";
const VW = 540, VH = 960;
const CURSOR = readFileSync("/Users/khalid/Projects/colosseum/tick/media/scripts/cursor.js", "utf8");
const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);

mkdirSync(OUT, { recursive: true });
if (existsSync(CODE_FILE)) unlinkSync(CODE_FILE);

async function tap(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 25000 });
  const box = await locator.boundingBox();
  if (box) {
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    await page.evaluate(([x, y]) => window.__demo?.move(x, y), [x, y]);
    await page.waitForTimeout(600);
    await page.evaluate(([x, y]) => window.__demo?.press(x, y), [x, y]);
    await page.waitForTimeout(150);
  }
  await locator.click();
  log(`tapped ${label}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  recordVideo: { dir: OUT, size: { width: VW, height: VH } },
});
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

try {
  await page.goto(`${BASE}/feed`, { waitUntil: "load" });
  await page.waitForTimeout(3500);

  // Privy's own dialog, opened from the app's sign-in button.
  await tap(page, page.getByRole("button", { name: /^(Log in|Sign up)$/i }).first(), "sign in");
  await page.waitForTimeout(2500);

  // The dialog asks how you want to sign in before it asks for anything.
  await tap(page, page.getByRole("button", { name: /Continue with email/i }).first(), "continue with email");
  await page.waitForTimeout(1500);

  const emailBox = page.locator('input[type="email"]').first();
  await emailBox.waitFor({ state: "visible", timeout: 25000 });
  const box = await emailBox.boundingBox();
  if (box) await page.evaluate(([x, y]) => window.__demo?.move(x, y), [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)]);
  await emailBox.click();
  await emailBox.type(EMAIL, { delay: 70 });
  await page.waitForTimeout(800);
  await tap(page, page.getByRole("button", { name: /Send code/i }).first(), "send code");

  log(`CODE REQUESTED for ${EMAIL} — write the six digits to ${CODE_FILE}`);

  // Hold here, recording, until the code arrives.
  const deadline = Date.now() + 15 * 60 * 1000;
  let code = null;
  while (Date.now() < deadline) {
    if (existsSync(CODE_FILE)) {
      const raw = readFileSync(CODE_FILE, "utf8").replace(/\D/g, "");
      if (raw.length >= 6) { code = raw.slice(0, 6); break; }
    }
    await page.waitForTimeout(1000);
  }
  if (!code) throw new Error("no code arrived within fifteen minutes");
  log(`code received, entering it`);

  const digits = page.locator('input[autocomplete="one-time-code"]').first();
  await digits.click();
  await digits.type(code, { delay: 130 });
  await page.waitForTimeout(900);
  await tap(page, page.getByRole("button", { name: /^(Log in|Create account)$/i }).first(), "submit code");

  // Signed in: the embedded wallet is created here if the account did not have one.
  await page.waitForTimeout(12000);
  log("signed in; letting the embedded wallet settle");
  await page.waitForTimeout(6000);

  // Show who we are, then put the wallet to work.
  await page.goto(`${BASE}/portfolio`, { waitUntil: "load" });
  await page.waitForTimeout(6000);

  await page.goto(`${BASE}/trade?feed=BTC%2FUSD&window=30`, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => new Promise((done) => {
    const t0 = performance.now();
    const step = (now) => { const t = Math.min(1, (now - t0) / 1500); window.scrollTo(0, 420 * t); t < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }));
  await page.waitForTimeout(1500);

  const chip = page.locator(".amount-presets button").nth(1);
  await tap(page, chip, "stake size");
  await page.waitForTimeout(1000);
  await tap(page, page.locator(".side-picker button.side-up"), "Above");
  await page.waitForTimeout(1800);
  const go = page.locator("button.confirm-go");
  if (await go.count()) await tap(page, go, "Stake ABOVE");
  log("stake submitted; the embedded wallet is signing it");
  await page.waitForTimeout(20000);
} catch (e) {
  log(`FAILED ${e.message.split("\n")[0].slice(0, 140)}`);
}

await page.waitForTimeout(600);
const video = page.video();
await page.close();
await ctx.close();
renameSync(await video.path(), `${OUT}/privy.webm`);
await browser.close();
log(`saved ${OUT}/privy.webm`);
