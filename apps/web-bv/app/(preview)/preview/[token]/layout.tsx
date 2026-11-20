import type { Metadata } from "next";

import { archivo } from "@/lib/fonts";
import { DEFAULT_LOCALE } from "@/lib/locale-routing";
import { previewRead } from "@/lib/preview-read";
import "../../../globals.css";

export const metadata: Metadata = {
  title: "Preview · Dream Petroleum BV",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * DP-250 (ML-3): the root layout of a CMS preview (`/preview/<token>`). The address carries no
 * language (admin's signed links stay as they are), so `<html lang>` is the draft's language as
 * the API names it (the default language while the link is invalid or the API cannot answer).
 * Rendered per request and blocking by design: a preview is never prerendered, cached or indexed
 * (next.config headers), and its language must be known before the document starts.
 */
export const instant = false;

/**
 * `token` is a root parameter here, and Cache Components needs one value of it at build time.
 * The placeholder never matches the token format, so it is answered without an API read (the
 * "not available" state); real links are rendered per request.
 */
export function generateStaticParams() {
  return [{ token: "not-a-token" }];
}

export default async function CmsPreviewLayout({
  children,
  params,
}: LayoutProps<"/preview/[token]">) {
  const { token } = await params;
  const res = await previewRead(token);
  const lang = res.ok ? res.data.locale : DEFAULT_LOCALE;
  return (
    <html lang={lang} className={`${archivo.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
