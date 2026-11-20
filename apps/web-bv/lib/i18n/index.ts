/**
 * ML-6 (DP-138, ADR-028 D11): the site UI dictionaries and the locale formats of the BV site.
 *
 * Dependency-free and pure (no Next.js, no `@/` imports, no "use client"): server components,
 * client components and `node --test` import it as is. Client components get their part of the
 * dictionary as a prop (plain strings) plus the page's locale for plural rules and formats.
 *
 *  - `dictionary(locale)`: the typed dictionary of a language (`en` is the source of the type).
 *  - `interpolate("…{name}…", { name })`: fills placeholders; an unknown placeholder stays visible
 *    as written (never an empty string), so a missing value shows up in review.
 *  - `plural(locale, { one, other }, count)`: CLDR plural rules (`Intl.PluralRules`), `{count}`
 *    filled with the locale's number format.
 *  - `intlLocale` / `formatDate` / `formatTime` / `formatNumber` / `countryOptions` /
 *    `formatRelative`: `en-GB` and `nl-NL`; dates in Europe/Amsterdam.
 */
import { en, type Dictionary } from "./en.ts";
import { nl } from "./nl.ts";
import type { SiteLocale } from "./format.ts";

export type { Dictionary } from "./en.ts";
export * from "./format.ts";

const DICTIONARIES: Record<SiteLocale, Dictionary> = { en, nl };

/** The UI dictionary of a language; English for anything that is not a site language. */
export function dictionary(locale: string): Dictionary {
  return DICTIONARIES[locale as SiteLocale] ?? en;
}

/** The words of the document request form (a client component gets them as one prop). */
export function leadFormUi(locale: string) {
  const d = dictionary(locale);
  const { select, sending, website, readPrivacyPolicy } = d.common;
  return { ...d.leadForm, select, sending, website, readPrivacyPolicy };
}
export type LeadFormUi = ReturnType<typeof leadFormUi>;

/** The words of the contact form (a client component gets them as one prop). */
export function contactFormUi(locale: string) {
  const d = dictionary(locale);
  const { select, sending, website, readPrivacyPolicy } = d.common;
  return { ...d.contactForm, select, sending, website, readPrivacyPolicy };
}
export type ContactFormUi = ReturnType<typeof contactFormUi>;
