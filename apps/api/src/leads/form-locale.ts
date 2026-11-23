/**
 * ML-10 (DP-241; ADR-028 D12, D14): the language of a public form.
 *
 * - The legal texts come from `@dream/contracts` (`LEGAL_TEXTS`). The registry is a provider so
 *   that a test can run the "translation approved" scenario in isolation; the module provides the
 *   shipped registry and nothing at runtime can change it.
 * - A form is accepted only in a language that is public on the proxy key's site (`SiteLocale`,
 *   enabled and public): a hidden language has no form, whatever texts exist for it.
 */
import { LEGAL_TEXTS, type LegalTextRegistry } from "@dream/contracts";
import { publicLocaleSet } from "../cms/site-locales.js";
import type { PublicSite } from "../iam/public-site.js";

export const LEAD_LEGAL_TEXTS = Symbol("LEAD_LEGAL_TEXTS");

/** The registry a service was given, or the shipped one. */
export function leadLegalTexts(registry: LegalTextRegistry | undefined): LegalTextRegistry {
  return registry ?? LEGAL_TEXTS;
}

/** Whether visitors of the site may see `locale` (fail closed for anything else). */
export async function formLocaleIsPublic(site: PublicSite, locale: string): Promise<boolean> {
  return (await publicLocaleSet(site.db, site.siteId)).has(locale);
}
