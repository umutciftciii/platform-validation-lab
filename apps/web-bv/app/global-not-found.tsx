import type { Metadata } from "next";
import { headers } from "next/headers";

import { NotFoundView } from "@/components/not-found-view";
import { archivo } from "@/lib/fonts";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale } from "@/lib/locale-routing";
import { NOT_FOUND_LOCALE_HEADER } from "@/lib/not-found";
import "./globals.css";

/**
 * Rendered per request (it reads the language header): a blocking route by design. A 404 has no
 * shell worth prerendering, and its status must be decided before anything streams.
 */
export const instant = false;

/** The language of the requested address (proxy header); the default without it. */
async function notFoundLocale() {
  const value = (await headers()).get(NOT_FOUND_LOCALE_HEADER);
  return isRouteLocale(value) ? value : DEFAULT_LOCALE;
}

/** ML-6: the title in the language of the requested address. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: dictionary(await notFoundLocale()).meta.notFound,
    robots: { index: false, follow: false },
  };
}

/**
 * DP-207 + ML-3 (DP-236): the site's 404 (HTTP 404, noindex) for every address without a page.
 * `proxy.ts` rewrites an unknown address to an address no route matches and names the language
 * of the requested address in a request header; the page renders in that language's frame
 * (`<html lang>`, published navigation and footer) and the browser keeps the requested URL.
 * Without the header (an address the proxy never saw) it is the default language.
 */
export default async function GlobalNotFound() {
  const locale = await notFoundLocale();
  return (
    <html lang={locale} className={`${archivo.variable} antialiased`}>
      <body>
        <NotFoundView locale={locale} />
      </body>
    </html>
  );
}
