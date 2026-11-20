/**
 * ML-2 (DP-074, ADR-028 D6): translation groups of CMS pages.
 *
 *  - `newPageId`: page ids are UUID v7 like Prisma's default; a new group needs the id before the
 *    insert (an original is the first page of its own group: translationGroupId = id).
 *  - `translationsOf`: the state of every enabled language of the site for each group (missing,
 *    draft, published, outdated) with the source revision a translation was made from.
 *  - `groupSource`: the group's source page, i.e. its page in the site's default language (the
 *    group's first page when there is none).
 *  - `pageAddress`: the public address of a stored path in a page's language (contracts
 *    `cmsLocaleAddress`); slug-change redirects and address checks are written with it.
 *
 * Plain functions over a site-scoped client, no Nest wiring.
 */
import { randomBytes } from "node:crypto";
import {
  cmsLocaleAddress,
  cmsTranslationOutdated,
  cmsTranslationState,
  sortSiteLocales,
  type CmsSite,
  type CmsTranslation,
  type SiteLocale,
} from "@dream/contracts";
import type { CmsDb } from "./cms-content.js";

/** A UUID v7 (48-bit milliseconds, version and variant bits, random rest). */
export function newPageId(nowMs: number): string {
  const b = randomBytes(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The site's default language (the database keeps exactly one). */
export function defaultLocaleOf(site: Pick<CmsSite, "locale" | "locales">): string {
  return site.locales.find((l) => l.isDefault)?.locale ?? site.locale;
}

/** The public address of a stored path of a page in `locale` on the site. */
export function pageAddress(
  site: Pick<CmsSite, "locale" | "locales">,
  locale: string,
  path: string,
): string {
  return cmsLocaleAddress(path, locale, defaultLocaleOf(site));
}

interface GroupPage {
  id: string;
  locale: string;
  title: string;
  path: string | null;
  translationGroupId: string;
  translationSourceRevisionId: string | null;
}

/** The group's source page: its page in the default language, else the group's first page. */
export function groupSource<T extends GroupPage>(
  pages: readonly T[],
  defaultLocale: string,
): T | undefined {
  return (
    pages.find((p) => p.locale === defaultLocale) ??
    pages.find((p) => p.id === p.translationGroupId)
  );
}

/**
 * The translations of each group (keyed by group id): one entry per enabled language of the
 * site, the source language first.
 */
export async function translationsOf(
  db: CmsDb,
  site: Pick<CmsSite, "id" | "locale" | "locales">,
  groupIds: readonly string[],
): Promise<Map<string, CmsTranslation[]>> {
  const out = new Map<string, CmsTranslation[]>();
  if (groupIds.length === 0) return out;
  const pages: GroupPage[] = await db.cmsPage.findMany({
    where: { siteId: site.id, translationGroupId: { in: [...new Set(groupIds)] } },
    select: {
      id: true,
      locale: true,
      title: true,
      path: true,
      translationGroupId: true,
      translationSourceRevisionId: true,
    },
  });
  const ids = pages.map((p) => p.id);
  const sourceRevIds = pages.flatMap((p) =>
    p.translationSourceRevisionId ? [p.translationSourceRevisionId] : [],
  );
  const [pubs, revisions, sources] = await Promise.all([
    ids.length
      ? db.cmsPagePublication.findMany({
          where: { pageId: { in: ids } },
          select: { pageId: true, status: true },
        })
      : [],
    ids.length
      ? db.cmsPageRevision.findMany({
          where: { pageId: { in: ids } },
          select: { pageId: true, revisionNumber: true },
        })
      : [],
    sourceRevIds.length
      ? db.cmsPageRevision.findMany({
          where: { id: { in: sourceRevIds } },
          select: { id: true, revisionNumber: true },
        })
      : [],
  ]);
  const latest = new Map<string, number>();
  for (const r of revisions) {
    latest.set(r.pageId, Math.max(latest.get(r.pageId) ?? 0, r.revisionNumber));
  }
  const defaultLocale = defaultLocaleOf(site);
  const locales = sortSiteLocales(site.locales.filter((l: SiteLocale) => l.enabled));
  for (const groupId of new Set(groupIds)) {
    const members = pages.filter((p) => p.translationGroupId === groupId);
    const source = groupSource(members, defaultLocale);
    const sourceLatest = source ? (latest.get(source.id) ?? null) : null;
    const list: CmsTranslation[] = [];
    for (const l of locales) {
      const page = members.find((p) => p.locale === l.locale);
      const isSource = page !== undefined && page.id === source?.id;
      const made = page?.translationSourceRevisionId
        ? (sources.find((s) => s.id === page.translationSourceRevisionId)?.revisionNumber ?? null)
        : null;
      const outdated =
        page !== undefined && !isSource && cmsTranslationOutdated(made, sourceLatest);
      const published = pubs.some((x) => x.pageId === page?.id && x.status === "PUBLISHED");
      list.push({
        locale: l.locale,
        pageId: page?.id ?? null,
        title: page?.title ?? null,
        path: page?.path ?? null,
        isSource: isSource || (page === undefined && l.locale === defaultLocale),
        state: cmsTranslationState({ exists: page !== undefined, published, outdated }),
        outdated,
        sourceRevisionNumber: isSource ? null : made,
        sourceLatestRevisionNumber: sourceLatest,
      });
    }
    out.set(groupId, list);
  }
  return out;
}
