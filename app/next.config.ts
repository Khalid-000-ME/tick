import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Team logos come from ESPN's CDN. Without this Next refuses the host at runtime and
    // every sports card throws rather than simply missing a crest.
    remotePatterns: [{ protocol: "https", hostname: "a.espncdn.com" }],
  },
};

export default nextConfig;
