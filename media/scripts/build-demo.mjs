/**
 * Cuts the demo together.
 *
 * Each scene is trimmed to its line of voiceover, dropped into the phone on a backdrop that already
 * carries that scene's caption (this ffmpeg has no text filter, and drawing the type with the rest of
 * the art gives better typography anyway), then the scenes are joined and the voiceover laid under.
 * The screen is composited at the size it was recorded, so nothing is scaled and the UI stays sharp.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const M = "/Users/khalid/Projects/colosseum/tick/media";
const { SX, SY } = { SX: 1196, SY: 74 };
const W = 1920, H = 1080;
const script = JSON.parse(fs.readFileSync(`${M}/voice/script.json`, "utf8"));

const CUTS = {
  landing: { start: 1.0, dur: 8.0 },
  feed: { start: 1.6, dur: 6.6 },
  markets: { start: 1.0, dur: 9.2 },
  trade: { start: 4.0, dur: 9.9 },
  groups: { start: 2.0, dur: 8.2 },
  room: { start: 4.0, dur: 8.0 },
  card: { start: 1.4, dur: 6.8 },
  close: { still: true, dur: 4.6 },
};

const sh = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: ["ignore", "pipe", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
/** Two lines at most, broken near the middle so the block stays left of the phone. */
function wrap(text) {
  const words = text.split(" ");
  if (words.length < 4) return [text];
  let best = 1, diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
    if (Math.abs(a - b) < diff && Math.max(a, b) <= 26) { diff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

const xml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;");
fs.mkdirSync(`${M}/build/scenes`, { recursive: true });

const base = fs.readFileSync(`${M}/build/bg.png`);
for (const s of script) {
  if (CUTS[s.id].still) continue;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <g transform="translate(74 54) skewX(-17)">
      <rect x="6" y="16" width="7" height="20" fill="#d8f35f"/><rect x="18" y="0" width="7" height="36" fill="#d8f35f"/><rect x="30" y="8" width="7" height="28" fill="#d8f35f"/>
    </g>
    <text x="126" y="88" font-family="Helvetica,Arial" font-size="34" font-weight="700" fill="#f4f6ec" letter-spacing="-1.6">tick<tspan fill="#d8f35f">.</tspan></text>
    ${wrap(s.caption).map((line, i) => `<text x="120" y="${520 + i * 76}" font-family="Helvetica,Arial" font-size="62" font-weight="700" fill="#f4f6ec" letter-spacing="-2">${xml(line)}</text>`).join("")}
    <rect x="120" y="${430}" width="64" height="5" rx="3" fill="#d8f35f"/>
  </svg>`;
  await sharp(base).composite([{ input: Buffer.from(overlay) }]).png().toFile(`${M}/build/bg-${s.id}.png`);
}

for (const s of script) {
  const cut = CUTS[s.id];
  const out = `${M}/build/scenes/${s.id}.mp4`;
  const short = cut.still ? 0 : cut.dur - (dur(`${M}/raw/${s.id}.webm`) - cut.start);
  if (cut.still) {
    sh(["-loop", "1", "-i", `${M}/build/close.png`, "-t", String(cut.dur), "-vf", "fps=30,format=yuv420p",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", out]);
  } else {
    sh([
      "-loop", "1", "-i", `${M}/build/bg-${s.id}.png`,
      "-ss", String(cut.start), "-t", String(cut.dur), "-i", `${M}/raw/${s.id}.webm`,
      "-i", `${M}/build/screen-mask.png`, "-i", `${M}/build/frame.png`,
      "-filter_complex",
      // A clip that runs out before its line does holds on its last frame rather than cutting away.
      `[1:v]fps=30,setpts=PTS-STARTPTS${short > 0.05 ? `,tpad=stop_mode=clone:stop_duration=${short.toFixed(2)}` : ""}[v];[v][2:v]alphamerge[rv];[0:v][rv]overlay=${SX}:${SY}:shortest=1[a];[a][3:v]overlay=0:0,format=yuv420p[o]`,
      "-map", "[o]", "-t", String(cut.dur), "-c:v", "libx264", "-preset", "medium", "-crf", "18", out,
    ]);
  }
  console.log(`${s.id.padEnd(8)} ${dur(out).toFixed(1)}s`);
}

// One soundtrack: each line placed where its scene starts, with a short lead so the picture arrives first.
let t = 0;
const inputs = [];
const delays = [];
script.forEach((s, i) => {
  const lead = CUTS[s.id].still ? 0.3 : 0.55;
  inputs.push("-i", `${M}/voice/out/${s.id}.wav`);
  delays.push(`[${i}:a]adelay=${Math.round((t + lead) * 1000)}|${Math.round((t + lead) * 1000)}[a${i}]`);
  t += CUTS[s.id].dur;
});
sh([...inputs, "-filter_complex",
  `${delays.join(";")};${script.map((_, i) => `[a${i}]`).join("")}amix=inputs=${script.length}:normalize=0,volume=1.6,aresample=48000[o]`,
  "-map", "[o]", "-t", String(t), `${M}/build/voice.m4a`]);
console.log(`voice track ${dur(`${M}/build/voice.m4a`).toFixed(1)}s, video ${t.toFixed(1)}s`);

fs.writeFileSync(`${M}/build/list.txt`, script.map((s) => `file 'scenes/${s.id}.mp4'`).join("\n"));
sh(["-f", "concat", "-safe", "0", "-i", `${M}/build/list.txt`, "-i", `${M}/build/voice.m4a`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
  "-r", "30", "-movflags", "+faststart", "-shortest", `${M}/out/tick-demo.mp4`]);
console.log(`\ndemo: ${dur(`${M}/out/tick-demo.mp4`).toFixed(1)}s  ${(fs.statSync(`${M}/out/tick-demo.mp4`).size / 1e6).toFixed(1)}MB`);
