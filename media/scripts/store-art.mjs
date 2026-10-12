/** The two fixed-size pieces the dApp Store asks for: a 512 icon with a solid background, and a 1200x600
 *  banner that sits behind the icon on the detail page, so its middle is kept clear. */
import sharp from "sharp";
await sharp("../../brand/tick-mark-square.png").resize(512, 512).flatten({ background: "#0b0d08" }).png().toFile("../store/icon-512.png");

const W = 1200, H = 600;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="62%"><stop offset="0%" stop-color="#1e2a11"/><stop offset="70%" stop-color="#090c07"/><stop offset="100%" stop-color="#060806"/></radialGradient>
    <pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r="1.2" fill="#d8f35f" fill-opacity="0.07"/></pattern>
    <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="56"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#d)"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="300" ry="180" fill="#d8f35f" fill-opacity="0.12" filter="url(#b)"/>
  <text x="68" y="${H - 150}" font-family="Helvetica,Arial" font-size="56" font-weight="700" fill="#f4f6ec" letter-spacing="-2">Compete in groups.</text>
  <text x="68" y="${H - 86}" font-family="Helvetica,Arial" font-size="56" font-weight="700" fill="#d8f35f" letter-spacing="-2">Flex your profits.</text>
  <text x="${W - 68}" y="${H - 86}" text-anchor="end" font-family="Helvetica,Arial" font-size="26" fill="#8d9784">30-second markets</text>
</svg>`;
await sharp(Buffer.from(banner)).png().toFile("../store/banner-1200x600.png");
console.log("icon and banner");
