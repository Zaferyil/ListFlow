import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ListFlow — Etsy Listing Automation",
  description:
    "Generate Etsy titles, descriptions and tags for printed shirts from a design file or a Google Sheet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
