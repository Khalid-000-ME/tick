import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 960, height: 4320 }, deviceScaleFactor: 0.5 });
await p.goto("file:///tmp/deck.html");
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);
await p.screenshot({ path: "/tmp/deckchk.png", fullPage: true });
await b.close();
