import type { Metadata } from "next";
import { locale as rootLocale } from "next/root-params";

import { NotFoundView } from "@/components/not-found-view";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";

async function pageLocale(): Promise<RouteLocale> {
  const value = await rootLocale();
  return isRouteLocale(value) ? value : DEFAULT_LOCALE;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: dictionary(await pageLocale()).notFound.title,
    robots: { index: false, follow: false },
  };
}

/** `notFound()` inside a page of a language (e.g. a page found unpublished at render time). */
export default async function NotFound() {
  return <NotFoundView locale={await pageLocale()} />;
}
