/**
 * Builds the pitch video package: landscape b-roll with the app in a phone, and the cards that go
 * between the talking.
 *
 * The clips are portrait because the product is a phone app; a pitch video is landscape. Rather
 * than crop the app or letterbox it, each clip is dropped into a phone on a branded backdrop at
 * 1920x1080, which is what the demo already does.
 */
import sharp from "sharp";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";

const M = "/Users/khalid/Projects/colosseum/tick/media";
const OUT = `${M}/pitch-video`;
mkdirSync(`${OUT}/broll`, { recursive: true });
mkdirSync(`${OUT}/cards`, { recursive: true });

const W = 1920, H = 1080;
const SW = 480, SH = 853;                 // the phone screen, 9:16, as the clips were recorded
const BEZEL = 15, RADIUS = 52;
const PW = SW + BEZEL * 2, PH = SH + BEZEL * 2;
const PX = Math.round((W - PW) / 2), PY = Math.round((H - PH) / 2);
const SX = PX + BEZEL, SY = PY + BEZEL;

const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="46%" r="62%">
      <stop offset="0%" stop-color="#21300f"/><stop offset="55%" stop-color="#0d120a"/><stop offset="100%" stop-color="#060806"/>
    </radialGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.4" cy="1.4" r="1.4" fill="#d8f35f" fill-opacity="0.06"/>
    </pattern>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#060806"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="330" ry="450" fill="#d8f35f" fill-opacity="0.16" filter="url(#soft)"/>
</svg>`;

const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3a4233"/><stop offset="18%" stop-color="#11140f"/><stop offset="52%" stop-color="#20261b"/>
      <stop offset="84%" stop-color="#0c0f0a"/><stop offset="100%" stop-color="#394232"/>
    </linearGradient>
    <mask id="cut">
      <rect width="${W}" height="${H}" fill="black"/>
      <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="${RADIUS}" fill="white"/>
      <rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="${RADIUS - BEZEL}" fill="black"/>
    </mask>
  </defs>
  <g mask="url(#cut)"><rect width="${W}" height="${H}" fill="url(#metal)"/></g>
  <rect x="${PX + 0.75}" y="${PY + 0.75}" width="${PW - 1.5}" height="${PH - 1.5}" rx="${RADIUS}" fill="none" stroke="#000" stroke-opacity="0.9" stroke-width="1.5"/>
  <rect x="${PX - 3}" y="${PY + 180}" width="4" height="54" rx="2" fill="#262d20"/>
  <rect x="${PX - 3}" y="${PY + 250}" width="4" height="54" rx="2" fill="#262d20"/>
  <rect x="${PX + PW - 1}" y="${PY + 220}" width="4" height="90" rx="2" fill="#262d20"/>
</svg>`;

await sharp(Buffer.from(bg)).png().toFile(`${M}/build/pv-bg.png`);
await sharp(Buffer.from(frame)).png().toFile(`${M}/build/pv-frame.png`);
// A rounded mask so the corners of the recording follow the screen's corners.
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" rx="${RADIUS - BEZEL}" fill="#fff"/></svg>`))
  .png().toFile(`${M}/build/pv-mask.png`);

/** Drop one portrait clip into the phone, trimmed to the piece worth showing. */
function broll(src, out, { start = 0, duration = null } = {}) {
  const args = [
    "-y", "-v", "error",
    "-loop", "1", "-i", `${M}/build/pv-bg.png`,
    ...(start ? ["-ss", String(start)] : []), ...(duration ? ["-t", String(duration)] : []),
    "-i", `${M}/pitch/clips/${src}`,
    "-i", `${M}/build/pv-mask.png`,
    "-i", `${M}/build/pv-frame.png`,
    "-filter_complex",
    `[1:v]scale=${SW}:${SH},fps=30,setpts=PTS-STARTPTS[v];[v][2:v]alphamerge[rv];` +
    `[0:v][rv]overlay=${SX}:${SY}:shortest=1[a];[a][3:v]overlay=0:0,format=yuv420p[o]`,
    "-map", "[o]", "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-profile:v", "high", "-movflags", "+faststart", "-an", `${OUT}/broll/${out}`,
  ];
  execFileSync("ffmpeg", args);
  console.log(`broll/${out}`);
}

broll("00-privy-login.mp4", "01-signup-to-stake.mp4", { start: 60, duration: 34 });
broll("01-stake.mp4", "02-calling-a-window.mp4", { start: 8, duration: 26 });
broll("02-post-card.mp4", "03-posting-the-card.mp4", { start: 6, duration: 22 });
broll("04-room.mp4", "04-the-room.mp4", { duration: 20 });
broll("07-card.mp4", "05-the-card.mp4", { duration: 15 });
broll("10-leaderboard.mp4", "06-the-board.mp4", { duration: 13 });

/* ---------- the cards ---------- */

const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Geist+Pixel&display=swap">`;
const SHELL = (body, extra = "") => `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1080px;overflow:hidden;position:relative;background:#080a07;
background-image:radial-gradient(ellipse 66% 60% at 50% 44%, #1e2d11 0%, #0c1109 56%, #070907 100%);
font-family:'Geist',sans-serif;color:#eef1e6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px}
.mark{display:flex;gap:11px;align-items:center;transform:skew(-17deg)}
.mark i{width:17px;height:92px;background:#d8f35f;border-radius:2px}
.mark i:first-child{height:48px;align-self:flex-end}.mark i:last-child{height:64px;align-self:flex-start}
h1{font-size:150px;font-weight:700;letter-spacing:-7px;line-height:1}
h1 em{font-style:normal;color:#d8f35f}
h2{font-size:84px;font-weight:600;letter-spacing:-3px;line-height:1.08;text-align:center;max-width:1500px}
h2 em{font-style:normal;color:#d8f35f}
p.sub{font-size:40px;color:#c9cebd;text-align:center;max-width:1300px;line-height:1.35}
.mono{font-family:'Geist Mono',monospace;font-size:26px;letter-spacing:4px;text-transform:uppercase;color:#8d9582}
.dom{position:absolute;bottom:58px;font-family:'Geist Mono',monospace;font-size:24px;letter-spacing:3px;color:#79816d}
${extra}</style></head><body>${body}</body></html>`;

const cards = {
  "01-title": SHELL(`
    <div style="display:flex;align-items:center;gap:26px"><span class="mark"><i></i><i></i><i></i></span><h1>tick<em>.</em></h1></div>
    <p class="sub" style="font-size:52px;color:#eef1e6">Compete in groups. <em style="font-style:normal;color:#d8f35f">Flex your profits.</em></p>
    <div class="dom">tick-predict.xyz</div>`),

  "02-khalid": SHELL(`
    <div style="display:flex;align-items:center;gap:56px">
      <img src="team/khalid.png" style="width:300px;height:300px;border-radius:150px;object-fit:cover;border:3px solid #3b4a30">
      <div style="display:flex;flex-direction:column;gap:16px">
        <h2 style="text-align:left;font-size:92px">Khalid</h2>
        <p style="font-size:32px;color:#c9cebd;max-width:780px;line-height:1.35">Multiple global web3 hackathon wins. Built Tick solo: contracts, settlement, the app, the indexer and the Android build.</p>
      </div>
    </div>`),

  "04-problem": SHELL(`
    <p class="mono">The problem</p>
    <h2>The fastest market anyone runs takes <em>five minutes</em>. And you play it alone.</h2>
    <div style="display:flex;gap:120px;margin-top:20px">
      ${[["5 min", "the quickest window today"], ["1", "players in the room"], ["0", "proof worth sharing"]]
        .map(([n, l]) => `<div style="display:flex;flex-direction:column;gap:10px;align-items:center">
          <p style="font-size:92px;font-weight:650;letter-spacing:-3px;color:#d8f35f">${n}</p>
          <p style="font-size:28px;color:#9aa58a">${l}</p></div>`).join("")}
    </div>`),

  "05-answer": SHELL(`
    <p class="mono">What we built</p>
    <h2>Thirty seconds. Your crew. <em>A card that proves it.</em></h2>
    <div style="display:flex;gap:90px;margin-top:20px">
      ${[["30s", "to a settled result"], ["10x", "faster than anyone else"], ["$0.10", "to take a side"], ["2%", "fee, on profit only"]]
        .map(([n, l]) => `<div style="display:flex;flex-direction:column;gap:10px;align-items:center">
          <p style="font-size:84px;font-weight:650;letter-spacing:-3px;color:#d8f35f">${n}</p>
          <p style="font-size:26px;color:#9aa58a">${l}</p></div>`).join("")}
    </div>`),

  "06-honest": SHELL(`
    <p class="mono">What we will not pretend</p>
    <h2 style="font-size:66px;max-width:1560px">Testnet only. Demand is <em>inferred, not proven</em>. A one-sided window still voids.</h2>
    <p class="sub" style="font-size:34px">Six wallets, 38 stakes, and the cards got posted without us asking. Early signal, not traction.</p>`),

  "07-close": SHELL(`
    <div style="display:flex;align-items:center;gap:26px"><span class="mark"><i></i><i></i><i></i></span><h1>tick<em>.</em></h1></div>
    <p class="sub" style="font-size:46px">Come call thirty seconds with us.</p>
    <div class="dom">tick-predict.xyz · live on Monad testnet</div>`),
};

const browser = await chromium.launch();
for (const [name, html] of Object.entries(cards)) {
  writeFileSync(`${M}/store/_card.html`, html);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`file://${M}/store/_card.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/cards/${name}.png` });
  await page.close();
  console.log(`cards/${name}.png`);
}
await browser.close();
unlinkSync(`${M}/store/_card.html`);
console.log("done");
