import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "node:fs";
const RAW = "raw";
const ICON = "icon-512.png";
const OUT = "/Users/khalid/Projects/colosseum/tick/media/store";

const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">`;
const BG = (x, y) => `background:#080a07;background-image:radial-gradient(ellipse 70% 55% at ${x} ${y}, #1e2d11 0%, #0c1109 55%, #070907 100%)`;

const PREVIEWS = [
  ["01-feed", "feed", "Your crew's wins,", "verified on chain"],
  ["02-trade", "trade", "One question.", "Thirty seconds."],
  ["03-room", "room", "Call the same window", "as your group"],
  ["04-chat", "groupchat", "Cards land", "in the group chat"],
  ["05-card", "card", "Flex the card", "that proves it"],
  ["06-markets", "markets", "Crypto, equities", "and sport"],
];

const preview = (shot, l1, l2) => `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;overflow:hidden;position:relative;${BG("50%", "26%")};font-family:'Geist',sans-serif}
.cap{position:absolute;left:80px;top:150px;width:920px}
.eyebrow{font-family:'Geist Mono',monospace;font-size:26px;letter-spacing:5px;text-transform:uppercase;color:#8d9582;margin-bottom:26px}
h1{font-size:72px;font-weight:600;line-height:1.08;letter-spacing:-2px;color:#f2f5ea}
h1 em{font-style:normal;color:#d8f35f}
.ph{position:absolute;left:148px;top:390px;width:784px;height:1700px;border-radius:52px;border:2px solid #2a3322;overflow:hidden;box-shadow:0 50px 140px rgba(216,243,95,0.14)}
.ph img{width:100%;display:block}
</style></head><body>
<div class="cap"><div class="eyebrow">tick</div><h1>${l1}<br><em>${l2}</em></h1></div>
<div class="ph"><img src="${RAW}/${shot}.png"></div>
</body></html>`;

const banner = `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:600px;overflow:hidden;position:relative;${BG("72%", "44%")};font-family:'Geist',sans-serif}
.l{position:absolute;left:72px;top:148px;width:640px}
.row{display:flex;align-items:center;gap:20px;margin-bottom:34px}
.row img{width:68px;height:68px;border-radius:17px}
.row span{font-size:62px;font-weight:700;letter-spacing:-3px;color:#f2f5ea}
.row span i{font-style:normal;color:#d8f35f}
h1{font-size:46px;font-weight:600;line-height:1.14;letter-spacing:-1.4px;color:#f2f5ea}
h1 em{font-style:normal;color:#d8f35f}
.d{margin-top:30px;font-family:'Geist Mono',monospace;font-size:21px;letter-spacing:2px;color:#7f8774}
.ph{position:absolute;left:830px;top:56px;width:300px;height:650px;border-radius:40px;border:2px solid #2a3322;overflow:hidden;box-shadow:0 40px 110px rgba(216,243,95,0.16);transform:rotate(-4deg)}
.ph img{width:100%;display:block}
</style></head><body>
<div class="l">
<div class="row"><img src="${ICON}"><span>tick<i>.</i></span></div>
<h1>Compete in groups.<br><em>Flex your profits.</em></h1>
<div class="d">30-second markets · tick-predict.xyz</div>
</div>
<div class="ph"><img src="${RAW}/room.png"></div>
</body></html>`;

const b = await chromium.launch();
for (const [out, shot, l1, l2] of PREVIEWS) {
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  writeFileSync(`${OUT}/_tmp.html`, preview(shot, l1, l2));
  await p.goto(`file://${OUT}/_tmp.html`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/${out}.png` });
  await p.close();
  console.log(out);
}
const p = await b.newPage({ viewport: { width: 1200, height: 600 } });
writeFileSync(`${OUT}/_tmp.html`, banner);
await p.goto(`file://${OUT}/_tmp.html`);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/banner-1200x600.png` });
await p.close();
console.log("banner");
await b.close();
unlinkSync(`${OUT}/_tmp.html`);
