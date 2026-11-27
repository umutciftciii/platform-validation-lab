/**
 * DP-207: technical SEO reads of a public site (contract: @dream/contracts `seo.ts`). The site
 * comes from the proxy key (PublicSiteService), never from the request.
 *
 *  - `resolve(path)`: whether the address has live content now. A fast existence check for the
 *    site server, asked before rendering so an unknown address is a real HTTP 404. It reads only
 *    publication rows and paths (no page content); the page itself still validates its content.
 *  - `sitemap()`: the indexable live addresses with their last publication date. CMS pages and
 *    articles with noindex, fragments, drafts and unpublished pages are left out; products only
 *    while live (published, listing visible, master not archived: catalog/live.ts). DP-209: a
 *    page or product with noindex, or whose canonical names another address, is left out too
 *    (from its PUBLISHED state: a draft never changes the sitemap).
 *  - `settings()` (DP-209): the published site SEO defaults (`bv.site-seo`; COM-1 the corporate
 *    site's `corporate.site-seo`), or null.
 *  - COM-1: the corporate site has no catalogue routes (contracts CATALOGUE_SITE_KEYS): neither
 *    `resolve` nor `sitemap` answers a product address or the product list for it.
 *  - DP-210: `resolve(path)` answers an address without live content with its active redirect
 *    (`{ path, redirect: { target, statusCode } }`), so the proxy can send a 301 before rendering.
 *    Old addresses never appear in the sitemap (it lists live content only).
 *  - DP-211: `resolve(path, query)` also matches a manual or imported redirect bound to the
 *    request's query; redirect sources never have live content, so they never reach the sitemap.
 *  - DP-212: an old-site address (`/en/…`, upper case, `.html`, deeper paths) is answered with its
 *    redirect only (lower-case lookup, `seoLegacyPath`); without one it is a 404.
 *  - ML-2 (ADR-028 D3/D6): pages exist per language. Until the `/en` routing (ML-3/ML-4) the
 *    unprefixed addresses resolve, list and redirect the site's default language only, exactly as
 *    before. An address under the prefix of a language that is not public (`/nl/...` on BV) is a
 *    404 without detail, even when a Dutch slug-change redirect exists for it (nothing of a hidden
 *    language is revealed). `settings(locale)` reads `bv.site-seo` of that language.
 *  - ML-5 (DP-019): `sitemap()` lists every public language with its translation counterparts
 *    (hreflang); see the method.
 *  - ML-8c (DP-239): the catalogue exists in every public language: a product is live in a
 *    language when its live publication has a complete text in it (`readSnapshot`, no fallback).
 *    `resolve` answers `/products/<slug>` with `locale`, the sitemap lists each language's products
 *    and product list, and a product's counterparts are the same product in the other public
 *    languages it is published in.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  readSnapshot,
  readSnapshotAddress,
  CATALOGUE_SITE_KEYS,
  CMS_SITE_SEO_KEYS,
  PublicSiteSeoSettingsSchema,
  SEO_RESOLVABLE_PATH,
  cmsFieldsSchema,
  cmsIsArticle,
  cmsSiteSeoFields,
  cmsLocaleAddress,
  normalizeRedirectQuery,
  seoIsSelfCanonical,
  seoLegacyPath,
  type PublicSiteSeoResponse,
  type PublicSeoResolveResponse,
  type PublicSitemapEntry,
  type PublicSitemapResponse,
  type SeoPathKind,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService, type PublicSite } from "../iam/public-site.js";
import { liveRows as liveProducts } from "../catalog/live.js";
import { publicLocaleSet, publicSiteLocales, siteLocalesOf } from "../cms/site-locales.js";

interface LivePath {
  /** The stored path (without a language prefix). */
  path: string;
  /** ML-2: the page's language (products: the site's default language). */
  locale: string | null;
  kind: SeoPathKind;
  noindex: boolean;
  /** DP-209: the published canonical override (null: the address itself). */
  canonicalPath: string | null;
  publishedAt: Date;
  /**
   * ML-5: the CMS translation group. ML-8c: a product's group is the product itself (the same
   * product in another language is its counterpart); the product list is one group too.
   */
  translationGroupId: string | null;
}

/** DP-209: in the sitemap only when indexable and its own canonical address. */
const listed = (p: LivePath) => !p.noindex && seoIsSelfCanonical(p.path, p.canonicalPath);

const PRODUCTS_PREFIX = "/products/";
/** ML-8c: the product lists of every language are counterparts of each other. */
const PRODUCT_LIST_GROUP = "catalogue:products";

/** The kind of a live CMS address; the two list pages are designed pages at fixed paths. */
export function kindOf(path: string, page: { kind: string; templateKey: string }): SeoPathKind {
  if (path === "/") return "home";
  if (page.templateKey === "bv.news-index") return "news";
  if (page.templateKey === "bv.products-index") return "products";
  return cmsIsArticle(page) ? "article" : "page";
}

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path, "en");

/** COM-1: whether the site's frontend has the catalogue routes (contracts CATALOGUE_SITE_KEYS). */
function hasCatalogue(site: Pick<PublicSite, "siteKey">): boolean {
  return CATALOGUE_SITE_KEYS.includes(site.siteKey);
}

/** The reads the live-address helpers need: a site-scoped client and the site (DP-211 shares them). */
export type SiteReader = Pick<PublicSite, "db" | "siteId">;

/**
 * DP-211: every address of the site that has live content now (published CMS pages and articles,
 * live products). The admin redirect checks use it: a redirect never starts at a live address.
 */
export async function liveAddresses(site: SiteReader): Promise<Set<string>> {
  const [pages, products, defaultLocale] = await Promise.all([
    PublicSeoService.livePages(site),
    PublicSeoService.liveProductPaths(site),
    siteDefaultLocale(site),
  ]);
  // ML-2: a page's address carries its language prefix (none for the default language today).
  return new Set([
    ...pages.map((p) => cmsLocaleAddress(p.path, p.locale ?? defaultLocale, defaultLocale)),
    ...products.map((p) => p.path),
  ]);
}

/** ML-2: the site's default language (exactly one per site in the database). */
export async function siteDefaultLocale(site: SiteReader): Promise<string> {
  const all = (await siteLocalesOf(site.db, [site.siteId])).get(site.siteId) ?? [];
  const def = all.find((l) => l.isDefault);
  if (!def) throw new ApiError("INTERNAL_ERROR");
  return def.locale;
}

@Injectable()
export class PublicSeoService {
  private readonly log = new Logger("PublicSeo");

  constructor(@Inject(PublicSiteService) private readonly sites: PublicSiteService) {}

  /**
   * Published CMS pages and articles of the site with their path (fragments have none).
   * ML-1: `publicOnly` keeps only pages in a public language (resolve, sitemap); the admin's
   * address checks see every published page, whatever its language.
   */
  static async livePages(
    site: SiteReader,
    { publicOnly = false, locale }: { publicOnly?: boolean; locale?: string } = {},
  ): Promise<LivePath[]> {
    const pubs = await site.db.cmsPagePublication.findMany({
      where: { siteId: site.siteId, status: "PUBLISHED" },
      select: { pageId: true, revisionId: true, publishedAt: true },
    });
    if (pubs.length === 0) return [];
    const [revisions, pages] = await Promise.all([
      site.db.cmsPageRevision.findMany({
        where: { id: { in: pubs.map((p) => p.revisionId) } },
        select: { id: true, path: true, noindex: true, canonicalPath: true },
      }),
      site.db.cmsPage.findMany({
        where: { id: { in: pubs.map((p) => p.pageId) } },
        select: { id: true, kind: true, templateKey: true, locale: true, translationGroupId: true },
      }),
    ]);
    const visible = publicOnly ? await publicLocaleSet(site.db, site.siteId) : null;
    const out: LivePath[] = [];
    for (const p of pubs) {
      const r = revisions.find((x) => x.id === p.revisionId);
      const page = pages.find((x) => x.id === p.pageId);
      if (!r?.path || !page || page.kind === "FRAGMENT") continue;
      if (visible && !visible.has(page.locale)) continue;
      if (locale !== undefined && page.locale !== locale) continue;
      out.push({
        path: r.path,
        locale: page.locale,
        kind: kindOf(r.path, page),
        noindex: r.noindex,
        canonicalPath: r.canonicalPath,
        publishedAt: p.publishedAt,
        translationGroupId: page.translationGroupId,
      });
    }
    return out;
  }

  /**
   * Slugs of the live products of the site, from their published snapshot. ML-8c: with
   * `locale` (a language other than the default one) only the products whose live publication has
   * a complete text in that language; the default language lists every live product, as before.
   */
  static async liveProductPaths(
    site: SiteReader,
    slug?: string,
    locale?: string,
  ): Promise<LivePath[]> {
    const rows = await liveProducts(
      site,
      slug ? { snapshot: { path: ["slug"], equals: slug } } : {},
    );
    const out: LivePath[] = [];
    for (const row of rows) {
      // ML-8a: v1 and v2 snapshots; the address fields are language-neutral.
      const s = readSnapshotAddress(row.snapshot);
      if (!s) continue;
      if (locale !== undefined && readSnapshot(row.snapshot, locale) === null) continue;
      out.push({
        path: `${PRODUCTS_PREFIX}${s.slug}`,
        locale: null,
        kind: "product",
        noindex: s.noindex,
        canonicalPath: s.canonicalPath,
        publishedAt: row.publishedAt,
        translationGroupId: `product:${row.productId}`,
      });
    }
    return out;
  }

  /** Whether the CMS page of `locale` last published at `path` is UNPUBLISHED now (DP-020). */
  private static async wasUnpublished(
    site: PublicSite,
    path: string,
    locale: string,
  ): Promise<boolean> {
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
   * DP-210: the active redirect of an address without live content. Live content always wins:
   * the API switches a redirect off when content goes live at its source again, and DP-211 never
   * lets a redirect start at a live address.
   * DP-211: a redirect bound to the request's exact query (parameters in any order) comes first
   * and sends its target as is (`keepQuery: false`); otherwise the plain redirect of the path.
   */
  private static async redirectOf(
    site: PublicSite,
    path: string,
    query: string,
  ): Promise<PublicSeoResolveResponse | null> {
    const status = (code: number) => (code === 302 ? 302 : 301);
    if (query) {
      const bound = await site.db.siteRedirect.findFirst({
        where: { siteId: site.siteId, sourcePath: path, sourceQuery: query, active: true },
        select: { target: true, statusCode: true },
      });
      if (bound) {
        return {
          path,
          redirect: {
            target: bound.target,
            statusCode: status(bound.statusCode),
            keepQuery: false,
          },
        };
      }
    }
    const r = await site.db.siteRedirect.findFirst({
      where: { siteId: site.siteId, sourcePath: path, sourceQuery: "", active: true },
      select: { target: true, statusCode: true },
    });
    if (!r) return null;
    return { path, redirect: { target: r.target, statusCode: status(r.statusCode) } };
  }

  async resolve(
    ctx: RequestContext,
    rawPath: unknown,
    rawQuery: unknown = "",
    rawLocale: unknown = undefined,
  ): Promise<PublicSeoResolveResponse> {
    const path = typeof rawPath === "string" ? rawPath : "";
    if (rawLocale !== undefined && rawLocale !== "") {
      return this.resolveInLocale(ctx, path, rawQuery, rawLocale);
    }
    // DP-212: an address the site does not serve in its own form (an old-site address such as
    // `/en/products/x`, `/en/About-Us`, `/en/contact-us.html`) is answered with its redirect only,
    // looked up in lower case like the stored sources; never with live content. A trailing "/"
    // stays a 404 here (DP-210): the site's framework sends `/x/` to `/x` (308) before asking.
    const legacy =
      SEO_RESOLVABLE_PATH.test(path) || path.endsWith("/") ? null : seoLegacyPath(path);
    if (!SEO_RESOLVABLE_PATH.test(path) && !legacy) throw new ApiError("NOT_FOUND");
    // DP-211: the request's query in stored form; one that cannot be stored matches no redirect.
    const parsedQuery =
      typeof rawQuery === "string" && rawQuery.length <= 2000
        ? normalizeRedirectQuery(rawQuery)
        : null;
    const query = parsedQuery?.ok ? parsedQuery.value : "";
    const site = await this.sites.begin(ctx);
    // ML-2: nothing under the prefix of a language that is not public (or not enabled).
    const locales = (await siteLocalesOf(site.db, [site.siteId])).get(site.siteId) ?? [];
    const first = path.split("/")[1]?.toLowerCase() ?? "";
    if (locales.some((l) => l.locale.toLowerCase() === first && !(l.enabled && l.public))) {
      throw new ApiError("NOT_FOUND");
    }
    const defaultLocale = locales.find((l) => l.isDefault)?.locale;
    if (!defaultLocale) throw new ApiError("INTERNAL_ERROR");
    if (legacy) {
      const moved = await PublicSeoService.redirectOf(site, legacy, query);
      if (moved) return { ...moved, path };
      throw new ApiError("NOT_FOUND");
    }
    if (path.startsWith(PRODUCTS_PREFIX) && hasCatalogue(site)) {
      const [hit] = await PublicSeoService.liveProductPaths(
        site,
        path.slice(PRODUCTS_PREFIX.length),
      );
      if (hit?.path === path) return { path, kind: "product" };
      const moved = await PublicSeoService.redirectOf(site, path, query);
      if (moved) return moved;
      throw new ApiError("NOT_FOUND");
    }
    const hit = (
      await PublicSeoService.livePages(site, { publicOnly: true, locale: defaultLocale })
    ).find((p) => p.path === path);
    if (hit) return { path, kind: hit.kind };
    const moved = await PublicSeoService.redirectOf(site, path, query);
    if (moved) return moved;
    if (await PublicSeoService.wasUnpublished(site, path, defaultLocale)) {
      throw new ApiError("NOT_FOUND", [{ path: "path", rule: "unpublished" }]);
    }
    throw new ApiError("NOT_FOUND");
  }

  /**
   * ML-3 (DP-236, ADR-028 D3/D7): an address inside a language named by the site (`/over-ons`
   * with `locale=nl` for the public address `/nl/over-ons`). The default language answers as
   * without `locale`. Another language must be enabled and public on the site (else 404 without
   * detail, a hidden language is never revealed); only its own live pages count (no fallback to
   * English), then its redirects at their stored address (`/nl/old` → `/nl/new`, ML-2 slug
   * changes) and the `unpublished` detail. Old-site addresses exist in the default language only.
   * ML-8c: `/products/<slug>` is found when the product's live publication has a complete text
   * in the language; a product slug change (stored once, language-neutral: `/products/old` →
   * `/products/new`) answers inside the language only towards a product live in it.
   */
  private async resolveInLocale(
    ctx: RequestContext,
    path: string,
    rawQuery: unknown,
    rawLocale: unknown,
  ): Promise<PublicSeoResolveResponse> {
    if (typeof rawLocale !== "string" || rawLocale.length > 35) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    const { defaultLocale, locales } = await publicSiteLocales(site.db, site.siteId);
    if (!locales.some((l) => l.locale === rawLocale)) throw new ApiError("NOT_FOUND");
    if (rawLocale === defaultLocale) return this.resolve(ctx, path, rawQuery);
    if (!SEO_RESOLVABLE_PATH.test(path)) throw new ApiError("NOT_FOUND");
    const parsedQuery =
      typeof rawQuery === "string" && rawQuery.length <= 2000
        ? normalizeRedirectQuery(rawQuery)
        : null;
    const query = parsedQuery?.ok ? parsedQuery.value : "";
    const address = cmsLocaleAddress(path, rawLocale, defaultLocale);
    if (path.startsWith(PRODUCTS_PREFIX) && hasCatalogue(site)) {
      const inLocale = (slug: string) =>
        PublicSeoService.liveProductPaths(site, slug, rawLocale).then(([hit]) => hit);
      const hit = await inLocale(path.slice(PRODUCTS_PREFIX.length));
      if (hit?.path === path) return { path: address, kind: "product" };
      // The product's own slug-change row (written at the stored, unprefixed address) only.
      const moved = await PublicSeoService.redirectOf(site, path, "");
      const redirect = moved && "redirect" in moved ? moved.redirect : null;
      if (redirect?.target.startsWith(PRODUCTS_PREFIX)) {
        const next = await inLocale(redirect.target.slice(PRODUCTS_PREFIX.length));
        if (next?.path === redirect.target) {
          return {
            path: address,
            redirect: {
              target: cmsLocaleAddress(redirect.target, rawLocale, defaultLocale),
              statusCode: redirect.statusCode,
            },
          };
        }
      }
      throw new ApiError("NOT_FOUND");
    }
    const hit = (
      await PublicSeoService.livePages(site, { publicOnly: true, locale: rawLocale })
    ).find((p) => p.path === path);
    if (hit) return { path: address, kind: hit.kind };
    const moved = await PublicSeoService.redirectOf(site, address, query);
    if (moved) return moved;
    if (await PublicSeoService.wasUnpublished(site, path, rawLocale)) {
      throw new ApiError("NOT_FOUND", [{ path: "path", rule: "unpublished" }]);
    }
    throw new ApiError("NOT_FOUND");
  }

  /**
   * DP-209: the site's SEO defaults: the PUBLISHED `bv.site-seo` fragment, validated again
   * against its fields (a revision that no longer matches is not served). null while it is not
   * published (or for a site without SEO defaults): the site then uses its code defaults.
   */
  async settings(ctx: RequestContext, rawLocale?: unknown): Promise<PublicSiteSeoResponse> {
    const site = await this.sites.begin(ctx);
    const none = { settings: null, publishedAt: null };
    // ML-2: per language (default: the site's default language); a language that is not public
    // is 404, as on the public CMS reads.
    const { defaultLocale, locales } = await publicSiteLocales(site.db, site.siteId);
    const locale = rawLocale === undefined || rawLocale === "" ? defaultLocale : rawLocale;
    if (typeof locale !== "string" || !locales.some((l) => l.locale === locale)) {
      throw new ApiError("NOT_FOUND");
    }
    // COM-1: each site has its own SEO defaults fragment (`bv.site-seo`, `corporate.site-seo`).
    const templateKey = CMS_SITE_SEO_KEYS[site.siteKey];
    const page = await site.db.cmsPage.findFirst({
      where: { siteId: site.siteId, locale, kind: "FRAGMENT", templateKey },
      select: { id: true },
    });
    if (!page) return none;
    const pub = await site.db.cmsPagePublication.findUnique({
      where: { pageId: page.id },
      select: { status: true, revisionId: true, publishedAt: true },
    });
    if (pub?.status !== "PUBLISHED") return none;
    const revision = await site.db.cmsPageRevision.findUnique({
      where: { id: pub.revisionId },
      select: { content: true },
    });
    const content = cmsFieldsSchema(cmsSiteSeoFields(templateKey)).safeParse(revision?.content);
    const settings = content.success ? PublicSiteSeoSettingsSchema.safeParse(content.data) : null;
    if (!settings?.success) {
      this.log.error(`the published ${templateKey} revision does not match its schema; not served`);
      return none;
    }
    return { settings: settings.data, publishedAt: pub.publishedAt.toISOString() };
  }

  /**
   * ML-5 (DP-019, ADR-028 D3): the sitemap of every PUBLIC language. Each language lists its own
   * live, indexable pages at their paths inside the language (the site adds the prefix); a
   * language that is not public lists nothing. ML-8c: the catalogue of each language lists the
   * products published in it (complete text, `liveProductPaths(locale)`) and, while it has one,
   * the product list. Each entry names its counterparts in the other public
   * languages — same translation group, itself listed (indexable, its own canonical) — so hreflang
   * is reciprocal and never points at a draft, a noindex page or a hidden language. Redirect
   * sources never have live content, so they are never listed.
   */
  async sitemap(ctx: RequestContext): Promise<PublicSitemapResponse> {
    const site = await this.sites.begin(ctx);
    const { defaultLocale, locales } = await publicSiteLocales(site.db, site.siteId);
    // COM-1: a site without catalogue routes lists no product and no product list.
    const withCatalogue = hasCatalogue(site);
    const [pages, products, ...translated] = await Promise.all([
      PublicSeoService.livePages(site, { publicOnly: true }),
      withCatalogue ? PublicSeoService.liveProductPaths(site) : Promise.resolve([]),
      ...locales
        .filter((l) => l.locale !== defaultLocale)
        .map((l) =>
          withCatalogue
            ? PublicSeoService.liveProductPaths(site, undefined, l.locale)
            : Promise.resolve([]),
        ),
    ]);
    const others = locales.filter((l) => l.locale !== defaultLocale);
    const catalogueOf = (locale: string): LivePath[] =>
      locale === defaultLocale
        ? products
        : (translated[others.findIndex((l) => l.locale === locale)] ?? []);
    const latest = (rows: LivePath[]): string | null =>
      rows.length
        ? new Date(Math.max(...rows.map((r) => r.publishedAt.getTime()))).toISOString()
        : null;
    type Draft = Omit<PublicSitemapEntry, "alternates"> & { group: string | null };
    const drafts: Draft[] = [];
    const entry = (p: LivePath, locale: string): Draft => ({
      path: p.path,
      locale,
      kind: p.kind,
      lastModified: p.publishedAt.toISOString(),
      group: p.translationGroupId,
    });
    for (const { locale } of locales) {
      const own = pages.filter((p) => p.locale === locale);
      const of = (kind: SeoPathKind) => own.filter((p) => p.kind === kind).sort(byPath);
      const catalogue = catalogueOf(locale);
      // The product list is an app page; its designed heading page may switch it to noindex.
      // ML-8c: in another language it exists only while that language has a live product.
      const productsIndex = own.find((p) => p.kind === "products");
      const hasList = withCatalogue && (locale === defaultLocale || catalogue.length > 0);
      drafts.push(
        ...of("home")
          .filter(listed)
          .map((p) => entry(p, locale)),
        ...(hasList && !productsIndex?.noindex
          ? [
              {
                path: "/products",
                locale,
                kind: "products" as const,
                lastModified: latest(catalogue),
                group: PRODUCT_LIST_GROUP,
              },
            ]
          : []),
        ...[...catalogue]
          .filter(listed)
          .sort(byPath)
          .map((p) => entry(p, locale)),
        ...of("page")
          .filter(listed)
          .map((p) => entry(p, locale)),
        // The news list exists only while its heading page is published (DP-153).
        ...of("news")
          .filter(listed)
          .map((p) => ({ ...entry(p, locale), lastModified: latest([p, ...of("article")]) })),
        ...of("article")
          .filter(listed)
          .map((p) => entry(p, locale)),
      );
    }
    const seen = new Set<string>();
    const unique = drafts.filter((e) => {
      const key = `${e.locale} ${e.path}`;
      return !seen.has(key) && Boolean(seen.add(key));
    });
    const entries = unique.map(({ group, ...e }): PublicSitemapEntry => {
      const alternates = group
        ? unique
            .filter((o) => o.group === group && o.locale !== e.locale)
            .map((o) => ({ locale: o.locale, path: o.path }))
            .sort((a, b) => a.locale.localeCompare(b.locale, "en"))
        : [];
      // One counterpart per language (a group holds at most one page per language).
      const perLocale = alternates.filter(
        (a, i) => alternates.findIndex((x) => x.locale === a.locale) === i,
      );
      return { ...e, alternates: perLocale };
    });
    return { entries };
  }
}
