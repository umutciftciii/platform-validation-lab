/**
 * DP-209: the SEO overview of a site for the admin "SEO" section (contract: @dream/contracts
 * `admin/seo-admin.ts`). Read only: the values are edited in the existing editors (CMS page
 * editor, product SEO tab, the `bv.site-seo` fragment), so nothing is stored twice.
 *
 * Authorization (existing permissions, none new): CMS pages with `content:read` of the site,
 * products with `product:read` of the site; a caller with neither is refused (403, audited). The
 * answer names what the caller may change, the API checks it again on every change.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  BV_SITE_SEO_KEY,
  PublicSiteSeoSettingsSchema,
  readSnapshotAddress,
  seoIsSelfCanonical,
  type SeoOverviewItem,
  type SeoOverviewResponse,
} from "@dream/contracts";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService } from "../iam/staff/access.js";
import { SEO_SELECT } from "../cms/cms-content.js";
import { LISTING_TEXT_SELECT } from "../catalog/snapshot.js";
import { ApiError } from "../iam/http/api-error.js";
import { kindOf, siteDefaultLocale } from "./public-seo.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SITE = "00000000-0000-0000-0000-000000000000";
const MAX_ITEMS = 2000;

@Injectable()
export class AdminSeoService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  async overview(
    ctx: RequestContext,
    rawSiteId: string,
    part: "all" | "settings" = "all",
  ): Promise<SeoOverviewResponse> {
    const a = await this.access.begin(ctx);
    const siteId = UUID.test(rawSiteId) ? rawSiteId.toLowerCase() : NO_SITE;
    const has = (permission: string) => a.sitesWith(permission).includes(siteId);
    const permissions = {
      readPages: has("content:read"),
      editPages: has("content:edit"),
      publishPages: has("content:publish"),
      readProducts: has("product:read"),
      editProducts: has("product:edit"),
    };
    if (!permissions.readPages && !permissions.readProducts) {
      // Refused and audited like any other read without the right.
      await a.require(
        "content:read",
        { scope: "site", siteId },
        { type: "seo_overview", id: null },
      );
    }
    const site = a.sites.find((s) => s.id === siteId);
    if (!site) throw new ApiError("NOT_FOUND");
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    // ML-2: the overview shows the site's default language (per-language SEO: ML-5).
    const locale = await siteDefaultLocale({ db, siteId });
    const items: SeoOverviewItem[] = [];
    let settings: SeoOverviewResponse["settings"] = null;
    let liveSettings: SeoOverviewResponse["liveSettings"] = null;

    if (permissions.readPages) {
      const [pages, pubs] = await Promise.all([
        db.cmsPage.findMany({
          where: { siteId, locale },
          select: {
            id: true,
            kind: true,
            templateKey: true,
            path: true,
            title: true,
            version: true,
            ...SEO_SELECT,
          },
          orderBy: [{ path: "asc" }, { title: "asc" }],
          take: MAX_ITEMS,
        }),
        db.cmsPagePublication.findMany({
          where: { siteId },
          select: { pageId: true, status: true, revisionId: true },
        }),
      ]);
      const revisions = pubs.length
        ? await db.cmsPageRevision.findMany({
            where: { id: { in: pubs.map((p) => p.revisionId) } },
            select: { id: true, pageVersion: true, path: true, noindex: true, canonicalPath: true },
          })
        : [];
      for (const page of pages) {
        const pub = pubs.find((p) => p.pageId === page.id) ?? null;
        const rev = pub ? (revisions.find((r) => r.id === pub.revisionId) ?? null) : null;
        const live = pub?.status === "PUBLISHED" && rev !== null;
        const pendingChanges = live && rev.pageVersion !== page.version;
        if (page.kind === "FRAGMENT") {
          if (page.templateKey === BV_SITE_SEO_KEY) {
            const [draft, published] = await Promise.all([
              db.cmsPage.findUnique({ where: { id: page.id }, select: { content: true } }),
              live
                ? db.cmsPageRevision.findUnique({
                    where: { id: rev.id },
                    select: { content: true },
                  })
                : null,
            ]);
            const parsed = PublicSiteSeoSettingsSchema.safeParse(published?.content);
            liveSettings = parsed.success ? parsed.data : null;
            settings = {
              pageId: page.id,
              version: page.version,
              published: live,
              pendingChanges,
              draft:
                draft?.content && typeof draft.content === "object" && !Array.isArray(draft.content)
                  ? (draft.content as Record<string, unknown>)
                  : {},
            };
          }
          continue;
        }
        if (!page.path || part === "settings") continue;
        items.push({
          id: page.id,
          source: "cms",
          kind: kindOf(page.path, page),
          name: page.title,
          path: page.path,
          title: page.seoTitle,
          description: page.seoDescription,
          ogTitle: page.ogTitle,
          ogDescription: page.ogDescription,
          hasOgImage: page.ogImage !== null,
          canonicalPath: page.canonicalPath,
          noindex: page.noindex,
          live,
          pendingChanges,
          inSitemap:
            live &&
            rev.path !== null &&
            !rev.noindex &&
            seoIsSelfCanonical(rev.path, rev.canonicalPath),
        });
      }
    }

    if (!permissions.readPages) {
      // The published defaults are public (the site serves them); a product editor sees them in
      // the previews without reading the CMS drafts.
      const page = await db.cmsPage.findFirst({
        where: { siteId, locale, kind: "FRAGMENT", templateKey: BV_SITE_SEO_KEY },
        select: { id: true },
      });
      const pub = page
        ? await db.cmsPagePublication.findUnique({
            where: { pageId: page.id },
            select: { status: true, revisionId: true },
          })
        : null;
      if (pub?.status === "PUBLISHED") {
        const rev = await db.cmsPageRevision.findUnique({
          where: { id: pub.revisionId },
          select: { content: true },
        });
        const parsed = PublicSiteSeoSettingsSchema.safeParse(rev?.content);
        liveSettings = parsed.success ? parsed.data : null;
      }
    }

    if (permissions.readProducts && part === "all") {
      const listings = await db.productSiteListing.findMany({
        where: { siteId },
        select: {
          id: true,
          productId: true,
          visibility: true,
          version: true,
          // ML-8a (DP-214): texts and SEO texts of the default language; canonical, noindex and
          // OG image are language-neutral and stay on the listing.
          texts: { where: { locale }, select: LISTING_TEXT_SELECT },
          seoCanonicalPath: true,
          seoNoindex: true,
          seoOgImageId: true,
        },
        take: MAX_ITEMS,
      });
      const ids = listings.map((l) => l.productId);
      const [products, pubs] = ids.length
        ? await Promise.all([
            db.product.findMany({
              where: { id: { in: ids } },
              select: { id: true, slug: true, name: true, status: true },
            }),
            db.productPublication.findMany({
              where: { siteId, productId: { in: ids } },
              select: { productId: true, status: true, listingVersion: true, snapshot: true },
            }),
          ])
        : [[], []];
      for (const l of listings) {
        const p = products.find((x) => x.id === l.productId);
        if (!p || p.status === "ARCHIVED") continue;
        const pub = pubs.find((x) => x.productId === p.id) ?? null;
        const live = pub?.status === "PUBLISHED" && l.visibility === "VISIBLE";
        const published = pub ? readSnapshotAddress(pub.snapshot) : null;
        const path = `/products/${published?.slug ?? p.slug}`;
        const text = l.texts[0];
        items.push({
          id: p.id,
          source: "product",
          kind: "product",
          name: l.texts[0]?.title ?? p.name,
          path: `/products/${p.slug}`,
          title: text?.seoTitle ?? null,
          description: text?.seoDescription ?? null,
          ogTitle: text?.seoOgTitle ?? null,
          ogDescription: text?.seoOgDescription ?? null,
          hasOgImage: l.seoOgImageId !== null,
          canonicalPath: l.seoCanonicalPath,
          noindex: l.seoNoindex,
          live,
          pendingChanges: live && pub.listingVersion !== l.version,
          inSitemap:
            live &&
            !(published?.noindex ?? false) &&
            seoIsSelfCanonical(path, published?.canonicalPath ?? null),
        });
      }
    }

    return {
      site: { id: site.id, key: site.key, name: site.name },
      permissions,
      settings,
      liveSettings,
      items: items.slice(0, MAX_ITEMS),
    };
  }
}
