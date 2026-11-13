/**
 * CMS pages of the two public sites (S1: DP-015, ADR-020). Drafts only: publication, revisions
 * and preview come in S2, so nothing written here reaches a public site.
 *
 * Authorization (existing IAM permissions of the `cms` module, no new ones):
 *  - read the site context, the page list and a page: `content:read` of that site;
 *  - create a page and save its draft: `content:edit` of that site;
 *  - a page of a site the caller may not read or edit is simply not found (404, IDOR), and the
 *    attempt is audited (StaffAccess.denied).
 *
 * Every change and its audit event are written in one transaction; audit metadata names the
 * changed fields, never their values. Saves name the version they were based on (409 when stale).
 * S1 edits TEMPLATE pages; DESIGN pages and fragments are imported and edited from S2 on.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CMS_STANDARD_TEMPLATE,
  CmsPageCreateRequestSchema,
  CmsPageDraftRequestSchema,
  cmsPathForSlug,
  type CmsContextResponse,
  type CmsPage,
  type CmsPageListResponse,
  type CmsPageResponse,
  type CmsPageSummary,
  type CmsSite,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapCmsDbError, staleVersion } from "./errors.js";

const READ = "content:read";
const EDIT = "content:edit";
const PUBLISH = "content:publish";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SITE = "00000000-0000-0000-0000-000000000000";
const RESOURCE = "cms_page";

const USER = { select: { id: true, displayName: true } } as const;
const PAGE_SELECT = {
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
  version: true,
  createdAt: true,
  updatedAt: true,
  createdBy: USER,
  updatedBy: USER,
} as const;

interface UserRow {
  id: string;
  displayName: string | null;
}
interface PageRow {
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
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: UserRow;
  updatedBy: UserRow;
}

const userRef = (u: UserRow) => ({ id: u.id, name: u.displayName ?? "Staff user" });

function sections(content: unknown): CmsPage["content"]["sections"] {
  const list = (content as { sections?: unknown } | null)?.sections;
  return Array.isArray(list) ? (list as CmsPage["content"]["sections"]) : [];
}

function toSummary(row: PageRow): CmsPageSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    templateKey: row.templateKey,
    path: row.path,
    title: row.title,
    locale: row.locale,
    sectionCount: sections(row.content).length,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: userRef(row.updatedBy),
  };
}

function toPage(row: PageRow): CmsPage {
  return {
    ...toSummary(row),
    slug: row.kind === "TEMPLATE" && row.path ? row.path.slice(1) : null,
    seo: { title: row.seoTitle, description: row.seoDescription, noindex: row.noindex },
    content: { sections: sections(row.content) },
    createdAt: row.createdAt.toISOString(),
    createdBy: userRef(row.createdBy),
  };
}

/** JSON with sorted keys: jsonb does not keep the key order of the request. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)))
      : v,
  );
}

/** Field names whose value differs (audit metadata: names only, never values). */
function changedFields(before: PageRow, after: Record<string, unknown>): string[] {
  const old: Record<string, unknown> = {
    title: before.title,
    path: before.path,
    seoTitle: before.seoTitle,
    seoDescription: before.seoDescription,
    noindex: before.noindex,
    content: stableJson(before.content),
  };
  return Object.keys(after).filter((k) => old[k] !== after[k]);
}

@Injectable()
export class CmsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  /** The sites the caller may read, with the site's locale and the caller's abilities. */
  private static async sites(a: StaffAccess): Promise<CmsSite[]> {
    const readable = a.sitesWith(READ);
    if (readable.length === 0) return [];
    const editable = new Set(a.sitesWith(EDIT));
    const publishable = new Set(a.sitesWith(PUBLISH));
    const db = a.db({ siteIds: readable, includePlatform: false });
    const rows = await db.site.findMany({
      where: { id: { in: readable } },
      select: { id: true, defaultLocale: true },
    });
    const locale = new Map(rows.map((r) => [r.id, r.defaultLocale]));
    return a.sites
      .filter((s) => readable.includes(s.id))
      .map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        locale: locale.get(s.id) ?? "en",
        canEdit: editable.has(s.id),
        canPublish: publishable.has(s.id),
      }));
  }

  private static async site(a: StaffAccess, siteId: string): Promise<CmsSite> {
    const site = (await CmsService.sites(a)).find((s) => s.id === siteId);
    if (!site) throw new ApiError("NOT_FOUND");
    return site;
  }

  /** Validates a site id from the request and requires `permission` there (403 otherwise). */
  private static async requireSite(
    a: StaffAccess,
    permission: string,
    rawSiteId: unknown,
  ): Promise<string> {
    const id =
      typeof rawSiteId === "string" && UUID.test(rawSiteId) ? rawSiteId.toLowerCase() : NO_SITE;
    await a.require(permission, { scope: "site", siteId: id }, { type: RESOURCE, id: null });
    return id;
  }

  /** Loads a page through the scope of the sites where the caller holds `permission`. */
  private static async pageIn(a: StaffAccess, permission: string, rawId: string) {
    const id = UUID.test(rawId) ? rawId.toLowerCase() : null;
    const sites = a.sitesWith(permission);
    const db = a.db({ siteIds: sites, includePlatform: false });
    const row =
      id && sites.length
        ? ((await db.cmsPage.findUnique({ where: { id }, select: PAGE_SELECT })) as PageRow | null)
        : null;
    if (!row) {
      // Out of scope and unknown look the same (IDOR). The attempt is audited.
      await a.denied(permission, { type: RESOURCE, id }, "not_found_in_scope");
      throw new ApiError("NOT_FOUND");
    }
    return { row, db: a.db({ siteIds: [row.siteId], includePlatform: false }) };
  }

  // --- reads ---------------------------------------------------------------------------------

  async context(ctx: RequestContext): Promise<CmsContextResponse> {
    const a = await this.access.begin(ctx);
    return { sites: await CmsService.sites(a) };
  }

  async listPages(ctx: RequestContext, rawSiteId: unknown): Promise<CmsPageListResponse> {
    const a = await this.access.begin(ctx);
    const siteId = await CmsService.requireSite(a, READ, rawSiteId);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const rows = (await db.cmsPage.findMany({
      where: { siteId },
      select: PAGE_SELECT,
      orderBy: [{ kind: "asc" }, { path: "asc" }, { title: "asc" }],
    })) as PageRow[];
    return { site: await CmsService.site(a, siteId), items: rows.map(toSummary) };
  }

  async getPage(ctx: RequestContext, rawId: string): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row } = await CmsService.pageIn(a, READ, rawId);
    return { page: toPage(row), site: await CmsService.site(a, row.siteId) };
  }

  // --- changes -------------------------------------------------------------------------------

  async createPage(
    ctx: RequestContext,
    rawSiteId: unknown,
    body: unknown,
  ): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const siteId = await CmsService.requireSite(a, EDIT, rawSiteId);
    const input = parseBody(CmsPageCreateRequestSchema, body);
    const site = await CmsService.site(a, siteId);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    try {
      const row = await db.$transaction(async (tx) => {
        const created = (await tx.cmsPage.create({
          data: {
            siteId,
            kind: "TEMPLATE",
            templateKey: CMS_STANDARD_TEMPLATE,
            path: cmsPathForSlug(input.slug),
            locale: site.locale,
            title: input.title,
            content: { sections: [] },
            createdById: a.userId,
            updatedById: a.userId,
          },
          select: PAGE_SELECT,
        })) as PageRow;
        await a.audit(tx, {
          action: "cms.page_created",
          resourceType: RESOURCE,
          resourceId: created.id,
          siteId,
          permission: EDIT,
          metadata: { kind: created.kind, path: created.path },
        });
        return created;
      });
      return { page: toPage(row), site };
    } catch (e) {
      return mapCmsDbError(e);
    }
  }

  async saveDraft(ctx: RequestContext, rawId: string, body: unknown): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row: before, db } = await CmsService.pageIn(a, EDIT, rawId);
    if (before.kind !== "TEMPLATE") {
      // DESIGN pages and fragments get their own forms with the S2 import.
      throw new ApiError("CONFLICT_STATE", [{ path: "kind", rule: "not_editable_yet" }]);
    }
    const input = parseBody(CmsPageDraftRequestSchema, body);
    const data = {
      title: input.title,
      path: cmsPathForSlug(input.slug),
      seoTitle: input.seo.title,
      seoDescription: input.seo.description,
      noindex: input.seo.noindex,
      content: stableJson(input.content),
    };
    try {
      const row = await db.$transaction(async (tx) => {
        const res = await tx.cmsPage.updateMany({
          where: { id: before.id, version: input.version },
          data: {
            ...data,
            content: input.content,
            updatedById: a.userId,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "cms.page_draft_saved",
          resourceType: RESOURCE,
          resourceId: before.id,
          siteId: before.siteId,
          permission: EDIT,
          metadata: {
            changed: changedFields(before, data),
            sectionCount: input.content.sections.length,
            version: input.version + 1,
          },
        });
        return (await tx.cmsPage.findUnique({
          where: { id: before.id },
          select: PAGE_SELECT,
        })) as PageRow;
      });
      return { page: toPage(row), site: await CmsService.site(a, row.siteId) };
    } catch (e) {
      return mapCmsDbError(e);
    }
  }
}
