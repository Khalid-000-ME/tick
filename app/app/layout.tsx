import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_BOOTSTRAP } from "@/lib/useTheme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tick | Trade in 30 seconds. Flex your card.",
  description:
    "The world's first 30-second prediction market. Sign up, trade, and flex your card: every win becomes a verified card you can post to the feed or your group.",
};

export const viewport: Viewport = {
  themeColor: "#f4f3ed",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The bootstrap script in <head> sets data-theme on this element before React
    // hydrates, so the server HTML and the live DOM differ here by design.
    // suppressHydrationWarning covers this element's own attributes only, not its subtree.
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the stored theme before first paint. Deferring this to React would
            show the light theme for a frame and then swap, which is the flash users
            notice far more than the theme itself. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
