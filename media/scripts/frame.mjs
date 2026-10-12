/**
 * The pieces the demo is composited from: a themed backdrop and a phone frame whose screen is a hole,
 * so the recording shows through it. Both are built at the finished size (1920x1080) and the screen is
 * exactly the size the scenes were recorded at, so nothing is scaled and nothing goes soft.
 */
import sharp from "sharp";

const W = 1920, H = 1080;
const SW = 430, SH = 932;           // the screen: the recording's own size
const BEZEL = 16, RADIUS = 54;
const PW = SW + BEZEL * 2, PH = SH + BEZEL * 2;
// The phone sits right of centre so the left half can carry the line being spoken.
const PX = 1180, PY = Math.round((H - PH) / 2);
export const LAYOUT = { W, H, SW, SH, SX: PX + BEZEL, SY: PY + BEZEL, RADIUS: RADIUS - BEZEL };

const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="70%" cy="46%" r="62%">
      <stop offset="0%" stop-color="#21300f"/><stop offset="55%" stop-color="#0d120a"/><stop offset="100%" stop-color="#06080620"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#060806" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.75"/>
    </linearGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.4" cy="1.4" r="1.4" fill="#d8f35f" fill-opacity="0.06"/>
    </pattern>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#060806"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <ellipse cx="${PX + PW / 2}" cy="${H / 2}" rx="360" ry="480" fill="#d8f35f" fill-opacity="0.17" filter="url(#soft)"/>
  <rect width="${W}" height="${H}" fill="url(#floor)"/>
</svg>`;

// The frame: a filled rounded rectangle with the screen punched out, so one overlay sits above the video.
const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3a4233"/><stop offset="18%" stop-color="#11140f"/><stop offset="52%" stop-color="#20261b"/>
      <stop offset="84%" stop-color="#0c0f0a"/><stop offset="100%" stop-color="#394232"/>
    </linearGradient>
    <mask id="cut">
      <rect width="${W}" height="${H}" fill="black"/>
      <rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="${RADIUS}" fill="white"/>
      <rect x="${PX + BEZEL}" y="${PY + BEZEL}" width="${SW}" height="${SH}" rx="${RADIUS - BEZEL}" fill="black"/>
    </mask>
  </defs>
  <g mask="url(#cut)"><rect width="${W}" height="${H}" fill="url(#metal)"/></g>
  <rect x="${PX + 0.75}" y="${PY + 0.75}" width="${PW - 1.5}" height="${PH - 1.5}" rx="${RADIUS}" fill="none" stroke="#000" stroke-opacity="0.9" stroke-width="1.5"/>
  <rect x="${PX + BEZEL - 1}" y="${PY + BEZEL - 1}" width="${SW + 2}" height="${SH + 2}" rx="${RADIUS - BEZEL + 1}" fill="none" stroke="#000" stroke-opacity="0.85" stroke-width="2"/>
  <!-- the camera island, and the buttons on the rails -->
  <rect x="${PX + PW / 2 - 46}" y="${PY + BEZEL + 9}" width="92" height="26" rx="13" fill="#05060400" />
  <rect x="${PX - 3}" y="${PY + 190}" width="4" height="56" rx="2" fill="#262d20"/>
  <rect x="${PX - 3}" y="${PY + 262}" width="4" height="56" rx="2" fill="#262d20"/>
  <rect x="${PX + PW - 1}" y="${PY + 232}" width="4" height="92" rx="2" fill="#262d20"/>
</svg>`;

await sharp(Buffer.from(bg)).png().toFile("../build/bg.png");
await sharp(Buffer.from(frame)).png().toFile("../build/frame.png");
// A rounded mask for the video itself, so the corners of the recording follow the screen's radius.
const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" rx="${RADIUS - BEZEL}" fill="#fff"/></svg>`;
await sharp(Buffer.from(mask)).png().toFile("../build/screen-mask.png");
console.log(JSON.stringify(LAYOUT));
