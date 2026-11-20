import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { archivo } from "@/lib/fonts";
import { ROUTE_LOCALES, isRouteLocale } from "@/lib/locale-routing";
import "../globals.css";

// DP-207: static defaults only. noindex is the fail-closed default: a page is indexable only when
// its own metadata says so at request time (lib/seo.ts pageMetadata: production, DP_SEO_INDEXING=on
// and a public origin). Canonical URL and Open Graph come per page from the same helper.
export const metadata: Metadata = {
  title: "Dream Petroleum BV",
  applicationName: "Dream Petroleum BV",
  robots: { index: false, follow: false },
};

/**
 * ML-3 (DP-236, ADR-028 D3): the root layout of every page, one per language (`/en`, `/nl`), so
 * `<html lang>` is the page's language. Which language a visitor may see is data (`proxy.ts`
 * answers 404 under a language that is not public); the routes exist for both.
 */
export function generateStaticParams() {
  return ROUTE_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isRouteLocale(locale)) notFound();
  return (
    <html lang={locale} className={`${archivo.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
