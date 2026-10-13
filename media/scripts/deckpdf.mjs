import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { chromium } from "playwright";
const D = "/private/tmp/claude-501/-Users-khalid-Projects-colosseum/ee16d296-196d-47cc-986c-eafa69d1a789/scratchpad/deck/project";
const idx = JSON.parse(readFileSync(`${D}/deck.json`, "utf8"));
let body = "";
for (const id of idx.order) {
  let s = readFileSync(`${D}/slides/${id}.html`, "utf8");
  s = s.replace(/<aside>[\s\S]*?<\/aside>/g, "");
  s = s.replace(/\/_blob\/6e73796a9419edbcb5358d2a67bf6144/g, "file:///Users/khalid/Projects/colosseum/tick/media/store/deck-room.png");
  s = s.replace(/\/_blob\/00d8ccb7f1469e42322ea721764f5326/g, "file:///Users/khalid/Projects/colosseum/tick/media/store/deck-feed.png");
  s = s.replace(/\/_blob\/db863bb3917c2e738ccb86701d1c6903/g, "file:///Users/khalid/Projects/colosseum/tick/media/store/raw/trade.png");
  s = s.replace(/\/_blob\/45c2641ca6eef12bb63be77ddfa86315/g, "file:///Users/khalid/Projects/colosseum/tick/media/store/raw/groupchat.png");
  s = s.replace(/\/_blob\/150d83ef43bafdffb971c81b8e244a9c/g, "file:///Users/khalid/Projects/colosseum/tick/media/store/raw/card.png");
  s = s.replace(/\/_blob\/34ffd1eebe81929c83cd322e50bf245e/g, "file:///Users/khalid/Projects/colosseum/tick/media/store/raw/markets.png");
  body += `<div class="pg">${s}</div>`;
}
const links = Object.values(idx.faces).filter(f => f.href).map(f => `<link rel="stylesheet" href="${f.href}">`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8">${links}<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#000}
.pg{width:1920px;height:1080px;overflow:hidden;position:relative;page-break-after:always;break-after:page}
.pg>section{width:1920px;height:1080px;position:relative;overflow:hidden;box-sizing:border-box;display:flex}
h1,h2,h3,p,ul,ol{margin:0}ul,ol{padding-left:1.2em}
@page{size:1920px 1080px;margin:0}
</style></head><body>${body}</body></html>`;
writeFileSync("/tmp/deck.html", html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file:///tmp/deck.html");
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1500);
await p.pdf({ path: "/Users/khalid/Projects/colosseum/tick/submission/tick-pitch-deck.pdf", width: "1920px", height: "1080px", printBackground: true, pageRanges: `1-${idx.order.length}` });
await b.close();
console.log("ok", idx.order.length, "slides");
