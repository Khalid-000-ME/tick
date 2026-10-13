import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "node:fs";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/store";
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Geist+Pixel&display=swap">`;

const html = `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:1200px;overflow:hidden;position:relative;background:#080a07;
background-image:radial-gradient(ellipse 72% 58% at 50% 40%, #223413 0%, #0d1209 56%, #070907 100%);
font-family:'Geist',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:66px}
.brand{display:flex;align-items:center;gap:22px}
.mark{display:flex;gap:9px;align-items:center;transform:skew(-17deg)}
.mark i{width:14px;height:76px;background:#d8f35f;border-radius:2px}
.mark i:first-child{height:40px;align-self:flex-end}
.mark i:last-child{height:53px;align-self:flex-start}
.wm{font-size:124px;font-weight:700;letter-spacing:-6px;color:#f4f7ec;line-height:1}
.wm em{font-style:normal;color:#d8f35f}
.card{width:800px;padding:52px 56px 56px;border-radius:34px;border:2px solid #4a6020;
background:radial-gradient(ellipse 90% 140% at 10% 0%, #27350f 0%, #141a0c 62%, #0e1209 100%);
box-shadow:0 0 90px rgba(216,243,95,0.18), inset 0 1px 0 rgba(216,243,95,0.14)}
.vf{display:flex;align-items:center;gap:14px;font-family:'Geist Mono',monospace;font-size:26px;letter-spacing:4px;color:#d8f35f;margin-bottom:22px}
.vf b{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#d8f35f;color:#101407;font-size:19px;font-weight:700}
.amt{font-family:'Geist Pixel','Geist Mono',monospace;font-size:132px;font-weight:400;letter-spacing:3px;color:#d8f35f;line-height:1;text-shadow:0 0 54px rgba(216,243,95,0.45)}
.meta{margin-top:26px;font-family:'Geist Mono',monospace;font-size:26px;color:#9aa58a;letter-spacing:1px}
.tag{font-size:50px;font-weight:600;letter-spacing:-1.6px;color:#f4f7ec;text-align:center;line-height:1.2}
.tag em{font-style:normal;color:#d8f35f}
.dom{position:absolute;bottom:64px;font-family:'Geist Mono',monospace;font-size:26px;letter-spacing:3px;color:#79816d}
</style></head><body>
<div class="brand"><span class="mark"><i></i><i></i><i></i></span><span class="wm">tick<em>.</em></span></div>
<div class="card">
<div class="vf"><b>&#10003;</b>VERIFIED ON CHAIN</div>
<div class="amt">+$3.68</div>
<div class="meta">22 calls &middot; #1 overall &middot; 30s windows</div>
</div>
<div class="tag">Compete in groups.<br><em>Flex your profits.</em></div>
<div class="dom">tick-predict.xyz</div>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
writeFileSync(`${OUT}/_g.html`, html);
await p.goto(`file://${OUT}/_g.html`);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/graphic-1200x1200.png` });
await b.close();
unlinkSync(`${OUT}/_g.html`);
console.log("ok");
