/**
 * ML-1 (DP-073, ADR-028 D2): the languages of a site.
 *
 * Languages are data (K-04): table "SiteLocale", one row per (site, language).
 *  - `enabled`: content in the language may be created, edited, previewed, published and taken
 *    back in the admin; a language that is not enabled is closed to all of it;
 *  - `public`: published content in the language is shown to visitors. While a language is not
 *    public its published content stays visible to authorised staff only (admin, signed preview):
 *    the public API answers 404 for it and leaves it out of the sitemap and every language list
 *    (BV: "en" public, "nl" not public until the Dutch content is complete, ADR-028 D14);
 *  - `isDefault`: the site's default language (exactly one per site, enabled and public, equal
 *    to the site's `defaultLocale`; enforced by the database).
 *
 *  - Admin: every language of the sites the caller may read, inside the CMS context
 *    (`CmsSite.locales`, read only; there is no admin action that changes a language in ML-1).
 *  - Public: `GET /api/v1/public/cms/locales` lists only the public languages of the proxy key's
 *    site.
 *  - Editing and publishing need an enabled language (`localeEditProblem`); the API refuses
 *    anything else with 409 CONFLICT_STATE, detail `{ path: "locale", rule: "not_enabled" }`.
 *    Publication and visibility are separate: whether a published page reaches visitors depends
 *    only on `public` (`localeIsPublic`).
 */
import { z } from "zod";

/** BCP 47 language tag, the rule of the database CHECKs ("en", "nl", "pt-BR"). */
export const LOCALE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const LocaleTagSchema = z.string().max(35).regex(LOCALE_TAG_PATTERN);

/** One language of a site as the admin sees it. */
export const SiteLocaleSchema = z.strictObject({
  locale: LocaleTagSchema,
  enabled: z.boolean(),
  public: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
});
export type SiteLocale = z.infer<typeof SiteLocaleSchema>;

/** One public language of a site. */
export const PublicSiteLocaleSchema = z.strictObject({
  locale: LocaleTagSchema,
  isDefault: z.boolean(),
});
export type PublicSiteLocale = z.infer<typeof PublicSiteLocaleSchema>;

/** `GET /api/v1/public/cms/locales`: the public languages of the site, default first. */
export const PublicSiteLocalesResponseSchema = z.strictObject({
  defaultLocale: LocaleTagSchema,
  locales: z.array(PublicSiteLocaleSchema).min(1),
});
export type PublicSiteLocalesResponse = z.infer<typeof PublicSiteLocalesResponseSchema>;

/** Order of language lists: the default first, then `sortOrder`, then the tag. */
export function sortSiteLocales<T extends Pick<SiteLocale, "locale" | "isDefault" | "sortOrder">>(
  locales: readonly T[],
): T[] {
  return [...locales].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.sortOrder - b.sortOrder ||
      a.locale.localeCompare(b.locale, "en"),
  );
}

export type LocaleEditProblem = "not_enabled";

/**
 * Why content in `locale` may not be created, edited, previewed, published or taken back on a
 * site with these languages, or null when it may. A language the site does not have counts as not
 * enabled. `public` plays no part here (ADR-028 D14: Dutch is published before it is public).
 */
export function localeEditProblem(
  locales: readonly Pick<SiteLocale, "locale" | "enabled">[],
  locale: string,
): LocaleEditProblem | null {
  const row = locales.find((l) => l.locale === locale);
  return row?.enabled ? null : "not_enabled";
}

/** Whether published content in `locale` is shown to visitors (enabled and public). */
export function localeIsPublic(
  locales: readonly Pick<SiteLocale, "locale" | "enabled" | "public">[],
  locale: string,
): boolean {
  const row = locales.find((l) => l.locale === locale);
  return Boolean(row?.enabled && row.public);
}
