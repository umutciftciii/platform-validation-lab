/**
 * ML-3 (DP-236): the language of a catalogue or privacy page. The catalogue exists in the
 * languages of lib/proxy-routes.ts (`CATALOGUE_LOCALES`: every language since ML-8c, each showing
 * only the products published in it, read with the page's language). DP-298 (ADR-031 D1): the
 * policy's languages are data (the versions published in the admin, read from the API), so
 * `privacyLocale` only checks the route language; the policy page itself checks the snapshot
 * inside its Suspense boundary and the proxy already answers 404 for a language without texts.
 * English content is never rendered under a Dutch address (D7).
 */
import { notFound } from "next/navigation";

import { ROUTE_LOCALES, type RouteLocale } from "@/lib/locale-routing";
import { pageLocale } from "@/lib/page-locale";
import { CATALOGUE_LOCALES } from "@/lib/proxy-routes";

/**
 * Read from the root parameter (`next/root-params`), so a page can know its language outside
 * Suspense without reading its other (request-time) parameters.
 */
async function allowed(locales: readonly RouteLocale[]): Promise<RouteLocale> {
  const locale = await pageLocale();
  if (!locales.includes(locale)) notFound();
  return locale;
}

export function catalogLocale(): Promise<RouteLocale> {
  return allowed(CATALOGUE_LOCALES);
}

export function privacyLocale(): Promise<RouteLocale> {
  return allowed(ROUTE_LOCALES);
}
