import type { Metadata } from "next";
import { headers } from "next/headers";

import { NotFoundView } from "@/components/not-found-view";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale } from "@/lib/locale-routing";
import { NOT_FOUND_LOCALE_HEADER } from "@/lib/not-found";
import "./globals.css";

async function notFoundLocale() {
  const value = (await headers()).get(NOT_FOUND_LOCALE_HEADER);
  return isRouteLocale(value) ? value : DEFAULT_LOCALE;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: dictionary(await notFoundLocale()).notFound.title,
    robots: { index: false, follow: false },
  };
}

/**
 * COM-1: the site's 404 (HTTP 404, noindex) for every address without a page. `proxy.ts` rewrites
 * an unknown address to an address no route matches and names the requested address's language
 * in a request header; the page renders in that language's frame and the browser keeps the URL.
 */
export default async function GlobalNotFound() {
  const locale = await notFoundLocale();
  return (
    <html lang={locale}>
      <body>
        <NotFoundView locale={locale} />
      </body>
    </html>
  );
}
