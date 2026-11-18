/**
 * DP-207: technical SEO reads of a public site (contract: @dream/contracts `seo.ts`). The site
 * comes from the proxy key (PublicSiteService), never from the request.
 *
 *  - `resolve(path)`: whether the address has live content now. A fast existence check for the
 *    site server, asked before rendering so an unknown address is a real HTTP 404. It reads only
 *    publication rows and paths (no page content); the page itself still validates its content.
 *  - `sitemap()`: the indexable live addresses with their last publication date. CMS pages and
 *    articles with noindex, fragments, drafts and unpublished pages are left out; products only
 *    while live (published, listing visible, master not archived: catalog/live.ts).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  PublishedSnapshotSchema,
  SEO_RESOLVABLE_PATH,
  cmsIsArticle,
  type PublicSeoResolveResponse,
  type PublicSitemapEntry,
  type PublicSitemapResponse,
  type SeoPathKind,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService, type PublicSite } from "../iam/public-site.js";
import { liveRows as liveProducts } from "../catalog/live.js";

interface LivePath {
  path: string;
  kind: SeoPathKind;
  noindex: boolean;
  publishedAt: Date;
}

const PRODUCTS_PREFIX = "/products/";

/** The kind of a live CMS address; the two list pages are designed pages at fixed paths. */
function kindOf(path: string, page: { kind: string; templateKey: string }): SeoPathKind {
  if (path === "/") return "home";
  if (page.templateKey === "bv.news-index") return "news";
  if (page.templateKey === "bv.products-index") return "products";
  return cmsIsArticle(page) ? "article" : "page";
}

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path, "en");

@Injectable()
export class PublicSeoService {
  constructor(@Inject(PublicSiteService) private readonly sites: PublicSiteService) {}

  /** Published CMS pages and articles of the site with their path (fragments have none). */
  private static async livePages(site: PublicSite): Promise<LivePath[]> {
    const pubs = await site.db.cmsPagePublication.findMany({
      where: { siteId: site.siteId, status: "PUBLISHED" },
      select: { pageId: true, revisionId: true, publishedAt: true },
    });
    if (pubs.length === 0) return [];
    const [revisions, pages] = await Promise.all([
      site.db.cmsPageRevision.findMany({
        where: { id: { in: pubs.map((p) => p.revisionId) } },
        select: { id: true, path: true, noindex: true },
      }),
      site.db.cmsPage.findMany({
        where: { id: { in: pubs.map((p) => p.pageId) } },
        select: { id: true, kind: true, templateKey: true },
      }),
    ]);
    const out: LivePath[] = [];
    for (const p of pubs) {
      const r = revisions.find((x) => x.id === p.revisionId);
      const page = pages.find((x) => x.id === p.pageId);
      if (!r?.path || !page || page.kind === "FRAGMENT") continue;
      out.push({
        path: r.path,
        kind: kindOf(r.path, page),
        noindex: r.noindex,
        publishedAt: p.publishedAt,
      });
    }
    return out;
  }

  /** Slugs of the live products of the site, from their published snapshot. */
  private static async liveProductPaths(site: PublicSite, slug?: string): Promise<LivePath[]> {
    const rows = await liveProducts(
      site,
      slug ? { snapshot: { path: ["slug"], equals: slug } } : {},
    );
    const out: LivePath[] = [];
    for (const row of rows) {
      const s = PublishedSnapshotSchema.safeParse(row.snapshot);
      if (!s.success) continue;
      out.push({
        path: `${PRODUCTS_PREFIX}${s.data.slug}`,
        kind: "product",
        noindex: false,
        publishedAt: row.publishedAt,
      });
    }
    return out;
  }

  /** Whether the CMS page last published at `path` is UNPUBLISHED now (DP-020 rule). */
  private static async wasUnpublished(site: PublicSite, path: string): Promise<boolean> {
    const revisions = await site.db.cmsPageRevision.findMany({
      where: { siteId: site.siteId, path },
      select: { id: true },
    });
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

  async resolve(ctx: RequestContext, rawPath: unknown): Promise<PublicSeoResolveResponse> {
    const path = typeof rawPath === "string" ? rawPath : "";
    if (!SEO_RESOLVABLE_PATH.test(path)) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    if (path.startsWith(PRODUCTS_PREFIX)) {
      const [hit] = await PublicSeoService.liveProductPaths(
        site,
        path.slice(PRODUCTS_PREFIX.length),
      );
      if (hit?.path === path) return { path, kind: "product" };
      throw new ApiError("NOT_FOUND");
    }
    const hit = (await PublicSeoService.livePages(site)).find((p) => p.path === path);
    if (hit) return { path, kind: hit.kind };
    if (await PublicSeoService.wasUnpublished(site, path)) {
      throw new ApiError("NOT_FOUND", [{ path: "path", rule: "unpublished" }]);
    }
    throw new ApiError("NOT_FOUND");
  }

  async sitemap(ctx: RequestContext): Promise<PublicSitemapResponse> {
    const site = await this.sites.begin(ctx);
    const [pages, products] = await Promise.all([
      PublicSeoService.livePages(site),
      PublicSeoService.liveProductPaths(site),
    ]);
    const entry = (p: LivePath): PublicSitemapEntry => ({
      path: p.path,
      kind: p.kind,
      lastModified: p.publishedAt.toISOString(),
    });
    const of = (kind: SeoPathKind) => pages.filter((p) => p.kind === kind).sort(byPath);
    const latest = (rows: LivePath[]): string | null =>
      rows.length
        ? new Date(Math.max(...rows.map((r) => r.publishedAt.getTime()))).toISOString()
        : null;
    // The product list is an app page; its designed heading page may switch it to noindex.
    const productsIndex = pages.find((p) => p.kind === "products");
    const entries: PublicSitemapEntry[] = [
      ...of("home")
        .filter((p) => !p.noindex)
        .map(entry),
      ...(productsIndex?.noindex
        ? []
        : [{ path: "/products", kind: "products" as const, lastModified: latest(products) }]),
      ...[...products].sort(byPath).map(entry),
      ...of("page")
        .filter((p) => !p.noindex)
        .map(entry),
      // The news list exists only while its heading page is published (DP-153).
      ...of("news")
        .filter((p) => !p.noindex)
        .map((p) => ({ ...entry(p), lastModified: latest([p, ...of("article")]) })),
      ...of("article")
        .filter((p) => !p.noindex)
        .map(entry),
    ];
    const seen = new Set<string>();
    return { entries: entries.filter((e) => !seen.has(e.path) && Boolean(seen.add(e.path))) };
  }
}
