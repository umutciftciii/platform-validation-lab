/**
 * ML-10 (DP-241; ADR-028 D12, D14): the language of a public form.
 *
 * - DP-298 (ADR-031): the legal texts are the published versions in the database (LegalTextsService).
 *   `LEAD_LEGAL_TEXTS` stays an optional provider so a unit test can pin a registry; the module no
 *   longer provides one.
 * - A form is accepted only in a language that is public on the proxy key's site (`SiteLocale`,
 *   enabled and public): a hidden language has no form, whatever texts exist for it.
 */
import { publicLocaleSet } from "../cms/site-locales.js";
import type { PublicSite } from "../iam/public-site.js";

export const LEAD_LEGAL_TEXTS = Symbol("LEAD_LEGAL_TEXTS");

/** Whether visitors of the site may see `locale` (fail closed for anything else). */
export async function formLocaleIsPublic(site: PublicSite, locale: string): Promise<boolean> {
  return (await publicLocaleSet(site.db, site.siteId)).has(locale);
}
