import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Team logos come from ESPN's CDN. Without this Next refuses the host at runtime and
    // every sports card throws rather than simply missing a crest.
    remotePatterns: [
      { protocol: "https", hostname: "a.espncdn.com" },
      // Profile photos, from a short allowlist only: profiles are public and anyone can
      // write any URL into theirs. See components/Avatar.tsx.
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "i.imgur.com" },
    ],
  },
};

export default nextConfig;
