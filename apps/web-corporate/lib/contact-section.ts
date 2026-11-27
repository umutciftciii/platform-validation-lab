/**
 * COM-4 (DP-030): what the contact section of a page shows next to the published contact details
 * — the working form or the disabled one under the section's CMS note — from the API's legal
 * texts snapshot (DP-298), the privacy gate of this environment (DP-095 D-T5) and the site's
 * public languages (ML-10), by the pure rules of lib/contact-form.ts. Read only for a page that
 * has a contact section.
 */
import { COUNTRY_CODES } from "@dream/contracts";

import { contactFormState, countryOptions, type ContactFormState } from "@/lib/contact-form";
import { dictionary, type ContactFormLabels } from "@/lib/i18n";
import { DEFAULT_LOCALE, type RouteLocale } from "@/lib/locale-routing";
import { privacyLink, sitePrivacy } from "@/lib/privacy";
import { visibleLocales } from "@/lib/public-locales";
import { legalTextsSnapshot } from "@/lib/legal-texts-api";

export interface ContactSectionForm {
  state: ContactFormState;
  countries: { code: string; name: string }[];
  privacyHref: string | null;
  labels: ContactFormLabels;
}

export async function contactSectionForm(
  locale: RouteLocale,
  { preview = false }: { preview?: boolean } = {},
): Promise<ContactSectionForm> {
  const [privacy, snapshot, publicLocales, privacyHref] = await Promise.all([
    // The environment's gate (the English source texts); the page language's own notice is
    // checked by `contactFormState` (a language without one says so, not "not available").
    sitePrivacy(DEFAULT_LOCALE),
    legalTextsSnapshot(),
    visibleLocales(),
    privacyLink(locale),
  ]);
  const state = contactFormState(locale, {
    publish: privacy.gate.publish,
    registry: snapshot.registry,
    publicLocales,
    preview,
  });
  return {
    state,
    countries: state.kind === "live" ? countryOptions(locale, COUNTRY_CODES) : [],
    privacyHref,
    labels: dictionary(locale).contactForm,
  };
}
