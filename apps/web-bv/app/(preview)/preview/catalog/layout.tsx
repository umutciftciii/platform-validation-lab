import type { Metadata } from "next";
import type { ReactNode } from "react";

import { archivo } from "@/lib/fonts";
import "../../../globals.css";

export const metadata: Metadata = {
  title: "Preview · Dream Petroleum BV",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * ML-3 (DP-236): the root layout of the company catalogue preview (`/preview/catalog/...`). A
 * technical address without a language prefix (the catalogue exists in English only until
 * ML-8c): the links admin sends stay valid, the proxy never redirects it, and it is never
 * indexed or cached (next.config headers). CMS previews have their own root layout
 * (`preview/[token]/layout.tsx`, DP-250).
 */
export default function CatalogPreviewLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
