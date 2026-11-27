import type { Metadata } from "next";

import { fontVariables } from "@/lib/fonts";
import { DEFAULT_LOCALE } from "@/lib/locale-routing";
import { previewRead } from "@/lib/preview-read";
import "../../../globals.css";

export const metadata: Metadata = {
  title: "Preview · Dream Petroleum",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * COM-2a (DP-321): the root layout of a corporate CMS preview (`/preview/<token>`), as web-bv's
 * (DP-250): the address carries no language, so `<html lang>` is the draft's language as the API
 * names it (the default language while the link is invalid or the API cannot answer). Rendered
 * per request; never cached or indexed (next.config headers, proxy.ts leaves it alone).
 */
export default async function PreviewLayout({ children, params }: LayoutProps<"/preview/[token]">) {
  const { token } = await params;
  const res = await previewRead(token);
  const lang = res.ok ? res.data.locale : DEFAULT_LOCALE;
  return (
    <html lang={lang} className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
