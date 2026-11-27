/**
 * COM-4 (DP-030): what the corporate contact form needs besides React, as pure functions shared by
 * the contact section (components/template-sections.tsx), the form route
 * (app/lead-form/contact/route.ts) and `node --test`. The rules are web-bv's (DP-151, DP-221,
 * ML-10, DP-298), reused, not rewritten:
 *
 *  - The form is offered only where the privacy texts may be published in this environment
 *    (DP-095 D-T5: locally and on staging the draft texts with a banner, in production only once
 *    approved — `privacyPublication`) AND the contact notice of the page's language may be
 *    offered (English, or an approved translation; `legalTextsFor`) AND that language is public
 *    on the site. Otherwise the section shows the form disabled under its CMS note (never a form
 *    that looks like it works). A preview proves nothing about a language: only English there.
 *  - The client IP for the API's rate limit: lib/client-ip.ts (server only).
 *  - Country names in the page's language, sorted by its collation; the value is the ISO code.
 *
 * Pure (no Next.js, no `@/` imports) so `node --test` runs it as is.
 */
import { legalTextsFor, type LegalTextRegistry, type LegalTextSet } from "@dream/contracts";

import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "./locale-routing.ts";

/** The browser posts the form here (this site); the server forwards it to the platform API. */
export const CONTACT_FORM_PATH = "/lead-form/contact";

/** A 4000-character message in any script, plus the other fields. */
export const MAX_CONTACT_BYTES = 24 * 1024;

/** The legal texts of a page's language when its form may be offered there, else null. */
export function formLegalTexts(
  locale: string,
  publicLocales: readonly string[],
  registry: LegalTextRegistry,
): LegalTextSet | null {
  if (!isRouteLocale(locale)) return null;
  if (locale !== DEFAULT_LOCALE && !publicLocales.includes(locale)) return null;
  return legalTextsFor(locale, registry);
}

export type ContactFormState =
  | { kind: "live"; notice: { version: string; text: string } }
  /** `notInLanguage`: the texts may be published, but not in this language. */
  | { kind: "disabled"; reason: "gate" | "notInLanguage" };

/** Whether the contact section of a page shows the working form, and with which notice. */
export function contactFormState(
  locale: RouteLocale,
  opts: {
    /** The privacy gate of this environment (DP-095 D-T5, DP-298 snapshot). */
    publish: boolean;
    registry: LegalTextRegistry;
    /** Public languages of the site (fail closed: the default language only). */
    publicLocales: readonly string[];
    preview: boolean;
  },
): ContactFormState {
  const legal = formLegalTexts(
    locale,
    opts.preview || locale === DEFAULT_LOCALE ? [] : opts.publicLocales,
    opts.registry,
  );
  if (!opts.publish) return { kind: "disabled", reason: "gate" };
  if (!legal) return { kind: "disabled", reason: "notInLanguage" };
  return {
    kind: "live",
    notice: { version: legal.contactNotice.version, text: legal.contactNotice.text },
  };
}

const COUNTRY_NAMES: Record<RouteLocale, string> = { en: "en", tr: "tr-TR" };

/** Country options in the page's language, sorted by its collation (value: the ISO code). */
export function countryOptions(
  locale: RouteLocale,
  codes: readonly string[],
): { code: string; name: string }[] {
  const tag = COUNTRY_NAMES[locale];
  const names = new Intl.DisplayNames([tag], { type: "region" });
  return codes
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, tag));
}
