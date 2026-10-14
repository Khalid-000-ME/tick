import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem("tick.theme", "light"); } catch {} });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/w/0xc15394cdcb3bc24999d21480f014a227384ac17e", { waitUntil: "load" });
await p.waitForTimeout(6000);
const info = await p.evaluate(() => {
  const el = document.querySelector(".share-x");
  if (!el) return { err: "no .share-x" };
  const cs = getComputedStyle(el);
  const rules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
    .filter(r => r.selectorText && /share-x|share-actions a\b/.test(r.selectorText))
    .map(r => r.selectorText + " { " + r.style.cssText.slice(0, 120) + " }");
  return { theme: document.documentElement.getAttribute("data-theme"),
           color: cs.color, background: cs.backgroundColor, opacity: cs.opacity, rules };
});
console.log(JSON.stringify(info, null, 1));
await p.locator(".share-actions").first().screenshot({ path: "/tmp/share-light.png" });
await b.close();
