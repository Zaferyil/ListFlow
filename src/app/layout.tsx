import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ListFlow — Etsy Listing Automation",
  description:
    "Generate Etsy titles, descriptions and tags for printed shirts from a design file or a Google Sheet.",
  // What iOS puts under the icon once the app is on the home screen. Without
  // it the phone uses the full title, which is truncated to a few characters.
  applicationName: "ListFlow",
  appleWebApp: { capable: true, title: "ListFlow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // Tints the status bar to match the header rather than leaving it white.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#6c4bd8" },
    { media: "(prefers-color-scheme: dark)", color: "#131120" },
  ],
  // The app has its own sizing; letting the phone zoom out to a desktop width
  // makes every control too small to press.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
