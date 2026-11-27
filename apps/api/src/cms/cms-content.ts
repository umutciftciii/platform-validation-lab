/**
 * Shared rules of CMS content (S1/S2, ADR-020): which schema validates a page, how rows map to
 * the contracts, and the signed preview token.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CmsArticleContentSchema,
  CmsTemplateContentSchema,
  cmsArticleContentSchema,
  cmsDesignTemplate,
  cmsArticleDate,
  cmsIsArticle,
  cmsSlugOfPath,
  cmsFieldsSchema,
  cmsSiteAsset,
  cmsTemplateContentSchema,
  type CmsPage,
  type CmsPageSummary,
  type CmsSeo,
  type CmsSeoValue,
  type CmsPublication,
  type CmsPublicPage,
  type CmsMenuLinkWarning,
  type CmsStructureWarning,
  type CmsSiteKey,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import type { ScopedTx } from "../catalog/master.js";

/**
 * The site-scoped client refuses to-one relations into site-bound models (site-scope.ts, deny by
 * default), so a page, its publication and its revisions are read with separate queries by id
 * and joined here. Every query runs inside the caller's site scope.
 */
export type CmsDb = SiteScopedClient | ScopedTx;

export async function attachPublications(db: CmsDb, rows: PageBase[]): Promise<PageRow[]> {
  if (rows.length === 0) return [];
  const pubs = await db.cmsPagePublication.findMany({
    where: { pageId: { in: rows.map((r) => r.id) } },
    select: {
      pageId: true,
      revisionId: true,
      status: true,
      publishedAt: true,
      unpublishedAt: true,
      version: true,
      publishedBy: USER,
      unpublishedBy: USER,
    },
  });
  const revisions = pubs.length
    ? await db.cmsPageRevision.findMany({
        where: { id: { in: pubs.map((p) => p.revisionId) } },
        select: { id: true, revisionNumber: true, pageVersion: true, path: true },
      })
    : [];
  return rows.map((row) => {
    const p = pubs.find((x) => x.pageId === row.id);
    const r = p ? revisions.find((x) => x.id === p.revisionId) : undefined;
    return {
      ...row,
      publication:
        p && r
          ? {
              status: p.status,
              publishedAt: p.publishedAt,
              unpublishedAt: p.unpublishedAt,
              version: p.version,
              publishedBy: p.publishedBy,
              unpublishedBy: p.unpublishedBy,
              revision: {
                revisionNumber: r.revisionNumber,
                pageVersion: r.pageVersion,
                path: r.path,
              },
            }
          : null,
    };
  });
}

// --- SEO columns (ADR-020 D-S1, DP-209) ------------------------------------------------------------

/** The SEO columns a page and its revisions share (DP-209 adds canonical and Open Graph). */
export const SEO_SELECT = {
  seoTitle: true,
  seoDescription: true,
  noindex: true,
  canonicalPath: true,
  ogTitle: true,
  ogDescription: true,
  ogImage: true,
} as const;

export interface SeoColumns {
  seoTitle: string | null;
  seoDescription: string | null;
  noindex: boolean;
  canonicalPath: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}

/** The columns of a validated SEO request (contracts `CmsSeoSchema` output). */
export function seoColumns(seo: CmsSeo): SeoColumns {
  return {
    seoTitle: seo.title,
    seoDescription: seo.description,
    noindex: seo.noindex,
    canonicalPath: seo.canonicalPath,
    ogTitle: seo.ogTitle,
    ogDescription: seo.ogDescription,
    ogImage: seo.ogImage,
  };
}

/** Exactly the SEO columns of a row (publication and restore copy them unchanged). */
export function pickSeo(row: SeoColumns): SeoColumns {
  return {
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    noindex: row.noindex,
    canonicalPath: row.canonicalPath,
    ogTitle: row.ogTitle,
    ogDescription: row.ogDescription,
    ogImage: row.ogImage,
  };
}

/** The SEO of a stored page or revision as the API answers it. */
export function seoValue(row: SeoColumns): CmsSeoValue {
  return {
    title: row.seoTitle,
    description: row.seoDescription,
    noindex: row.noindex,
    canonicalPath: row.canonicalPath,
    ogTitle: row.ogTitle,
    ogDescription: row.ogDescription,
    ogImage: row.ogImage,
  };
}

export interface LiveRow {
  pageId: string;
  publishedAt: Date;
  /** DP-020: when revision 1 was published (the date an article shows). */
  firstPublishedAt: Date;
  /**
   * ML-1: `locale` lets the public reads drop languages that are not public. ML-2: the group
   * links a page to its other languages (menus resolve a page reference per language).
   */
  page: { kind: CmsPage["kind"]; templateKey: string; locale: string; translationGroupId: string };
  revision: {
    revisionNumber: number;
    title: string;
    path: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    noindex: boolean;
    canonicalPath: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    content: unknown;
  };
}

/** The PUBLISHED revisions of a site (one per live page), joined with their page's kind. */
export async function liveRows(db: CmsDb, siteId: string): Promise<LiveRow[]> {
  const pubs = await db.cmsPagePublication.findMany({
    where: { siteId, status: "PUBLISHED" },
    select: { pageId: true, revisionId: true, publishedAt: true },
  });
  if (pubs.length === 0) return [];
  const [revisions, pages, firsts] = await Promise.all([
    db.cmsPageRevision.findMany({
      where: { id: { in: pubs.map((p) => p.revisionId) } },
      select: {
        id: true,
        revisionNumber: true,
        title: true,
        path: true,
        ...SEO_SELECT,
        content: true,
      },
    }),
    db.cmsPage.findMany({
      where: { id: { in: pubs.map((p) => p.pageId) } },
      select: { id: true, kind: true, templateKey: true, locale: true, translationGroupId: true },
    }),
    db.cmsPageRevision.findMany({
      where: { pageId: { in: pubs.map((p) => p.pageId) }, revisionNumber: 1 },
      select: { pageId: true, createdAt: true },
    }),
  ]);
  const out: LiveRow[] = [];
  for (const p of pubs) {
    const r = revisions.find((x) => x.id === p.revisionId);
    const page = pages.find((x) => x.id === p.pageId);
    if (r && page) {
      const { id: _id, ...revision } = r;
      void _id;
      const first = firsts.find((x) => x.pageId === p.pageId)?.createdAt ?? p.publishedAt;
      out.push({
        pageId: p.pageId,
        publishedAt: p.publishedAt,
        firstPublishedAt: first,
        page,
        revision,
      });
    }
  }
  return out;
}

export const USER = { select: { id: true, displayName: true } } as const;

export const PAGE_SELECT = {
  id: true,
  siteId: true,
  kind: true,
  templateKey: true,
  path: true,
  locale: true,
  translationGroupId: true,
  translationSourceRevisionId: true,
  title: true,
  ...SEO_SELECT,
  content: true,
  schemaVersion: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  createdBy: USER,
  updatedBy: USER,
} as const;

export interface UserRow {
  id: string;
  displayName: string | null;
}
export interface PublicationRow {
  status: "PUBLISHED" | "UNPUBLISHED";
  publishedAt: Date;
  unpublishedAt: Date | null;
  version: number;
  publishedBy: UserRow;
  unpublishedBy: UserRow | null;
  revision: { revisionNumber: number; pageVersion: number; path: string | null };
}
/** A page row as selected with PAGE_SELECT, before its publication is attached. */
export type PageBase = Omit<PageRow, "publication">;

export interface PageRow {
  id: string;
  siteId: string;
  kind: CmsPage["kind"];
  templateKey: string;
  path: string | null;
  locale: string;
  /** ML-2 (ADR-028 D6). */
  translationGroupId: string;
  translationSourceRevisionId: string | null;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  noindex: boolean;
  canonicalPath: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  content: unknown;
  schemaVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: UserRow;
  updatedBy: UserRow;
  publication: PublicationRow | null;
}

export const userRef = (u: UserRow) => ({ id: u.id, name: u.displayName ?? "Staff user" });

export function asObject(content: unknown): Record<string, unknown> {
  return content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
}

/** Sections of a TEMPLATE page; top-level fields of a designed page or fragment. */
export function partCount(kind: CmsPage["kind"], content: unknown): number {
  const obj = asObject(content);
  if (kind === "TEMPLATE") return Array.isArray(obj["sections"]) ? obj["sections"].length : 0;
  return Object.keys(obj).length;
}

function toPublication(p: PublicationRow | null): CmsPublication | null {
  if (!p) return null;
  return {
    status: p.status,
    revisionNumber: p.revision.revisionNumber,
    pageVersion: p.revision.pageVersion,
    path: p.revision.path,
    publishedAt: p.publishedAt.toISOString(),
    publishedBy: userRef(p.publishedBy),
    unpublishedAt: p.unpublishedAt?.toISOString() ?? null,
    unpublishedBy: p.unpublishedBy ? userRef(p.unpublishedBy) : null,
    version: p.version,
  };
}

export function toSummary(row: PageRow): CmsPageSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    templateKey: row.templateKey,
    path: row.path,
    title: row.title,
    locale: row.locale,
    sectionCount: partCount(row.kind, row.content),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: userRef(row.updatedBy),
    publication: toPublication(row.publication),
    translationGroupId: row.translationGroupId,
    translations: [],
  };
}

/** DP-210: the page's older addresses (active redirects to it) and the site's redirect rule. */
export interface PageAddresses {
  redirectsHere: string[];
  keepsOldAddress: boolean;
  /** ML-2: structure differences from the group's source page (translations only). */
  structureWarnings?: CmsStructureWarning[];
  /** ML-7: links of a menu draft that the site will not show as links in its language. */
  menuWarnings?: CmsMenuLinkWarning[];
}

export function toPage(row: PageRow, addresses: PageAddresses): CmsPage {
  return {
    ...toSummary(row),
    slug: row.kind === "TEMPLATE" && row.path ? cmsSlugOfPath(row.path) : null,
    seo: seoValue(row),
    redirectsHere: addresses.redirectsHere,
    keepsOldAddress: addresses.keepsOldAddress,
    content: asObject(row.content),
    createdAt: row.createdAt.toISOString(),
    createdBy: userRef(row.createdBy),
    structureWarnings: addresses.structureWarnings ?? [],
    menuWarnings: addresses.menuWarnings ?? [],
  };
}

/**
 * The schema of a page's content: news articles (DP-020) their article fields and sections, other
 * TEMPLATE pages their section list, designed pages and fragments their template.
 */
function schemaFor(kind: CmsPage["kind"], templateKey: string, site?: CmsSiteKey) {
  // COM-2a (DP-320): with the page's site, its images must be that site's files (and an image the
  // site may leave empty may be empty); without it the shape alone.
  if (cmsIsArticle({ kind, templateKey })) {
    return site ? cmsArticleContentSchema(site) : CmsArticleContentSchema;
  }
  if (kind === "TEMPLATE") return site ? cmsTemplateContentSchema(site) : CmsTemplateContentSchema;
  const template = cmsDesignTemplate(templateKey);
  if (!template) return null;
  // DP-219: the menus have a schema of their own (version 1 content is read as version 2).
  return template.schema ?? cmsFieldsSchema(template.fields, site);
}

/**
 * Validates content for a page; throws 400 VALIDATION_FAILED with `content.<path>` details (as the
 * draft request does), or 409 when the page has no editable template yet.
 */
export function validateContent(
  kind: CmsPage["kind"],
  templateKey: string,
  content: unknown,
  site?: CmsSiteKey,
): Record<string, unknown> {
  const schema = schemaFor(kind, templateKey, site);
  if (!schema) throw new ApiError("CONFLICT_STATE", [{ path: "kind", rule: "not_editable_yet" }]);
  const parsed = schema.safeParse(content);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      parsed.error.issues.slice(0, 50).map((i) => ({
        path: ["content", ...i.path.map(String)].join(".").slice(0, 200),
        rule: i.code,
      })),
    );
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * COM-2a (DP-320): a page's link-preview image (`seo.ogImage`) must be a file of its own site;
 * 400 VALIDATION_FAILED `seo.ogImage` otherwise (as the request schema reports it).
 */
export function assertSiteImage(src: string | null, site: CmsSiteKey): void {
  if (src !== null && cmsSiteAsset(src, site)?.kind !== "image") {
    throw new ApiError("VALIDATION_FAILED", [{ path: "seo.ogImage", rule: "asset" }]);
  }
}

/**
 * ML-13a (DP-244): the dot paths of the content's schema issues (empty: valid), or null when the
 * page has no editable template. A translation draft may hold empty texts; the translation
 * package import uses this to refuse only the texts it would make invalid itself.
 */
export function contentIssuePaths(
  kind: CmsPage["kind"],
  templateKey: string,
  content: unknown,
  site?: CmsSiteKey,
): string[] | null {
  const schema = schemaFor(kind, templateKey, site);
  if (!schema) return null;
  const parsed = schema.safeParse(content);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.map(String).join("."));
}

/** The same check without throwing: for content read back from the database. */
export function contentIsValid(
  kind: CmsPage["kind"],
  templateKey: string,
  content: unknown,
  site?: CmsSiteKey,
): boolean {
  const schema = schemaFor(kind, templateKey, site);
  return Boolean(schema?.safeParse(content).success);
}

/** JSON with sorted keys: jsonb does not keep the key order of the request. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)))
      : v,
  );
}

export function publicPage(
  row: {
    kind: CmsPage["kind"];
    templateKey: string;
    path: string | null;
    title: string;
    seoTitle: string | null;
    seoDescription: string | null;
    noindex: boolean;
    canonicalPath: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    content: unknown;
  },
  revision: { revisionNumber: number; publishedAt: Date; firstPublishedAt: Date } | null,
): CmsPublicPage {
  return {
    kind: row.kind,
    templateKey: row.templateKey,
    path: row.path,
    title: row.title,
    seo: seoValue(row),
    content: asObject(row.content),
    revisionNumber: revision?.revisionNumber ?? null,
    publishedAt: revision?.publishedAt.toISOString() ?? null,
    firstPublishedAt: articleDate(row, revision),
  };
}

/**
 * The date of a page as the sites show it: revision 1's publication; COM-5 (DP-327) an article's
 * original date where it has one (in a preview too).
 */
function articleDate(
  row: { kind: CmsPage["kind"]; templateKey: string; content: unknown },
  revision: { firstPublishedAt: Date } | null,
): string | null {
  const first = revision?.firstPublishedAt.toISOString() ?? null;
  if (!cmsIsArticle(row)) return first;
  const original = asObject(row.content)["originalDate"];
  if (typeof original !== "string") return first;
  const date = cmsArticleDate(original, first ?? "");
  return date === "" ? null : date;
}

// --- preview tokens -------------------------------------------------------------------------------

/** How long a preview link works. */
export const PREVIEW_TTL_MS = 15 * 60_000;

const TOKEN = /^v1\.([0-9a-f-]{36})\.(BV|CORPORATE)\.(\d{10,13})\.([0-9a-f]{64})$/;

function previewMac(key: Buffer, pageId: string, siteKey: string, exp: number): string {
  return createHmac("sha256", key)
    .update("dp:cms_preview\0")
    .update(`${pageId}\0${siteKey}\0${exp}`, "utf8")
    .digest("hex");
}

/** `v1.<pageId>.<site>.<expiry ms>.<HMAC>`: bound to one page and one site, valid for 15 min. */
export function issuePreviewToken(key: Buffer, pageId: string, siteKey: string, now: Date) {
  const exp = now.getTime() + PREVIEW_TTL_MS;
  return {
    token: `v1.${pageId}.${siteKey}.${exp}.${previewMac(key, pageId, siteKey, exp)}`,
    expiresAt: new Date(exp),
  };
}

/** The page id of a valid, unexpired token for this site; null for anything else. */
export function verifyPreviewToken(
  key: Buffer,
  token: string,
  siteKey: string,
  now: Date,
): string | null {
  const m = TOKEN.exec(token);
  if (!m) return null;
  const [, pageId, site, expRaw, mac] = m as unknown as [string, string, string, string, string];
  const exp = Number(expRaw);
  const expected = Buffer.from(previewMac(key, pageId, site, exp), "hex");
  const given = Buffer.from(mac, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (site !== siteKey || exp <= now.getTime() || exp > now.getTime() + PREVIEW_TTL_MS) return null;
  return pageId;
}
