import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "light"); } catch {} });
const p = await ctx.newPage();
// the live site, which is what the screenshot shows
await p.goto("https://www.tick-predict.xyz/w/0xc15394cdcb3bc24999d21480f014a227384ac17e", { waitUntil: "load" });
await p.waitForTimeout(7000);
const info = await p.evaluate(() => {
  const el = document.querySelector(".share-x");
  if (!el) return { err: "no .share-x on the live page" };
  const cs = getComputedStyle(el);
  const svg = el.querySelector("svg");
  return { color: cs.color, bg: cs.backgroundColor, svgFill: svg && getComputedStyle(svg).fill,
           svgColor: svg && getComputedStyle(svg).color };
});
console.log("LIVE:", JSON.stringify(info));
await b.close();
