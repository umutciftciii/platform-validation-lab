/**
 * Public read model of CMS pages (S2, ADR-020 D6/D7), for the site servers through their proxy
 * keys; the site comes from the key (PublicSiteService), never from the request.
 *
 *  - `page(path)`: the PUBLISHED revision of the page at that path, with the published revisions
 *    of the site-wide fragments. A page that is not published is 404; a fragment that is not
 *    published is null, and the site shows nothing in its place. Nothing falls back to content in
 *    code, and a draft never leaves the API here.
 *  - `preview(token)`: the current DRAFT of the page a signed preview token names (15 minutes,
 *    one page, this site only). Fragments come from their published revision, or their draft
 *    when they have none yet (a preview of a site that is not live yet).
 *
 * Content read back is validated again against its template; a row that no longer matches is not
 * served (logged, 404), so a schema change can never break the site with half-valid content.
 *
 * DP-219: the navigation and footer leave the API in their public shape (contracts `BvNavPublic`,
 * `BvFooterPublic`): hidden links dropped, content references resolved to the addresses of the
 * live content now (menu-links.ts); the site never sees a reference or a draft address.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  BV_FRAGMENT_KEYS,
  CMS_NEWS_INDEX_KEYS,
  CORPORATE_FRAGMENT_KEYS,
  cmsIsArticle,
  cmsSlugOfPath,
  seoIsSelfCanonical,
  type CmsArticleContent,
  type CmsPublicAlternate,
  type CmsPublicArticle,
  type CmsPublicBundle,
  type CmsPublicNews,
  type CmsPublicPage,
  type PublicSiteLocalesResponse,
} from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService, type PublicSite } from "../iam/public-site.js";
import {
  SEO_SELECT,
  contentIsValid,
  liveRows,
  publicPage,
  verifyPreviewToken,
  type LiveRow,
} from "./cms-content.js";
import { resolvePublicMenus } from "./menu-links.js";
import { publicLocaleSet, publicSiteLocales } from "./site-locales.js";

/** "/", "/<slug>" or a news article "/news/<slug>" (DP-020). */
const PATH = /^\/(news\/[a-z0-9]+(-[a-z0-9]+)*|([a-z0-9]+(-[a-z0-9]+)*)?)$/;
const FRAGMENTS: Readonly<Record<"BV" | "CORPORATE", readonly string[]>> = {
  BV: BV_FRAGMENT_KEYS,
  // COM-1: the corporate navigation and footer.
  CORPORATE: CORPORATE_FRAGMENT_KEYS,
};

@Injectable()
export class PublicCmsService {
  private readonly log = new Logger("PublicCms");

  constructor(
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private served(site: PublicSite, row: LiveRow): CmsPublicPage | null {
    const { kind, templateKey } = row.page;
    // COM-2a (DP-320): with the site's own rules (its files; an image it may leave empty).
    if (!contentIsValid(kind, templateKey, row.revision.content, site.siteKey)) {
      this.log.error(`a published ${templateKey} revision does not match its schema; not served`);
      return null;
    }
    return publicPage(
      { kind, templateKey, ...row.revision },
      {
        revisionNumber: row.revision.revisionNumber,
        publishedAt: row.publishedAt,
        firstPublishedAt: row.firstPublishedAt,
      },
    );
  }

  /**
   * ML-1 (ADR-028 D2/D14): the published rows visitors may see — only pages in a public language
   * of the site. Content of a language that is enabled but not public is published for staff
   * (admin, signed preview) and answers 404 here; menus never link to it.
   */
  private static async visibleLive(site: PublicSite): Promise<LiveRow[]> {
    const [live, visible] = await Promise.all([
      liveRows(site.db, site.siteId),
      publicLocaleSet(site.db, site.siteId),
    ]);
    return live.filter((r) => visible.has(r.page.locale));
  }

  /**
   * ML-2 (ADR-028 D3/D7): the language of a public read. Without `locale` the site's default
   * language (the behaviour before ML-2); a language that is not public on the site (or unknown,
   * or malformed) is 404 without detail, so a hidden language is never revealed.
   */
  private static async localeOf(
    site: PublicSite,
    raw: unknown,
  ): Promise<{ locale: string; defaultLocale: string }> {
    const { defaultLocale, locales } = await publicSiteLocales(site.db, site.siteId);
    if (raw === undefined || raw === "") return { locale: defaultLocale, defaultLocale };
    if (typeof raw !== "string" || !locales.some((l) => l.locale === raw)) {
      throw new ApiError("NOT_FOUND");
    }
    return { locale: raw, defaultLocale };
  }

  /** The published fragments in their public shape (DP-219: menus resolved). */
  private async fragments(
    site: PublicSite,
    live: LiveRow[],
    locale: { locale: string; defaultLocale: string },
  ): Promise<Record<string, CmsPublicPage | null>> {
    const out = this.liveFragments(site, live, locale.locale);
    await resolvePublicMenus(site, live, out, locale);
    return out;
  }

  /** ML-2: the fragments of one language (no fallback to another language, ADR-028 D7). */
  private liveFragments(
    site: PublicSite,
    live: LiveRow[],
    locale: string,
  ): Record<string, CmsPublicPage | null> {
    const out: Record<string, CmsPublicPage | null> = {};
    for (const key of FRAGMENTS[site.siteKey]) {
      const row = live.find(
        (r) => r.page.kind === "FRAGMENT" && r.page.templateKey === key && r.page.locale === locale,
      );
      out[key] = row ? this.served(site, row) : null;
    }
    return out;
  }

  /** ML-1 (DP-073): the public languages of the key's site; others never appear. */
  async locales(ctx: RequestContext): Promise<PublicSiteLocalesResponse> {
    const site = await this.sites.begin(ctx);
    return publicSiteLocales(site.db, site.siteId);
  }

  async page(ctx: RequestContext, rawPath: unknown, rawLocale?: unknown): Promise<CmsPublicBundle> {
    const path = typeof rawPath === "string" ? rawPath : "";
    if (!PATH.test(path)) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    const locale = await PublicCmsService.localeOf(site, rawLocale);
    const visible = await PublicCmsService.visibleLive(site);
    const live = visible.filter((r) => r.page.locale === locale.locale);
    const row = live.find((r) => r.page.kind !== "FRAGMENT" && r.revision.path === path);
    const page = row ? this.served(site, row) : null;
    if (!page) {
      // DP-020: a page that was live at this address and has been taken off the site answers
      // 404 with the detail `unpublished`, so the site can say so instead of "not found".
      if (!row && (await this.wasUnpublished(site, path, locale.locale))) {
        throw new ApiError("NOT_FOUND", [{ path: "path", rule: "unpublished" }]);
      }
      throw new ApiError("NOT_FOUND");
    }
    return {
      page,
      fragments: await this.fragments(site, live, locale),
      preview: false,
      alternates: row ? PublicCmsService.alternatesOf(visible, row) : [],
    };
  }

  /**
   * ML-3 (DP-236): the published pages of the same translation group in the other public
   * languages (`visible` holds public languages only), sorted by language.
   * ML-5 (DP-019): `indexable` says whether hreflang may name the counterpart (no noindex, its
   * own canonical address: exactly the pages the sitemap lists).
   */
  private static alternatesOf(visible: LiveRow[], row: LiveRow): CmsPublicAlternate[] {
    return visible
      .filter(
        (r) =>
          r.page.translationGroupId === row.page.translationGroupId &&
          r.page.locale !== row.page.locale &&
          r.page.kind !== "FRAGMENT" &&
          r.revision.path !== null,
      )
      .map((r) => {
        const path = r.revision.path as string;
        const indexable = !r.revision.noindex && seoIsSelfCanonical(path, r.revision.canonicalPath);
        return { locale: r.page.locale, path, indexable };
      })
      .sort((a, b) => a.locale.localeCompare(b.locale, "en"));
  }

  /** Whether the page of `locale` last published at `path` is UNPUBLISHED now. */
  private async wasUnpublished(site: PublicSite, path: string, locale: string): Promise<boolean> {
    // ML-1: only pages in a public language count, so a page of a language that is not public
    // (published or taken back) is never revealed by the `unpublished` detail.
    const [found, visible] = await Promise.all([
      site.db.cmsPageRevision.findMany({
        where: { siteId: site.siteId, path },
        select: { id: true, pageId: true },
      }),
      publicLocaleSet(site.db, site.siteId),
    ]);
    if (found.length === 0) return false;
    const pages = await site.db.cmsPage.findMany({
      where: { id: { in: [...new Set(found.map((r) => r.pageId))] } },
      select: { id: true, locale: true },
    });
    const shown = new Set(
      pages.filter((p) => visible.has(p.locale) && p.locale === locale).map((p) => p.id),
    );
    const revisions = found.filter((r) => shown.has(r.pageId));
    if (revisions.length === 0) return false;
    const pub = await site.db.cmsPagePublication.findFirst({
      where: {
        siteId: site.siteId,
        status: "UNPUBLISHED",
        revisionId: { in: revisions.map((r) => r.id) },
      },
      select: { id: true },
    });
    return Boolean(pub);
  }

  /**
   * DP-020: the site's published news articles, newest first by their first publication (title
   * as the tie-break), with the site-wide fragments. Only valid revisions are listed. DP-153: with
   * the published heading page of the list (`bv.news-index`; COM-3: `corporate.news-index` on the
   * corporate site), or null while it is not published. Articles and heading are the site's own
   * (the site comes from the proxy key), so the two sites never see each other's news.
   */
  async news(ctx: RequestContext, rawLocale?: unknown): Promise<CmsPublicNews> {
    const site = await this.sites.begin(ctx);
    const locale = await PublicCmsService.localeOf(site, rawLocale);
    const visible = await PublicCmsService.visibleLive(site);
    const live = visible.filter((r) => r.page.locale === locale.locale);
    const articles: CmsPublicArticle[] = [];
    for (const row of live) {
      if (!cmsIsArticle(row.page) || !row.revision.path) continue;
      const page = this.served(site, row);
      if (!page) continue;
      const c = page.content as unknown as CmsArticleContent;
      articles.push({
        path: row.revision.path,
        slug: cmsSlugOfPath(row.revision.path),
        title: page.title,
        excerpt: c.excerpt,
        coverImage: c.coverImage,
        coverAlt: c.coverAlt,
        firstPublishedAt: row.firstPublishedAt.toISOString(),
        publishedAt: row.publishedAt.toISOString(),
      });
    }
    articles.sort(
      (x, y) =>
        y.firstPublishedAt.localeCompare(x.firstPublishedAt) || x.title.localeCompare(y.title),
    );
    const index = live.find(
      (r) => r.page.kind === "DESIGN" && r.page.templateKey === CMS_NEWS_INDEX_KEYS[site.siteKey],
    );
    return {
      page: index ? this.served(site, index) : null,
      articles,
      fragments: await this.fragments(site, live, locale),
      // ML-5: the list's counterparts (its heading page's translation group).
      alternates: index ? PublicCmsService.alternatesOf(visible, index) : [],
    };
  }

  async preview(ctx: RequestContext, rawToken: string): Promise<CmsPublicBundle> {
    const site = await this.sites.begin(ctx);
    const pageId = verifyPreviewToken(
      this.config.secrets.hmacKey,
      rawToken,
      site.siteKey,
      this.clock.now(),
    );
    if (!pageId) throw new ApiError("NOT_FOUND");
    const draft = await site.db.cmsPage.findUnique({
      where: { id: pageId },
      select: {
        kind: true,
        templateKey: true,
        path: true,
        title: true,
        locale: true,
        ...SEO_SELECT,
        content: true,
      },
    });
    if (!draft || !contentIsValid(draft.kind, draft.templateKey, draft.content, site.siteKey)) {
      throw new ApiError("NOT_FOUND");
    }
    const { locale: draftLocale, ...draftPage } = draft;
    const target = publicPage(draftPage, null);
    // ML-2: the preview shows the page with the fragments of its own language (published ones,
    // else their drafts); staff preview a language that is not public as well.
    const { defaultLocale } = await publicSiteLocales(site.db, site.siteId);
    const locale = { locale: draftLocale, defaultLocale };
    const live = (await liveRows(site.db, site.siteId)).filter(
      (r) => r.page.locale === draftLocale,
    );
    const fragments = this.liveFragments(site, live, draftLocale);
    const missing = Object.keys(fragments).filter((k) => !fragments[k]);
    if (missing.length) {
      const drafts = await site.db.cmsPage.findMany({
        where: { siteId: site.siteId, locale: draftLocale, templateKey: { in: missing } },
        select: {
          kind: true,
          templateKey: true,
          path: true,
          title: true,
          ...SEO_SELECT,
          content: true,
        },
      });
      for (const d of drafts) {
        if (contentIsValid(d.kind, d.templateKey, d.content, site.siteKey))
          fragments[d.templateKey] = publicPage(d, null);
      }
    }
    if (target.kind === "FRAGMENT") {
      // Previewing a fragment shows it on the home page: the fragment's draft around the home page
      // (published, or its draft before the first publication).
      fragments[target.templateKey] = target;
      const home = await this.homeForFragmentPreview(site, live, draftLocale);
      // COM-2b: every site has its home page in the CMS (corporate.home); without one (not
      // imported yet in this language) there is nothing to show the fragment on.
      if (!home) throw new ApiError("NOT_FOUND");
      await resolvePublicMenus(site, live, fragments, locale);
      return { page: home, fragments, preview: true, locale: draftLocale };
    }
    await resolvePublicMenus(site, live, fragments, locale);
    // DP-250: the draft's language, so the site renders the preview in it.
    return { page: target, fragments, preview: true, locale: draftLocale };
  }

  private async homeForFragmentPreview(
    site: PublicSite,
    live: LiveRow[],
    locale: string,
  ): Promise<CmsPublicPage | null> {
    const row = live.find((r) => r.page.kind !== "FRAGMENT" && r.revision.path === "/");
    if (row) return this.served(site, row);
    const draft = await site.db.cmsPage.findFirst({
      where: { siteId: site.siteId, locale, path: "/" },
      select: {
        kind: true,
        templateKey: true,
        path: true,
        title: true,
        ...SEO_SELECT,
        content: true,
      },
    });
    return draft && contentIsValid(draft.kind, draft.templateKey, draft.content, site.siteKey)
      ? publicPage(draft, null)
      : null;
  }
}
