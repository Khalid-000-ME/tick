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
  title: "Tick — a market for the next thirty seconds",
  description:
    "30-second price markets on Monad, settled by reading Pyth. A stake is only accepted while the on-chain price is fresh — nobody referees the outcome.",
};

export const viewport: Viewport = {
  themeColor: "#f4f3ed",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
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
