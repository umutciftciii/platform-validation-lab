/**
 * Shared rules of CMS content (S1/S2, ADR-020): which schema validates a page, how rows map to
 * the contracts, and the signed preview token.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CmsTemplateContentSchema,
  cmsDesignTemplate,
  cmsFieldsSchema,
  type CmsPage,
  type CmsPageSummary,
  type CmsPublication,
  type CmsPublicPage,
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
        select: { id: true, revisionNumber: true, pageVersion: true },
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
              revision: { revisionNumber: r.revisionNumber, pageVersion: r.pageVersion },
            }
          : null,
    };
  });
}

export interface LiveRow {
  pageId: string;
  publishedAt: Date;
  page: { kind: CmsPage["kind"]; templateKey: string };
  revision: {
    revisionNumber: number;
    title: string;
    path: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    noindex: boolean;
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
  const [revisions, pages] = await Promise.all([
    db.cmsPageRevision.findMany({
      where: { id: { in: pubs.map((p) => p.revisionId) } },
      select: {
        id: true,
        revisionNumber: true,
        title: true,
        path: true,
        seoTitle: true,
        seoDescription: true,
        noindex: true,
        content: true,
      },
    }),
    db.cmsPage.findMany({
      where: { id: { in: pubs.map((p) => p.pageId) } },
      select: { id: true, kind: true, templateKey: true },
    }),
  ]);
  const out: LiveRow[] = [];
  for (const p of pubs) {
    const r = revisions.find((x) => x.id === p.revisionId);
    const page = pages.find((x) => x.id === p.pageId);
    if (r && page) {
      const { id: _id, ...revision } = r;
      void _id;
      out.push({ pageId: p.pageId, publishedAt: p.publishedAt, page, revision });
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
  title: true,
  seoTitle: true,
  seoDescription: true,
  noindex: true,
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
  revision: { revisionNumber: number; pageVersion: number };
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
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  noindex: boolean;
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

function asObject(content: unknown): Record<string, unknown> {
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
  };
}

export function toPage(row: PageRow): CmsPage {
  return {
    ...toSummary(row),
    slug: row.kind === "TEMPLATE" && row.path ? row.path.slice(1) : null,
    seo: { title: row.seoTitle, description: row.seoDescription, noindex: row.noindex },
    content: asObject(row.content),
    createdAt: row.createdAt.toISOString(),
    createdBy: userRef(row.createdBy),
  };
}

/** The schema of a page's content: the section list of TEMPLATE pages, else its template. */
function schemaFor(kind: CmsPage["kind"], templateKey: string) {
  if (kind === "TEMPLATE") return CmsTemplateContentSchema;
  const template = cmsDesignTemplate(templateKey);
  return template ? cmsFieldsSchema(template.fields) : null;
}

/**
 * Validates content for a page; throws 400 VALIDATION_FAILED with `content.<path>` details (as the
 * draft request does), or 409 when the page has no editable template yet.
 */
export function validateContent(
  kind: CmsPage["kind"],
  templateKey: string,
  content: unknown,
): Record<string, unknown> {
  const schema = schemaFor(kind, templateKey);
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

/** The same check without throwing: for content read back from the database. */
export function contentIsValid(
  kind: CmsPage["kind"],
  templateKey: string,
  content: unknown,
): boolean {
  const schema = schemaFor(kind, templateKey);
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
    content: unknown;
  },
  revision: { revisionNumber: number; publishedAt: Date } | null,
): CmsPublicPage {
  return {
    kind: row.kind,
    templateKey: row.templateKey,
    path: row.path,
    title: row.title,
    seo: { title: row.seoTitle, description: row.seoDescription, noindex: row.noindex },
    content: asObject(row.content),
    revisionNumber: revision?.revisionNumber ?? null,
    publishedAt: revision?.publishedAt.toISOString() ?? null,
  };
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
