import type { MetadataRoute } from "next";

/**
 * Makes Tick installable: on Android, Chrome offers Install app (a real home-screen app with no
 * browser bar), and the native shell in /mobile opens the same site. start_url is the feed, which is
 * the app's home, not the landing page, so an installed app opens straight into the product.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tick",
    short_name: "Tick",
    description: "Trade in 30 seconds. Flex your card.",
    start_url: "/feed",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d08",
    theme_color: "#0b0d08",
    categories: ["finance", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Feed", url: "/feed", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Groups", url: "/groups", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Markets", url: "/markets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
