import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// Temporary: no official ICCSYN typeface has been supplied. The width axis gives
// the wordmark an expanded industrial voice from a single family.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

// DP-207: static defaults only. noindex is the fail-closed default: a page is indexable only when
// its own metadata says so at request time (lib/seo.ts pageMetadata: production, DP_SEO_INDEXING=on
// and a public origin). Canonical URL and Open Graph come per page from the same helper.
export const metadata: Metadata = {
  title: "Dream Petroleum BV",
  applicationName: "Dream Petroleum BV",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
