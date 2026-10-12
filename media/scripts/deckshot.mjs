import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "dark"); } catch {} });
const shots = [
  ["http://localhost:3000/rooms/2", "/Users/khalid/Projects/colosseum/tick/media/store/deck-room.png"],
  ["http://localhost:3000/feed", "/Users/khalid/Projects/colosseum/tick/media/store/deck-feed.png"],
];
for (const [url, out] of shots) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { document.querySelector("nextjs-portal")?.remove(); });
  await p.screenshot({ path: out });
  await p.close();
  console.log(out);
}
await b.close();
