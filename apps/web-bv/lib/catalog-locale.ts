/**
 * ML-3 (DP-236): the language of a catalogue or privacy page. Those pages exist only in the
 * languages listed in lib/proxy-routes.ts (`CATALOGUE_LOCALES`, `PRIVACY_LOCALES`): the Dutch
 * catalogue text comes with ML-8c and the Dutch policy with its own approval (ADR-028 D12). The
 * proxy already answers 404 for the others; the pages check again, so English content is never
 * rendered under a Dutch address (D7).
 */
import { notFound } from "next/navigation";

import type { RouteLocale } from "@/lib/locale-routing";
import { pageLocale } from "@/lib/page-locale";
import { CATALOGUE_LOCALES, PRIVACY_LOCALES } from "@/lib/proxy-routes";

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
  return allowed(PRIVACY_LOCALES);
}
