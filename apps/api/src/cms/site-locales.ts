/**
 * ML-1 (DP-073, ADR-028 D2): the languages of the sites ("SiteLocale").
 *
 * The API only reads them (dp_app has SELECT only); languages come from migrations and the
 * catalogue sync. Three uses, with publication and visibility kept apart:
 *  - lists: the admin's CMS context shows every language of the readable sites, the public
 *    sites get only their public languages;
 *  - the edit gate: content is edited, previewed, published or taken back only in a language
 *    that is enabled on its site (`assertLocaleEnabled`; CMS and catalogue);
 *  - visibility: the public reads serve published content only in a public language
 *    (`publicLocaleSet`). Dutch on BV (enabled, not public) can be prepared and published, and
 *    stays invisible to visitors until the owner opens the language (ADR-028 D14).
 */
import {
  localeEditProblem,
  localeIsPublic,
  sortSiteLocales,
  type PublicSiteLocalesResponse,
  type SiteLocale,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { CmsDb } from "./cms-content.js";

interface LocaleRow extends SiteLocale {
  siteId: string;
}

interface PlainReader {
  siteLocale: {
    findMany(args: {
      where: { siteId: { in: string[] } };
      select: typeof SELECT;
    }): PromiseLike<LocaleRow[]>;
  };
}

/** A client that can read the table: site-scoped or its transaction (CmsDb), or a test fake. */
export type LocaleReader = CmsDb | PlainReader;

const SELECT = {
  siteId: true,
  locale: true,
  enabled: true,
  public: true,
  isDefault: true,
  sortOrder: true,
} as const;

/** Every language of each site, default first. Sites without rows map to an empty list. */
export async function siteLocalesOf(
  db: LocaleReader,
  siteIds: readonly string[],
): Promise<Map<string, SiteLocale[]>> {
  const out = new Map<string, SiteLocale[]>(siteIds.map((id) => [id, []]));
  if (siteIds.length === 0) return out;
  const args = { where: { siteId: { in: [...siteIds] } }, select: SELECT };
  // Prisma's generic findMany answers exactly this select; one call shape for every reader.
  const rows = await (db as unknown as PlainReader).siteLocale.findMany(args);
  for (const { siteId, ...locale } of rows) out.get(siteId)?.push(locale);
  for (const [id, list] of out) out.set(id, sortSiteLocales(list));
  return out;
}

/** The public languages of one site (default first). */
export async function publicSiteLocales(
  db: LocaleReader,
  siteId: string,
): Promise<PublicSiteLocalesResponse> {
  const all = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
  const visible = all.filter((l) => l.enabled && l.public);
  const def = visible.find((l) => l.isDefault);
  // The database guarantees a public default for every site; without one the site is broken.
  if (!def) throw new ApiError("INTERNAL_ERROR");
  return {
    defaultLocale: def.locale,
    locales: visible.map((l) => ({ locale: l.locale, isDefault: l.isDefault })),
  };
}

/** The languages whose published content visitors of the site may see. */
export async function publicLocaleSet(db: LocaleReader, siteId: string): Promise<Set<string>> {
  const all = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
  return new Set(all.filter((l) => localeIsPublic(all, l.locale)).map((l) => l.locale));
}

/**
 * Refuses (409 CONFLICT_STATE, detail `locale`: `not_enabled`) to edit, preview, publish or take
 * back content in a language that is not enabled on the site. Whether the language is public does
 * not matter here.
 */
export async function assertLocaleEnabled(
  db: LocaleReader,
  siteId: string,
  locale: string,
): Promise<void> {
  const locales = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
  const problem = localeEditProblem(locales, locale);
  if (problem) throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: problem }]);
}
