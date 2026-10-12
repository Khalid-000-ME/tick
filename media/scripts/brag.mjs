/**
 * The launch video: six hard cuts, the real app in a phone, and a track built from a drone, a pad and a
 * tick on every cut (the product is called Tick, so the cuts keep time).
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const M = "/Users/khalid/Projects/colosseum/tick/media";
const O = "/Users/khalid/Projects/colosseum/tick/brag-output";
const W = 1920, H = 1080, SX = 1196, SY = 74;
const sh = (a) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a], { stdio: ["ignore", "pipe", "inherit"] });
fs.mkdirSync(`${O}/work`, { recursive: true });

const SCENES = [
  { id: "clock", src: "room", start: 7.2, dur: 2.6, line: "Thirty seconds.", kind: "big" },
  { id: "call", src: "trade", start: 6.0, dur: 3.8, line: "Call it.\nAbove or below." },
  { id: "crew", src: "room", start: 9.5, dur: 4.2, line: "Your whole group,\nsame window." },
  { id: "card", src: "card", start: 2.2, dur: 3.8, line: "Win, and the proof\nis on chain." },
  { id: "post", src: "feed", start: 2.4, dur: 3.4, line: "Post it.\nLet them see." },
  { id: "end", still: true, dur: 3.2 },
];

const xml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const base = fs.readFileSync(`${M}/build/bg.png`);

for (const s of SCENES) {
  if (s.still) continue;
  const lines = s.line.split("\n");
  const size = s.kind === "big" ? 104 : 72;
  const top = 540 - (lines.length - 1) * (size * 0.56);
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <g transform="translate(74 54) skewX(-17)">
      <rect x="6" y="16" width="7" height="20" fill="#d8f35f"/><rect x="18" y="0" width="7" height="36" fill="#d8f35f"/><rect x="30" y="8" width="7" height="28" fill="#d8f35f"/>
    </g>
    <text x="126" y="88" font-family="Helvetica,Arial" font-size="34" font-weight="700" fill="#f4f6ec" letter-spacing="-1.6">tick<tspan fill="#d8f35f">.</tspan></text>
    ${lines.map((l, i) => `<text x="120" y="${top + i * (size * 1.12)}" font-family="Helvetica,Arial" font-size="${size}" font-weight="700" fill="#f4f6ec" letter-spacing="-3">${xml(l)}</text>`).join("")}
  </svg>`;
  await sharp(base).composite([{ input: Buffer.from(art) }]).png().toFile(`${O}/work/bg-${s.id}.png`);

  const raw = `${M}/raw/${s.src}.webm`;
  const avail = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]).toString().trim()) - s.start;
  const pad = s.dur - avail;
  sh(["-loop", "1", "-i", `${O}/work/bg-${s.id}.png`, "-ss", String(s.start), "-t", String(s.dur), "-i", raw,
    "-i", `${M}/build/screen-mask.png`, "-i", `${M}/build/frame.png`, "-filter_complex",
    `[1:v]fps=30,setpts=PTS-STARTPTS${pad > 0.05 ? `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}` : ""}[v];[v][2:v]alphamerge[rv];[0:v][rv]overlay=${SX}:${SY}:shortest=1[a];[a][3:v]overlay=0:0,format=yuv420p[o]`,
    "-map", "[o]", "-t", String(s.dur), "-c:v", "libx264", "-preset", "medium", "-crf", "18", `${O}/work/${s.id}.mp4`]);
  console.log(`${s.id} ${s.dur}s`);
}

sh(["-loop", "1", "-i", `${M}/build/close.png`, "-t", "3.2", "-vf", "fps=30,format=yuv420p",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", `${O}/work/end.mp4`]);

// One piece of sound: a drone and a pad in A, a tick on every cut, and a riser into the card.
const total = SCENES.reduce((n, s) => n + s.dur, 0);
const cuts = [];
let t = 0;
for (const s of SCENES) { cuts.push(t); t += s.dur; }
const tick = cuts.map((c, i) => `sine=frequency=${i === 3 ? 1760 : 1320}:duration=0.06,adelay=${Math.round(c * 1000)}|${Math.round(c * 1000)},volume=0.10[t${i}]`);
sh([
  "-f", "lavfi", "-i", `sine=frequency=55:duration=${total}`,
  "-f", "lavfi", "-i", `sine=frequency=110:duration=${total}`,
  "-f", "lavfi", "-i", `sine=frequency=164.81:duration=${total}`,
  "-f", "lavfi", "-i", `sine=frequency=220:duration=${total}`,
  "-f", "lavfi", "-i", `sine=frequency=1200:duration=${total}`,
  "-filter_complex",
  `[0:a]volume=0.26,tremolo=f=0.5:d=0.25[bass];` +
  `[1:a]volume=0.10[bass2];` +
  `[2:a]volume=0.055,tremolo=f=0.33:d=0.4[pad1];` +
  `[3:a]volume=0.040,tremolo=f=0.25:d=0.5[pad2];` +
  `[4:a]volume='0.028*between(t,9.4,10.6)*((t-9.4)/1.2)':eval=frame,highpass=f=900[riser];` +
  `${tick.join(";")};` +
  `[bass][bass2][pad1][pad2][riser]${cuts.map((_, i) => `[t${i}]`).join("")}amix=inputs=${5 + cuts.length}:normalize=0,` +
  `afade=t=in:st=0:d=0.5,afade=t=out:st=${(total - 1.6).toFixed(2)}:d=1.6,alimiter=limit=0.9,aresample=48000[o]`,
  "-map", "[o]", "-t", String(total), `${O}/work/track.m4a`,
]);

fs.writeFileSync(`${O}/work/list.txt`, SCENES.map((s) => `file '${s.id}.mp4'`).join("\n"));
sh(["-f", "concat", "-safe", "0", "-i", `${O}/work/list.txt`, "-i", `${O}/work/track.m4a`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", `${O}/brag.mp4`]);
console.log(`brag ${total.toFixed(1)}s`);
