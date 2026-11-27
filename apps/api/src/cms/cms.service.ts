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
  CmsSeoSchema,
  CmsTranslationCreateRequestSchema,
  CmsTranslationSourceRequestSchema,
  CmsUnpublishRequestSchema,
  LocaleTagSchema,
  cmsArticlePath,
  CMS_MENU_SCHEMA_VERSION,
  cmsDesignTemplate,
  cmsIsArticle,
  cmsIsMenu,
  cmsPathForSlug,
  cmsSlugOfPath,
  cmsStructureWarnings,
  cmsTranslationDraft,
  cmsTranslationProposal,
  cmsCorporateTrPlace,
  cmsContentTexts,
  cmsWithContentTexts,
  cmsTranslationSlugSchema,
  type CmsContextResponse,
  type CmsHistoryResponse,
  type CmsImportResponse,
  type CmsMenuTargetsResponse,
  type CmsPageListResponse,
  type CmsPageResponse,
  type CmsPreviewResponse,
  type CmsSeoInput,
  type CmsSite,
} from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import {
  PAGE_SELECT,
  SEO_SELECT,
  asObject,
  attachPublications,
  issuePreviewToken,
  liveRows,
  partCount,
  stableJson,
  toPage,
  toSummary,
  userRef,
  pickSeo,
  seoColumns,
  assertSiteImage,
  validateContent,
  type PageBase,
  type SeoColumns,
  type PageRow,
  type CmsDb,
} from "./cms-content.js";
import { mapCmsDbError, staleVersion } from "./errors.js";
import {
  applyAddressChange,
  assertAddressFree,
  keepsOldAddress,
  lockSitePaths,
  redirectsTo,
} from "../seo/redirects.js";
import { CMS_SEEDS as BV_SEEDS } from "./seed/bv.js";
import { CORPORATE_SEEDS } from "./seed/corporate.js";
import { CORPORATE_TR_PROPOSALS } from "./seed/corporate-tr.js";
import { corporateSeedMenuTargets } from "./seed/menu-targets.js";
import { assertMenuReferences, menuTargets, menuWarnings } from "./menu-links.js";
import { CMS_ARTICLE_SEEDS, CMS_PAGE_SEEDS } from "./seed/bv-pages.js";
import { assertLocaleEnabled, siteLocalesOf } from "./site-locales.js";
import {
  defaultLocaleOf,
  groupSource,
  newPageId,
  pageAddress,
  translationsOf,
} from "./translations.js";

const READ = "content:read";
const EDIT = "content:edit";
const PUBLISH = "content:publish";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SITE = "00000000-0000-0000-0000-000000000000";
/** The import sources of the designed pages and fragments of both sites (COM-1: corporate). */
const CMS_SEEDS: Readonly<Record<string, { title: string; content: unknown }>> = {
  ...BV_SEEDS,
  ...CORPORATE_SEEDS,
};
const RESOURCE = "cms_page";
/** Version of the content schemas; raised when a template's fields change. */
const SCHEMA_VERSION = 1;
/** DP-219: the menus are written in content schema version 2 (version 1 is read as 2). */
const schemaVersionOf = (templateKey: string) =>
  cmsIsMenu(templateKey) ? CMS_MENU_SCHEMA_VERSION : SCHEMA_VERSION;

/** Field names whose value differs (audit metadata: names only, never values). */
function changedFields(before: PageRow, after: Record<string, unknown>): string[] {
  const old: Record<string, unknown> = {
    title: before.title,
    path: before.path,
    seoTitle: before.seoTitle,
    seoDescription: before.seoDescription,
    noindex: before.noindex,
    canonicalPath: before.canonicalPath,
    ogTitle: before.ogTitle,
    ogDescription: before.ogDescription,
    ogImage: before.ogImage,
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

  /**
   * The sites the caller may read, with the site's locale, its languages (ML-1, read only) and
   * the caller's abilities.
   */
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
    const locales = await siteLocalesOf(db, readable);
    return a.sites
      .filter((s) => readable.includes(s.id))
      .map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        locale: locale.get(s.id) ?? "en",
        canEdit: editable.has(s.id),
        canPublish: publishable.has(s.id),
        locales: locales.get(s.id) ?? [],
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
    return CmsService.pageResponse(a, scoped, row);
  }

  /** The page with its DP-210 addresses (older addresses that redirect to it). */
  private static async pageResponse(
    a: StaffAccess,
    db: StaffDb,
    row: PageRow,
  ): Promise<CmsPageResponse> {
    const keeps = row.path !== null && keepsOldAddress(a.sites, row.siteId);
    const redirectsHere = keeps ? await redirectsTo(db, row.siteId, "CMS_PAGE", row.id) : [];
    const site = await CmsService.site(a, row.siteId);
    const translations = (await translationsOf(db, site, [row.translationGroupId])).get(
      row.translationGroupId,
    );
    // ML-2 (ADR-028 D6): a translation's structure is compared with its source page's draft.
    let structureWarnings: ReturnType<typeof cmsStructureWarnings> = [];
    const sourceId = translations?.find((t) => t.isSource)?.pageId;
    if (sourceId && sourceId !== row.id) {
      const source = await db.cmsPage.findUnique({
        where: { id: sourceId },
        select: { content: true },
      });
      if (source) {
        structureWarnings = cmsStructureWarnings(asObject(source.content), asObject(row.content));
      }
    }
    // ML-7 (DP-238): links of a menu draft that will not be links in its language (a warning).
    const linkWarnings = cmsIsMenu(row.templateKey)
      ? await menuWarnings(db, row.siteId, row.templateKey, row.content, {
          locale: row.locale,
          defaultLocale: defaultLocaleOf(site),
        })
      : [];
    return {
      page: toPage(row, {
        redirectsHere,
        keepsOldAddress: keeps,
        structureWarnings,
        menuWarnings: linkWarnings,
      }),
      site,
      translations: translations ?? [],
    };
  }

  /** ML-2: a language of the site from a query parameter (the default language when absent). */
  private static listLocale(site: CmsSite, raw: unknown): string {
    if (raw === undefined || raw === "") return defaultLocaleOf(site);
    const parsed = LocaleTagSchema.safeParse(raw);
    if (!parsed.success || !site.locales.some((l) => l.locale === parsed.data)) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "locale", rule: "unknown" }]);
    }
    return parsed.data;
  }

  // --- reads ---------------------------------------------------------------------------------

  async context(ctx: RequestContext): Promise<CmsContextResponse> {
    const a = await this.access.begin(ctx);
    return { sites: await CmsService.sites(a) };
  }

  /**
   * The pages of one language of the site (ML-2: `?locale=`, default the site's default
   * language, so a caller without the parameter sees exactly what it saw before). In the default
   * language every page carries the state of its other languages.
   */
  async listPages(
    ctx: RequestContext,
    rawSiteId: unknown,
    rawLocale?: unknown,
  ): Promise<CmsPageListResponse> {
    const a = await this.access.begin(ctx);
    const siteId = await CmsService.requireSite(a, READ, rawSiteId);
    const site = await CmsService.site(a, siteId);
    const locale = CmsService.listLocale(site, rawLocale);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const rows = await attachPublications(
      db,
      (await db.cmsPage.findMany({
        where: { siteId, locale },
        select: PAGE_SELECT,
        orderBy: [{ kind: "asc" }, { path: "asc" }, { title: "asc" }],
      })) as PageBase[],
    );
    const items = rows.map(toSummary);
    if (locale === defaultLocaleOf(site)) {
      const groups = await translationsOf(
        db,
        site,
        rows.map((r) => r.translationGroupId),
      );
      for (const item of items) {
        item.translations = (groups.get(item.translationGroupId ?? "") ?? []).filter(
          (t) => !t.isSource,
        );
      }
    }
    return { site, items };
  }

  async getPage(ctx: RequestContext, rawId: string): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, READ, rawId);
    return CmsService.pageResponse(a, db, row);
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
        // DP-210: an old address of another page stays its 301 (409 old_address).
        const locale = defaultLocaleOf(site);
        if (keepsOldAddress(a.sites, siteId)) {
          await assertAddressFree(
            tx,
            siteId,
            pageAddress(site, locale, plan.path),
            "CMS_PAGE",
            null,
          );
        }
        // ML-2: a new page is the first page of its own translation group.
        const id = newPageId(this.clock.now().getTime());
        const created = await tx.cmsPage.create({
          data: {
            id,
            translationGroupId: id,
            siteId,
            kind: "TEMPLATE",
            templateKey: plan.templateKey,
            path: plan.path,
            locale,
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
    // ML-1 (ADR-028 D2): only in a language that is enabled on the page's site (public or not).
    await assertLocaleEnabled(db, before.siteId, before.locale);
    // COM-2a (DP-320): the content and the link-preview image are files of the page's own site.
    const siteKey = (await CmsService.site(a, before.siteId)).key;
    let version: number;
    let data: SeoColumns & {
      title: string;
      path: string | null;
      content: Record<string, unknown>;
    };
    if (cmsIsArticle(before)) {
      const input = parseBody(CmsArticleDraftRequestSchema, body);
      version = input.version;
      data = {
        title: input.title,
        path: cmsArticlePath(input.slug),
        ...seoColumns(input.seo),
        content: validateContent(before.kind, before.templateKey, input.content, siteKey),
      };
    } else if (before.kind === "TEMPLATE") {
      const input = parseBody(CmsPageDraftRequestSchema, body);
      version = input.version;
      data = {
        title: input.title,
        path: cmsPathForSlug(input.slug),
        ...seoColumns(input.seo),
        content: validateContent(before.kind, before.templateKey, input.content, siteKey),
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
        ...seoColumns(input.seo),
        content: validateContent(before.kind, before.templateKey, input.content, siteKey),
      };
    }
    assertSiteImage(data.ogImage, siteKey);
    try {
      await db.$transaction(async (tx) => {
        if (data.path !== before.path && data.path && keepsOldAddress(a.sites, before.siteId)) {
          const site = await CmsService.site(a, before.siteId);
          await assertAddressFree(
            tx,
            before.siteId,
            pageAddress(site, before.locale, data.path),
            "CMS_PAGE",
            before.id,
          );
        }
        // DP-219: a menu may reference only pages, products and categories of its own site.
        await assertMenuReferences(tx, before.siteId, before.templateKey, data.content);
        const res = await tx.cmsPage.updateMany({
          where: { id: before.id, version },
          data: {
            ...data,
            schemaVersion: schemaVersionOf(before.templateKey),
            updatedById: a.userId,
            version: { increment: 1 },
          } as never,
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
    const db0 = a.db({ siteIds: [siteId], includePlatform: false });
    // COM-5: the corporate menus point at the corporate pages that are in the CMS already.
    const seedContent =
      site.key === "CORPORATE" && cmsIsMenu(plan.templateKey)
        ? await CmsService.corporateMenuTargets(db0, siteId, defaultLocaleOf(site), plan.content)
        : plan.content;
    const content = validateContent(plan.kind, plan.templateKey, seedContent, site.key);
    const summary = Object.entries(content).map(([field, value]) => ({
      field,
      items: Array.isArray(value) ? value.length : null,
    }));
    const db = db0;
    // ML-2: imports write the site's default language (the content in code is English).
    const locale = defaultLocaleOf(site);
    // Never overwrite (ADR-020 D7): a designed page by its registry key, a content page by its path.
    const existing = await db.cmsPage.findFirst({
      where:
        plan.kind === "TEMPLATE"
          ? { siteId, locale, path: plan.path }
          : { siteId, locale, templateKey: plan.templateKey },
      select: { id: true },
    });
    if (existing) throw new ApiError("CONFLICT_STATE", [{ path: "key", rule: "already_imported" }]);
    if (input.dryRun) return { key: input.key, dryRun: true, summary, pageId: null };
    try {
      const id = await db.$transaction(async (tx) => {
        const pageId = newPageId(this.clock.now().getTime());
        const created = await tx.cmsPage.create({
          data: {
            id: pageId,
            translationGroupId: pageId,
            siteId,
            kind: plan.kind,
            templateKey: plan.templateKey,
            path: plan.path,
            locale,
            title: plan.title,
            ...seoColumns(CmsSeoSchema.parse(plan.seo)),
            content: content as never,
            schemaVersion: schemaVersionOf(plan.templateKey),
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

  /**
   * COM-5 (DP-038): the menu seeds of the corporate site name their targets by address (`path`).
   * An address of a CMS page of the site (default language, any state) becomes a reference to that
   * page, so the menu links it exactly while it is live and shows the label as text otherwise
   * (DP-219); the privacy policy stays an address (an app page); any other address is "not ready"
   * (`none`). Nothing in the menu can become a broken link. Import the pages first.
   */
  private static async corporateMenuTargets(
    db: CmsDb,
    siteId: string,
    locale: string,
    content: unknown,
  ): Promise<unknown> {
    const rows = await db.cmsPage.findMany({
      where: { siteId, locale, path: { not: null } },
      select: { id: true, path: true },
    });
    return corporateSeedMenuTargets(
      content,
      new Map(rows.flatMap((r) => (r.path ? [[r.path, r.id] as const] : []))),
    );
  }

  /**
   * What an import key creates: a designed page or fragment, a content (TEMPLATE) page or a news
   * article.
   */
  private static importPlan(key: string, siteKey: CmsSite["key"]) {
    const template = cmsDesignTemplate(key);
    const seed = CMS_SEEDS[key];
    if (template && seed && template.site === siteKey) {
      return {
        kind: template.kind,
        templateKey: template.key,
        path: template.path,
        title: seed.title,
        seo: { title: null, description: null, noindex: false } as CmsSeoInput,
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
    // DP-206: a news article of the live site (DP-020 article template at /news/<slug>).
    const article = CMS_ARTICLE_SEEDS[key];
    if (article && key.startsWith(`${siteKey.toLowerCase()}.`)) {
      return {
        kind: "TEMPLATE" as const,
        templateKey: CMS_ARTICLE_TEMPLATE,
        path: cmsArticlePath(article.slug),
        title: article.title,
        seo: article.seo,
        content: article.content,
      };
    }
    throw new ApiError("VALIDATION_FAILED", [{ path: "key", rule: "unknown_template" }]);
  }

  // --- preview and publication ---------------------------------------------------------------

  /** A short-lived link that shows the current draft on the page's site (noindex, no cache). */
  async preview(ctx: RequestContext, rawId: string): Promise<CmsPreviewResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, READ, rawId);
    // ML-1 (ADR-028 D2): only in a language that is enabled on the page's site (public or not).
    await assertLocaleEnabled(db, row.siteId, row.locale);
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
    // COM-2a (DP-320): with the site's own rules (its files; an image it may leave empty).
    const siteKey = (await CmsService.site(a, row.siteId)).key;
    try {
      content = validateContent(row.kind, row.templateKey, row.content, siteKey);
      assertSiteImage(row.ogImage, siteKey);
    } catch {
      throw new ApiError("CONFLICT_STATE", [{ path: "content", rule: "invalid" }]);
    }
    // ML-1 (ADR-028 D2/D14): only in an enabled language. A language that is not public may be
    // published too; its content stays invisible to visitors (public reads filter by `public`).
    await assertLocaleEnabled(db, row.siteId, row.locale);
    try {
      await db.$transaction(async (tx) => {
        // The revision copies the draft exactly as checked above (version `row.version`); a save
        // that lands meanwhile becomes a newer draft, shown as "changes not published".
        // DP-210: a page with an address locks the site's addresses first, then reads the live
        // state again: a concurrent publication of this page (same version) is stale, and one of
        // another page at the same address is refused, deterministically.
        let previousPath: string | null = null;
        if (row.path) {
          await lockSitePaths(tx, row.siteId);
          const current = await tx.cmsPagePublication.findUnique({
            where: { pageId: row.id },
            select: { version: true, status: true, revisionId: true },
          });
          if ((current?.version ?? null) !== (row.publication?.version ?? null)) {
            throw staleVersion();
          }
          // ML-2: an address is taken per language (the same path may be live in two languages).
          const live = await liveRows(tx, row.siteId);
          if (
            live.some(
              (l) =>
                l.pageId !== row.id && l.page.locale === row.locale && l.revision.path === row.path,
            )
          ) {
            throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "live_elsewhere" }]);
          }
          previousPath =
            current?.status === "PUBLISHED"
              ? (live.find((l) => l.pageId === row.id)?.revision.path ?? null)
              : null;
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
            ...pickSeo(row),
            content: content as never,
            // DP-219: a menu's content is stored as validated, i.e. in version 2.
            schemaVersion: cmsIsMenu(row.templateKey) ? CMS_MENU_SCHEMA_VERSION : row.schemaVersion,
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
          metadata: {
            revisionNumber,
            pageVersion: row.version,
            path: row.path,
            ...(previousPath !== null && previousPath !== row.path ? { previousPath } : {}),
          },
        });
        // DP-210: the previous address answers 301 with the new one (BV); older redirects follow.
        // ML-2: both addresses carry the page's language prefix (none for the default language
        // until ML-3/ML-4), so a Dutch slug change writes `/nl/old` -> `/nl/new`.
        if (row.path && keepsOldAddress(a.sites, row.siteId)) {
          const site = await CmsService.site(a, row.siteId);
          await applyAddressChange(tx, a, {
            siteId: row.siteId,
            contentType: "CMS_PAGE",
            contentId: row.id,
            from: previousPath === null ? null : pageAddress(site, row.locale, previousPath),
            to: pageAddress(site, row.locale, row.path),
            permission: PUBLISH,
          });
        }
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
   * DP-219: what the menus of a site may link to (the admin's target picker and its warnings).
   * `content:read` of the site (403 otherwise, audited); the products not live on the site only
   * with `product:read` there as well.
   */
  async menuTargets(ctx: RequestContext, rawSiteId: unknown): Promise<CmsMenuTargetsResponse> {
    const a = await this.access.begin(ctx);
    const siteId = await CmsService.requireSite(a, READ, rawSiteId);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const site = await CmsService.site(a, siteId);
    return menuTargets(
      db,
      siteId,
      a.sitesWith("product:read").includes(siteId),
      defaultLocaleOf(site),
    );
  }

  /**
   * DP-020: copies a published revision (title, address, SEO, content) back into the draft. A
   * normal draft save (`content:edit`, names the draft version, audited); nothing is published.
   * The content is validated again, so a revision of an older schema is refused (409). DP-219: a
   * menu revision of version 1 is read as version 2; its references are not checked again (the
   * editor shows a target that no longer exists, and the next save asks for another one).
   */
  async restore(ctx: RequestContext, rawId: string, body: unknown): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, EDIT, rawId);
    // ML-1 (ADR-028 D2): only in a language that is enabled on the page's site (public or not).
    await assertLocaleEnabled(db, row.siteId, row.locale);
    const input = parseBody(CmsRestoreRequestSchema, body);
    if (input.version !== row.version) throw staleVersion();
    const revision = await db.cmsPageRevision.findFirst({
      where: { pageId: row.id, revisionNumber: input.revisionNumber },
      select: {
        title: true,
        path: true,
        ...SEO_SELECT,
        content: true,
      },
    });
    if (!revision) throw new ApiError("NOT_FOUND", [{ path: "revisionNumber", rule: "unknown" }]);
    let content: Record<string, unknown>;
    const siteKey = (await CmsService.site(a, row.siteId)).key;
    try {
      content = validateContent(row.kind, row.templateKey, revision.content, siteKey);
    } catch {
      throw new ApiError("CONFLICT_STATE", [{ path: "content", rule: "invalid" }]);
    }
    const data = {
      title: revision.title,
      path: revision.path,
      ...pickSeo(revision),
      content,
    };
    try {
      await db.$transaction(async (tx) => {
        if (data.path !== row.path && data.path && keepsOldAddress(a.sites, row.siteId)) {
          const site = await CmsService.site(a, row.siteId);
          await assertAddressFree(
            tx,
            row.siteId,
            pageAddress(site, row.locale, data.path),
            "CMS_PAGE",
            row.id,
          );
        }
        const res = await tx.cmsPage.updateMany({
          where: { id: row.id, version: input.version },
          data: {
            ...data,
            schemaVersion: schemaVersionOf(row.templateKey),
            updatedById: a.userId,
            version: { increment: 1 },
          } as never,
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
    // ML-1 (ADR-028 D2): only in a language that is enabled on the page's site (public or not).
    await assertLocaleEnabled(db, row.siteId, row.locale);
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

  // --- translations (ML-2, DP-074, ADR-028 D6) ----------------------------------------------

  /**
   * Creates the page in another enabled language of its site: the source's structure (section
   * ids and types, links, images, menu targets) with every text empty, as a draft of the same
   * translation group. `content:edit`. Never twice: a group holds one page per language (409
   * `locale` `exists`). The new page records the source's newest revision ("outdated" later).
   */
  async createTranslation(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, EDIT, rawId);
    const input = parseBody(CmsTranslationCreateRequestSchema, body);
    if (input.locale === row.locale) {
      throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "exists" }]);
    }
    // Only a language that is enabled on the site (public or not).
    await assertLocaleEnabled(db, row.siteId, input.locale);
    const site = await CmsService.site(a, row.siteId);
    const article = cmsIsArticle(row);
    // ML-7 / COM-5: the proposal the draft may start from (the Dutch BV menus; the live Turkish
    // corporate pages), or 400 `proposal` `unavailable`.
    const proposal = input.proposal ? cmsTranslationProposal(site.key, row, input.locale) : null;
    if (input.proposal && !proposal) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "proposal", rule: "unavailable" }]);
    }
    let path = row.path;
    if (row.kind === "TEMPLATE" && row.path) {
      const parsed = cmsTranslationSlugSchema(article).safeParse(
        input.slug ?? proposal?.slug ?? cmsSlugOfPath(row.path),
      );
      if (!parsed.success) {
        throw new ApiError("VALIDATION_FAILED", [
          { path: "slug", rule: parsed.error.issues[0]?.message ?? "format" },
        ]);
      }
      const slug = parsed.data;
      path = article ? cmsArticlePath(slug) : cmsPathForSlug(slug);
    } else if (input.slug !== undefined) {
      // Designed pages and fragments keep the address of their registry entry.
      throw new ApiError("VALIDATION_FAILED", [{ path: "slug", rule: "fixed_address" }]);
    }
    const members = await db.cmsPage.findMany({
      where: { siteId: row.siteId, translationGroupId: row.translationGroupId },
      select: {
        id: true,
        locale: true,
        title: true,
        path: true,
        translationGroupId: true,
        translationSourceRevisionId: true,
      },
    });
    if (members.some((m) => m.locale === input.locale)) {
      throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "exists" }]);
    }
    const source = groupSource(members, defaultLocaleOf(site)) ?? row;
    const sourceRevision = await db.cmsPageRevision.findFirst({
      where: { pageId: source.id },
      orderBy: { revisionNumber: "desc" },
      select: { id: true, revisionNumber: true },
    });
    // COM-5: a corporate Turkish proposal is the whole live Turkish content (still a draft); the
    // Dutch menu proposal fills the English structure (ML-7).
    const corporateTr =
      proposal && site.key === "CORPORATE" && input.locale === "tr"
        ? CORPORATE_TR_PROPOSALS[cmsCorporateTrPlace(row)]
        : undefined;
    const content = corporateTr
      ? row.kind === "TEMPLATE"
        ? // A content page or article: the whole live Turkish content (a post may be longer).
          (structuredClone(corporateTr.content) as Record<string, unknown>)
        : // A designed page or menu: the English structure (links, menu targets, shared contact
          // details) with the Turkish texts.
          cmsWithContentTexts(
            row,
            asObject(row.content),
            new Map(
              cmsContentTexts(row, corporateTr.content).flatMap((t) =>
                t.value ? [[t.path, t.value] as const] : [],
              ),
            ),
          )
      : cmsTranslationDraft(
          row,
          asObject(row.content),
          input.proposal ? { locale: input.locale } : undefined,
        );
    try {
      const id = await db.$transaction(async (tx) => {
        if (path && keepsOldAddress(a.sites, row.siteId)) {
          await assertAddressFree(
            tx,
            row.siteId,
            pageAddress(site, input.locale, path),
            "CMS_PAGE",
            null,
          );
        }
        const pageId = newPageId(this.clock.now().getTime());
        await tx.cmsPage.create({
          data: {
            id: pageId,
            translationGroupId: row.translationGroupId,
            translationSourceRevisionId: sourceRevision?.id ?? null,
            siteId: row.siteId,
            kind: row.kind,
            templateKey: row.templateKey,
            path,
            locale: input.locale,
            title: input.title,
            // Texts are translated; the switch and the image stay (the canonical is per address).
            seoTitle: null,
            seoDescription: null,
            noindex: row.noindex,
            canonicalPath: null,
            ogTitle: null,
            ogDescription: null,
            ogImage: row.ogImage,
            content: content as never,
            schemaVersion: schemaVersionOf(row.templateKey),
            createdById: a.userId,
            updatedById: a.userId,
          },
          select: { id: true },
        });
        await a.audit(tx, {
          action: "cms.translation_created",
          resourceType: RESOURCE,
          resourceId: pageId,
          siteId: row.siteId,
          permission: EDIT,
          metadata: {
            locale: input.locale,
            fromPageId: row.id,
            fromLocale: row.locale,
            templateKey: row.templateKey,
            path,
            sourceRevisionNumber: sourceRevision?.revisionNumber ?? null,
          },
        });
        return pageId;
      });
      return this.response(a, db, id);
    } catch (e) {
      return mapCmsDbError(e);
    }
  }

  /**
   * Records that a translation now matches revision `revisionNumber` of its group's source page
   * (clears "outdated"). A draft change: `content:edit`, names the draft version, audited.
   */
  async setTranslationSource(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<CmsPageResponse> {
    const a = await this.access.begin(ctx);
    const { row, db } = await CmsService.pageIn(a, EDIT, rawId);
    await assertLocaleEnabled(db, row.siteId, row.locale);
    const input = parseBody(CmsTranslationSourceRequestSchema, body);
    if (input.version !== row.version) throw staleVersion();
    const site = await CmsService.site(a, row.siteId);
    const members = await db.cmsPage.findMany({
      where: { siteId: row.siteId, translationGroupId: row.translationGroupId },
      select: {
        id: true,
        locale: true,
        title: true,
        path: true,
        translationGroupId: true,
        translationSourceRevisionId: true,
      },
    });
    const source = groupSource(members, defaultLocaleOf(site));
    if (!source || source.id === row.id) {
      throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "is_source" }]);
    }
    const revision = await db.cmsPageRevision.findFirst({
      where: { pageId: source.id, revisionNumber: input.revisionNumber },
      select: { id: true },
    });
    if (!revision) throw new ApiError("NOT_FOUND", [{ path: "revisionNumber", rule: "unknown" }]);
    try {
      await db.$transaction(async (tx) => {
        const res = await tx.cmsPage.updateMany({
          where: { id: row.id, version: input.version },
          data: {
            translationSourceRevisionId: revision.id,
            updatedById: a.userId,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "cms.translation_source_set",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId: row.siteId,
          permission: EDIT,
          metadata: {
            locale: row.locale,
            sourcePageId: source.id,
            sourceRevisionNumber: input.revisionNumber,
            version: input.version + 1,
          },
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
