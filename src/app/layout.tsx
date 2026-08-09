import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ListFlow — Etsy Listing Otomasyonu",
  description:
    "Tasarim yukleyin veya Google Sheet'ten nis cekin; ListFlow baslik, aciklama ve etiketleri uretsin.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
