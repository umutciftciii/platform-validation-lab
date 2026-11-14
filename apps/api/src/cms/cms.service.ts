/**
 * CMS pages of the two public sites (S1/S2: DP-015, DP-017, DP-134; ADR-020).
 *
 * Authorization (existing IAM permissions of the `cms` module, no new ones):
 *  - read the site context, the page list and a page, issue a preview link: `content:read`;
 *  - create a page, import a designed page from code, save a draft: `content:edit`;
 *  - publish, unpublish, republish: `content:publish` of the page's site;
 *  - a page of a site the caller may not act on is simply not found (404, IDOR), and the attempt
 *    is audited (StaffAccess.denied).
 *
 * Every change and its audit event are written in one transaction; audit metadata names the
 * changed fields, never their values. Saves and publications name the version they were based on
 * (409 when stale). Publishing copies the draft into an immutable revision (ADR-020 D6); the
 * public sites read only that revision (public-cms.service.ts).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CMS_ARTICLE_TEMPLATE,
  CMS_STANDARD_TEMPLATE,
  CmsArticleCreateRequestSchema,
  CmsArticleDraftRequestSchema,
  CmsFixedDraftRequestSchema,
  CmsImportRequestSchema,
  CmsPageCreateRequestSchema,
  CmsPageDraftRequestSchema,
  CmsPublishRequestSchema,
  CmsRestoreRequestSchema,
  CmsUnpublishRequestSchema,
  cmsArticlePath,
  cmsDesignTemplate,
  cmsIsArticle,
  cmsPathForSlug,
  type CmsContextResponse,
  type CmsHistoryResponse,
  type CmsImportResponse,
  type CmsPageListResponse,
  type CmsPageResponse,
  type CmsPreviewResponse,
  type CmsSite,
} from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import {
  PAGE_SELECT,
  attachPublications,
  issuePreviewToken,
  liveRows,
  partCount,
  stableJson,
  toPage,
  toSummary,
  userRef,
  validateContent,
  type PageBase,
  type PageRow,
} from "./cms-content.js";
import { mapCmsDbError, staleVersion } from "./errors.js";
import { CMS_SEEDS } from "./seed/bv.js";
import { CMS_PAGE_SEEDS } from "./seed/bv-pages.js";

const READ = "content:read";
const EDIT = "content:edit";
const PUBLISH = "content:publish";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SITE = "00000000-0000-0000-0000-000000000000";
const RESOURCE = "cms_page";
/** Version of the content schemas; raised when a template's fields change. */
const SCHEMA_VERSION = 1;

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
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

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
    const base =
      id && sites.length
        ? ((await db.cmsPage.findUnique({ where: { id }, select: PAGE_SELECT })) as PageBase | null)
        : null;
    const row = base ? (await attachPublications(db, [base]))[0] : undefined;
    if (!row) {
      // Out of scope and unknown look the same (IDOR). The attempt is audited.
      await a.denied(permission, { type: RESOURCE, id }, "not_found_in_scope");
      throw new ApiError("NOT_FOUND");
    }
    return { row, db: a.db({ siteIds: [row.siteId], includePlatform: false }) };
  }

  private async response(a: StaffAccess, db: unknown, id: string): Promise<CmsPageResponse> {
    const scoped = db as StaffDb;
    const base = (await scoped.cmsPage.findUnique({
      where: { id },
      select: PAGE_SELECT,
    })) as PageBase;
    const [row] = (await attachPublications(scoped, [base])) as [PageRow];
    return { page: toPage(row), site: await CmsService.site(a, row.siteId) };
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
    const rows = await attachPublications(
      db,
      (await db.cmsPage.findMany({
        where: { siteId },
        select: PAGE_SELECT,
        orderBy: [{ kind: "asc" }, { path: "asc" }, { title: "asc" }],
      })) as PageBase[],
    );
    return { site: await CmsService.site(a, siteId), items: rows.map(toSummary) };
  }

  async getPage(ctx: RequestContext, rawId: string): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row } = await CmsService.pageIn(a, READ, rawId);
    return { page: toPage(row), site: await CmsService.site(a, row.siteId) };
  }

  // --- drafts --------------------------------------------------------------------------------

  async createPage(
    ctx: RequestContext,
    rawSiteId: unknown,
    body: unknown,
  ): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const siteId = await CmsService.requireSite(a, EDIT, rawSiteId);
    // DP-020: `template: "article"` creates a news article at /news/<slug>; otherwise a page.
    const article =
      typeof body === "object" &&
      body !== null &&
      (body as { template?: unknown }).template === CMS_ARTICLE_TEMPLATE;
    const plan = article
      ? (() => {
          const input = parseBody(CmsArticleCreateRequestSchema, body);
          return {
            title: input.title,
            templateKey: CMS_ARTICLE_TEMPLATE,
            path: cmsArticlePath(input.slug),
            content: { excerpt: "", coverImage: null, coverAlt: null, sections: [] },
          };
        })()
      : (() => {
          const input = parseBody(CmsPageCreateRequestSchema, body);
          return {
            title: input.title,
            templateKey: CMS_STANDARD_TEMPLATE,
            path: cmsPathForSlug(input.slug),
            content: { sections: [] },
          };
        })();
    const site = await CmsService.site(a, siteId);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    try {
      const id = await db.$transaction(async (tx) => {
        const created = await tx.cmsPage.create({
          data: {
            siteId,
            kind: "TEMPLATE",
            templateKey: plan.templateKey,
            path: plan.path,
            locale: site.locale,
            title: plan.title,
            content: plan.content,
            createdById: a.userId,
            updatedById: a.userId,
          },
          select: { id: true, kind: true, path: true },
        });
        await a.audit(tx, {
          action: "cms.page_created",
          resourceType: RESOURCE,
          resourceId: created.id,
          siteId,
          permission: EDIT,
          metadata: { kind: created.kind, templateKey: plan.templateKey, path: created.path },
        });
        return created.id;
      });
      return this.response(a, db, id);
    } catch (e) {
      return mapCmsDbError(e);
    }
  }

  /**
   * Saves the whole draft. TEMPLATE pages: title, slug, SEO and sections. DESIGN pages and
   * fragments: title, SEO and their template's fields (their path is fixed by the registry).
   */
  async saveDraft(ctx: RequestContext, rawId: string, body: unknown): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row: before, db } = await CmsService.pageIn(a, EDIT, rawId);
    let version: number;
    let data: {
      title: string;
      path: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
      noindex: boolean;
      content: Record<string, unknown>;
    };
    if (cmsIsArticle(before)) {
      const input = parseBody(CmsArticleDraftRequestSchema, body);
      version = input.version;
      data = {
        title: input.title,
        path: cmsArticlePath(input.slug),
        seoTitle: input.seo.title,
        seoDescription: input.seo.description,
        noindex: input.seo.noindex,
        content: input.content as Record<string, unknown>,
      };
    } else if (before.kind === "TEMPLATE") {
      const input = parseBody(CmsPageDraftRequestSchema, body);
      version = input.version;
      data = {
        title: input.title,
        path: cmsPathForSlug(input.slug),
        seoTitle: input.seo.title,
        seoDescription: input.seo.description,
        noindex: input.seo.noindex,
        content: input.content as Record<string, unknown>,
      };
    } else {
      if (!cmsDesignTemplate(before.templateKey)) {
        // A designed page without a template yet (e.g. bv.products-index) stays managed in code.
        throw new ApiError("CONFLICT_STATE", [{ path: "kind", rule: "not_editable_yet" }]);
      }
      const input = parseBody(CmsFixedDraftRequestSchema, body);
      version = input.version;
      data = {
        title: input.title,
        path: before.path,
        seoTitle: input.seo.title,
        seoDescription: input.seo.description,
        noindex: input.seo.noindex,
        content: validateContent(before.kind, before.templateKey, input.content),
      };
    }
    try {
      await db.$transaction(async (tx) => {
        const res = await tx.cmsPage.updateMany({
          where: { id: before.id, version },
          data: { ...data, updatedById: a.userId, version: { increment: 1 } } as never,
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "cms.page_draft_saved",
          resourceType: RESOURCE,
          resourceId: before.id,
          siteId: before.siteId,
          permission: EDIT,
          metadata: {
            changed: changedFields(before, { ...data, content: stableJson(data.content) }),
            sectionCount: partCount(before.kind, data.content),
            version: version + 1,
          },
        });
      });
      return this.response(a, db, before.id);
    } catch (e) {
      return mapCmsDbError(e);
    }
  }

  /**
   * Creates a designed page or fragment from the content that was in code (ADR-020 D7). A dry run
   * only validates and summarises. Never overwrites: an existing page is 409 (idempotent).
   */
  async importPage(
    ctx: RequestContext,
    rawSiteId: unknown,
    body: unknown,
  ): Promise<CmsImportResponse> {
    const a = await this.access.begin(ctx);
    const siteId = await CmsService.requireSite(a, EDIT, rawSiteId);
    const input = parseBody(CmsImportRequestSchema, body);
    const site = await CmsService.site(a, siteId);
    const plan = CmsService.importPlan(input.key, site.key);
    const content = validateContent(plan.kind, plan.templateKey, plan.content);
    const summary = Object.entries(content).map(([field, value]) => ({
      field,
      items: Array.isArray(value) ? value.length : null,
    }));
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    // Never overwrite (ADR-020 D7): a designed page by its registry key, a content page by its path.
    const existing = await db.cmsPage.findFirst({
      where:
        plan.kind === "TEMPLATE"
          ? { siteId, path: plan.path }
          : { siteId, templateKey: plan.templateKey },
      select: { id: true },
    });
    if (existing) throw new ApiError("CONFLICT_STATE", [{ path: "key", rule: "already_imported" }]);
    if (input.dryRun) return { key: input.key, dryRun: true, summary, pageId: null };
    try {
      const id = await db.$transaction(async (tx) => {
        const created = await tx.cmsPage.create({
          data: {
            siteId,
            kind: plan.kind,
            templateKey: plan.templateKey,
            path: plan.path,
            locale: site.locale,
            title: plan.title,
            seoTitle: plan.seo.title,
            seoDescription: plan.seo.description,
            noindex: plan.seo.noindex,
            content: content as never,
            schemaVersion: SCHEMA_VERSION,
            createdById: a.userId,
            updatedById: a.userId,
          },
          select: { id: true },
        });
        await a.audit(tx, {
          action: "cms.page_imported",
          resourceType: RESOURCE,
          resourceId: created.id,
          siteId,
          permission: EDIT,
          metadata: { templateKey: input.key, fields: summary.length },
        });
        return created.id;
      });
      return { key: input.key, dryRun: false, summary, pageId: id };
    } catch (e) {
      // A concurrent import of the same key: the registry or path unique index answers.
      return mapCmsDbError(e);
    }
  }

  /** What an import key creates: a designed page or fragment, or a content (TEMPLATE) page. */
  private static importPlan(key: string, siteKey: CmsSite["key"]) {
    const template = cmsDesignTemplate(key);
    const seed = CMS_SEEDS[key];
    if (template && seed && template.site === siteKey) {
      return {
        kind: template.kind,
        templateKey: template.key,
        path: template.path,
        title: seed.title,
        seo: { title: null, description: null, noindex: false },
        content: seed.content,
      };
    }
    const page = CMS_PAGE_SEEDS[key];
    if (page && key.startsWith(`${siteKey.toLowerCase()}.`)) {
      return {
        kind: "TEMPLATE" as const,
        templateKey: CMS_STANDARD_TEMPLATE,
        path: cmsPathForSlug(page.slug),
        title: page.title,
        seo: page.seo,
        content: page.content,
      };
    }
    throw new ApiError("VALIDATION_FAILED", [{ path: "key", rule: "unknown_template" }]);
  }

  // --- preview and publication ---------------------------------------------------------------

  /** A short-lived link that shows the current draft on the page's site (noindex, no cache). */
  async preview(ctx: RequestContext, rawId: string): Promise<CmsPreviewResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, READ, rawId);
    const site = await CmsService.site(a, row.siteId);
    const app = site.key === "BV" ? "WEB_BV" : "WEB_CORPORATE";
    const origin = [...this.config.allowedOrigins[app]][0];
    if (!origin) throw new ApiError("CONFLICT_STATE", [{ path: "site", rule: "no_public_origin" }]);
    const { token, expiresAt } = issuePreviewToken(
      this.config.secrets.hmacKey,
      row.id,
      site.key,
      this.clock.now(),
    );
    await a.audit(db, {
      action: "cms.preview_issued",
      resourceType: RESOURCE,
      resourceId: row.id,
      siteId: row.siteId,
      permission: READ,
      metadata: { pageVersion: row.version, expiresAt: expiresAt.toISOString() },
    });
    return { url: `${origin}/preview/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Publishes the draft version the publisher saw: a new immutable revision, and the page's
   * publication points at it (PUBLISHED). Also republishes after an edit or an unpublish.
   */
  async publish(ctx: RequestContext, rawId: string, body: unknown): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, PUBLISH, rawId);
    const input = parseBody(CmsPublishRequestSchema, body);
    if (input.version !== row.version) throw staleVersion();
    // DP-020: an article needs its summary and at least one body section before it goes live
    // (checked first: a new article's empty summary is "incomplete", not "invalid").
    if (cmsIsArticle(row)) {
      const draft = (row.content ?? {}) as Record<string, unknown>;
      const excerpt = typeof draft["excerpt"] === "string" ? draft["excerpt"].trim() : "";
      const sections = Array.isArray(draft["sections"]) ? draft["sections"] : [];
      if (!excerpt || sections.length === 0) {
        throw new ApiError("CONFLICT_STATE", [{ path: "content", rule: "article_incomplete" }]);
      }
    }
    let content: Record<string, unknown>;
    try {
      content = validateContent(row.kind, row.templateKey, row.content);
    } catch {
      throw new ApiError("CONFLICT_STATE", [{ path: "content", rule: "invalid" }]);
    }
    try {
      await db.$transaction(async (tx) => {
        // The revision copies the draft exactly as checked above (version `row.version`); a save
        // that lands meanwhile becomes a newer draft, shown as "changes not published".
        if (row.path) {
          const live = await liveRows(tx, row.siteId);
          if (live.some((l) => l.pageId !== row.id && l.revision.path === row.path)) {
            throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "live_elsewhere" }]);
          }
        }
        const last = await tx.cmsPageRevision.findFirst({
          where: { pageId: row.id },
          orderBy: { revisionNumber: "desc" },
          select: { revisionNumber: true },
        });
        const revisionNumber = (last?.revisionNumber ?? 0) + 1;
        const revision = await tx.cmsPageRevision.create({
          data: {
            pageId: row.id,
            siteId: row.siteId,
            revisionNumber,
            pageVersion: row.version,
            title: row.title,
            path: row.path,
            seoTitle: row.seoTitle,
            seoDescription: row.seoDescription,
            noindex: row.noindex,
            content: content as never,
            schemaVersion: row.schemaVersion,
            createdById: a.userId,
          },
          select: { id: true },
        });
        const now = this.clock.now();
        const published = {
          revisionId: revision.id,
          status: "PUBLISHED" as const,
          publishedAt: now,
          publishedById: a.userId,
          unpublishedAt: null,
          unpublishedById: null,
        };
        if (row.publication) {
          await tx.cmsPagePublication.update({
            where: { pageId: row.id },
            data: { ...published, version: { increment: 1 } },
          });
        } else {
          await tx.cmsPagePublication.create({
            data: { pageId: row.id, siteId: row.siteId, ...published },
          });
        }
        await a.audit(tx, {
          action: "cms.page_published",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId: row.siteId,
          permission: PUBLISH,
          metadata: { revisionNumber, pageVersion: row.version, path: row.path },
        });
      });
      return this.response(a, db, row.id);
    } catch (e) {
      return mapCmsDbError(e);
    }
  }

  /**
   * DP-020: the publication history of a page, newest first (one immutable revision per
   * publication; `live` marks the one the site shows). `content:read`.
   */
  async history(ctx: RequestContext, rawId: string): Promise<CmsHistoryResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, READ, rawId);
    const [revisions, pub] = await Promise.all([
      db.cmsPageRevision.findMany({
        where: { pageId: row.id },
        orderBy: { revisionNumber: "desc" },
        select: {
          id: true,
          revisionNumber: true,
          pageVersion: true,
          title: true,
          path: true,
          createdAt: true,
          createdBy: USER_REF,
        },
      }),
      db.cmsPagePublication.findUnique({
        where: { pageId: row.id },
        select: { revisionId: true, status: true },
      }),
    ]);
    return {
      revisions: revisions.map((r) => ({
        revisionNumber: r.revisionNumber,
        pageVersion: r.pageVersion,
        title: r.title,
        path: r.path,
        publishedAt: r.createdAt.toISOString(),
        publishedBy: userRef(r.createdBy),
        live: pub?.status === "PUBLISHED" && pub.revisionId === r.id,
      })),
    };
  }

  /**
   * DP-020: copies a published revision (title, address, SEO, content) back into the draft. A
   * normal draft save (`content:edit`, names the draft version, audited); nothing is published.
   * The content is validated again, so a revision of an older schema is refused (409).
   */
  async restore(ctx: RequestContext, rawId: string, body: unknown): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, EDIT, rawId);
    const input = parseBody(CmsRestoreRequestSchema, body);
    if (input.version !== row.version) throw staleVersion();
    const revision = await db.cmsPageRevision.findFirst({
      where: { pageId: row.id, revisionNumber: input.revisionNumber },
      select: {
        title: true,
        path: true,
        seoTitle: true,
        seoDescription: true,
        noindex: true,
        content: true,
      },
    });
    if (!revision) throw new ApiError("NOT_FOUND", [{ path: "revisionNumber", rule: "unknown" }]);
    let content: Record<string, unknown>;
    try {
      content = validateContent(row.kind, row.templateKey, revision.content);
    } catch {
      throw new ApiError("CONFLICT_STATE", [{ path: "content", rule: "invalid" }]);
    }
    const data = {
      title: revision.title,
      path: revision.path,
      seoTitle: revision.seoTitle,
      seoDescription: revision.seoDescription,
      noindex: revision.noindex,
      content,
    };
    try {
      await db.$transaction(async (tx) => {
        const res = await tx.cmsPage.updateMany({
          where: { id: row.id, version: input.version },
          data: { ...data, updatedById: a.userId, version: { increment: 1 } } as never,
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "cms.page_revision_restored",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId: row.siteId,
          permission: EDIT,
          metadata: {
            revisionNumber: input.revisionNumber,
            changed: changedFields(row, { ...data, content: stableJson(content) }),
            version: input.version + 1,
          },
        });
      });
      return this.response(a, db, row.id);
    } catch (e) {
      return mapCmsDbError(e);
    }
  }

  /** Takes the page off the site. Its revisions stay; publishing again brings the draft back. */
  async unpublish(ctx: RequestContext, rawId: string, body: unknown): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, PUBLISH, rawId);
    const input = parseBody(CmsUnpublishRequestSchema, body);
    if (row.publication?.status !== "PUBLISHED") {
      throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_published" }]);
    }
    try {
      await db.$transaction(async (tx) => {
        const res = await tx.cmsPagePublication.updateMany({
          where: { pageId: row.id, status: "PUBLISHED", version: input.publicationVersion },
          data: {
            status: "UNPUBLISHED",
            unpublishedAt: this.clock.now(),
            unpublishedById: a.userId,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) {
          throw new ApiError("CONFLICT_STATE", [{ path: "publicationVersion", rule: "stale" }]);
        }
        await a.audit(tx, {
          action: "cms.page_unpublished",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId: row.siteId,
          permission: PUBLISH,
          metadata: { revisionNumber: row.publication?.revision.revisionNumber ?? null },
        });
      });
      return this.response(a, db, row.id);
    } catch (e) {
      return mapCmsDbError(e);
    }
  }
}

type StaffDb = ReturnType<StaffAccess["db"]>;

const USER_REF = { select: { id: true, displayName: true } } as const;
