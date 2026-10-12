/** The last frame of the demo: the mark, the line, and nothing else. */
import sharp from "sharp";
const W = 1920, H = 1080;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="#1b2610"/><stop offset="70%" stop-color="#080a07"/><stop offset="100%" stop-color="#050604"/></radialGradient>
    <filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="60"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <ellipse cx="${W / 2}" cy="${H / 2 - 40}" rx="300" ry="220" fill="#d8f35f" fill-opacity="0.14" filter="url(#b)"/>
  <g transform="translate(${W / 2 - 150} ${H / 2 - 150}) skewX(-17)">
    <rect x="34" y="92" width="22" height="66" fill="#d8f35f"/><rect x="72" y="28" width="22" height="130" fill="#d8f35f"/><rect x="110" y="56" width="22" height="102" fill="#d8f35f"/>
  </g>
  <text x="${W / 2}" y="${H / 2 + 92}" text-anchor="middle" font-family="Helvetica,Arial" font-size="104" font-weight="700" fill="#f4f6ec" letter-spacing="-5">tick<tspan fill="#d8f35f">.</tspan></text>
  <text x="${W / 2}" y="${H / 2 + 164}" text-anchor="middle" font-family="Helvetica,Arial" font-size="34" fill="#aab1a0">Compete in groups. Flex your profits.</text>
  <text x="${W / 2}" y="${H - 96}" text-anchor="middle" font-family="Helvetica,Arial" font-size="26" fill="#6f7768">tick-predict.vercel.app</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile("../build/close.png");
console.log("close card");
