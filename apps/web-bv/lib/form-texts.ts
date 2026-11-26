/**
 * ML-10 (DP-241; ADR-028 D12, DP-095): which legal texts a form on this site may show, per page
 * language. Pure (no Next.js, no `@/` imports) so `node --test` covers it.
 *
 * A form is offered in a language only when that language is public on the site (`SiteLocale`,
 * read from the API, fail closed) AND its legal texts may be offered (`legalTextsFor`: English, or
 * a translation approved by the DP-095 review). Otherwise there is no form in that language:
 * never the texts of another language, never a draft.
 *
 * DP-298 (ADR-031 D1): `registry` is the API's legal texts snapshot (lib/legal-texts-api.ts), the
 * published versions; the site has no texts of its own.
 */
import {
  leadFormTextsFor,
  legalTextsFor,
  type LeadFormTexts,
  type LegalTextRegistry,
  type LegalTextSet,
} from "@dream/contracts";

import { DEFAULT_LOCALE, isRouteLocale } from "./locale-routing.ts";

/** The legal texts of a page's language when its forms may be offered there, else null. */
export function formLegalTexts(
  locale: string,
  publicLocales: readonly string[],
  registry: LegalTextRegistry,
): LegalTextSet | null {
  if (!isRouteLocale(locale)) return null;
  if (locale !== DEFAULT_LOCALE && !publicLocales.includes(locale)) return null;
  return legalTextsFor(locale, registry);
}

export type FormTextsAnswer = { status: 200; body: LeadFormTexts } | { status: 404 };

/**
 * `GET /lead-form/texts[?locale=…]` (DP-095 D-T7): the current lead form texts for a page that
 * still shows older ones. Without `locale` the English texts, exactly as before ML-10 (older pages
 * and clients; 404 while no English version is published). With it: that language's texts, or 404 where no form is offered in it. One
 * `locale` value only; anything else is a 404.
 */
export function leadFormTextsAnswer(
  search: URLSearchParams,
  publicLocales: readonly string[],
  registry: LegalTextRegistry,
): FormTextsAnswer {
  const asked = search.getAll("locale");
  if (asked.length === 0) {
    // DP-298: the published English texts; none published (or none read) is a 404 (fail closed).
    const body = leadFormTextsFor(DEFAULT_LOCALE, registry);
    return body ? { status: 200, body } : { status: 404 };
  }
  if (asked.length > 1) return { status: 404 };
  const locale = asked[0] as string;
  if (!formLegalTexts(locale, publicLocales, registry)) return { status: 404 };
  const body = leadFormTextsFor(locale, registry);
  return body ? { status: 200, body } : { status: 404 };
}
