/**
 * ML-3 (DP-236): the language of the page being rendered, for server components and metadata.
 *
 * Every page of the site lives under `app/[locale]`, so `locale` is a root parameter
 * (`next/root-params`). Routes outside it (the signed previews under `app/(preview)`) have no
 * language in their address: there the default language is used for fixed links (the preview's
 * own CMS links already carry their language, ML-2).
 */
import { locale as rootLocale } from "next/root-params";

import { DEFAULT_LOCALE, isRouteLocale, localizeHref, type RouteLocale } from "@/lib/locale-routing";

export async function pageLocale(): Promise<RouteLocale> {
  const value = await rootLocale();
  return isRouteLocale(value) ? value : DEFAULT_LOCALE;
}

/** `localizeHref` for the page being rendered. */
export async function pageHref(href: string): Promise<string> {
  return localizeHref(await pageLocale(), href);
}
