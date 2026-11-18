/**
 * DP-173 (ADR-022 D5): the company catalogue preview.
 *
 * Admin side: `link(ctx, siteId)` issues a short-lived signed link for the BV site's preview
 * routes. It needs `product_proposal:review` or (DP-204) `product:publish` on the site — the
 * company reviewer and the publisher who previews before publishing — and records an audit event
 * naming the permission used.
 *
 * Public side (the site's proxy key only, GET only): every request
 *   1. derives the site from the key (PublicSiteService), never from the path;
 *   2. verifies the link's signature, site and expiry;
 *   3. asks the database whether the issuing session is still live and its user still holds
 *      `product_proposal:review` or `product:publish` on the site (catalog_preview_session_allowed,
 *      DP-204);
 * and only then reads. A failed check answers 404 like an unknown link.
 *
 * What the preview shows: the products the site lists (any visibility, not archived), each with
 * its CURRENT data in the public shape (current texts, specifications, public images), the
 * research proposal kept apart, and the DP-002 held / withheld values as their own list. It never
 * writes, never shows documents, cross-references or lead forms, and never publishes. The
 * public live routes (public-catalog.service.ts) are untouched.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  ProposalReviewDataSchema,
  PUBLIC_IMAGE_VARIANTS,
  PublishedSnapshotSchema,
  SlugSchema,
  toPublicProduct,
  toPublicSummary,
  type CatalogPreviewHeldValue,
  type CatalogPreviewLinkResponse,
  type CatalogPreviewListResponse,
  type CatalogPreviewProductResponse,
  type ProposalStatus,
  type PublicCategory,
  type PublishedSnapshot,
} from "@dream/contracts";
import { LISTING_SEO_SELECT, listingSeo } from "./listing-seo.js";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService, type PublicSite } from "../iam/public-site.js";
import { StaffAccessService } from "../iam/staff/access.js";
import { MEDIA_STORAGE } from "../media/media.module.js";
import type { MediaStorage } from "../media/storage.js";
import { compareProductNames } from "./product-order.js";
import {
  issueCatalogPreviewToken,
  verifyCatalogPreviewToken,
  type PreviewClaims,
} from "./preview-token.js";
import { heldRawForDisplay } from "./preview-display.js";
import { uuidOr404, valueData } from "./specs.service.js";

const REVIEW = "product_proposal:review";
/** DP-204: a publisher may preview what it is about to publish (same link, same checks). */
const PUBLISH = "product:publish";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PreviewItem {
  productId: string;
  snapshot: PublishedSnapshot;
  updatedAt: Date;
  unpublished: boolean;
  proposal: {
    status: ProposalStatus;
    version: number;
    summary: string | null;
    description: string | null;
    reviewData: unknown;
  } | null;
}

@Injectable()
export class CatalogPreviewService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  // --- admin: issue a link -----------------------------------------------------------------------

  async link(ctx: RequestContext, rawSiteId: string): Promise<CatalogPreviewLinkResponse> {
    const a = await this.access.begin(ctx);
    const siteId = uuidOr404(rawSiteId);
    const target = { scope: "site", siteId } as const;
    // DP-204: either permission opens the preview; a reviewer keeps REVIEW in the audit record.
    const permission = a.allows(REVIEW, target) ? REVIEW : PUBLISH;
    await a.require(permission, target, { type: "catalog_preview", id: null });
    const site = a.sites.find((s) => s.id === siteId);
    if (!site || site.key !== "BV" || !a.sessionId) {
      throw new ApiError("CONFLICT_STATE", [{ path: "site", rule: "no_preview" }]);
    }
    const origin = [...this.config.allowedOrigins.WEB_BV][0];
    if (!origin) throw new ApiError("CONFLICT_STATE", [{ path: "site", rule: "no_public_origin" }]);
    const { token, expiresAt } = issueCatalogPreviewToken(
      this.config.secrets.hmacKey,
      { sessionId: a.sessionId, userId: a.userId, siteKey: site.key },
      this.clock.now(),
    );
    await a.audit(a.db({ siteIds: [siteId], includePlatform: false }), {
      action: "catalog.preview_link_issued",
      resourceType: "catalog_preview",
      resourceId: null,
      siteId,
      permission,
      metadata: { expiresAt: expiresAt.toISOString() },
    });
    return {
      url: `${origin}/preview/catalog/${token}/products`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // --- public: read through a valid link --------------------------------------------------------

  /** The site and the link's claims, or 404 (bad, expired or revoked link look the same). */
  private async open(
    ctx: RequestContext,
    token: string,
  ): Promise<{ site: PublicSite; claims: PreviewClaims }> {
    const site = await this.sites.begin(ctx);
    const claims = verifyCatalogPreviewToken(
      this.config.secrets.hmacKey,
      token,
      site.siteKey,
      this.clock.now(),
    );
    if (!claims) throw new ApiError("NOT_FOUND");
    if (!(await site.previewSessionAllowed(claims.sessionId, claims.userId))) {
      throw new ApiError("NOT_FOUND");
    }
    return { site, claims };
  }

  /** Every product the site lists (not archived), with its current data as a snapshot. */
  private static async items(site: PublicSite, slug?: string): Promise<PreviewItem[]> {
    const listings = await site.db.productSiteListing.findMany({
      where: {
        siteId: site.siteId,
        product: { status: { not: "ARCHIVED" }, ...(slug ? { slug } : {}) },
      },
      select: {
        id: true,
        productId: true,
        visibility: true,
        sortOrder: true,
        categoryId: true,
        texts: {
          where: { locale: "en" },
          select: { title: true, summary: true, description: true },
        },
        ...LISTING_SEO_SELECT,
      },
      take: 500,
    });
    if (listings.length === 0) return [];
    const productIds = listings.map((l) => l.productId);
    const [products, categories, values, images, publications, proposals] = await Promise.all([
      site.db.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          summary: true,
          description: true,
          updatedAt: true,
        },
      }),
      site.db.productCategory.findMany({
        where: { siteId: site.siteId },
        select: { id: true, slug: true, name: true },
      }),
      site.db.productSpecValue.findMany({
        where: { productId: { in: productIds } },
        include: { definition: { select: { key: true, name: true, sortOrder: true } } },
      }),
      site.db.productImage.findMany({
        where: { productId: { in: productIds }, isPublic: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, productId: true, altText: true, isCover: true, variants: true },
      }),
      site.db.productPublication.findMany({
        where: { siteId: site.siteId, productId: { in: productIds }, status: "PUBLISHED" },
        select: { productId: true },
      }),
      site.db.productContentProposal.findMany({
        where: { siteId: site.siteId, locale: "en", productId: { in: productIds } },
        select: {
          productId: true,
          status: true,
          version: true,
          proposedSummary: true,
          proposedDescription: true,
          reviewData: true,
        },
      }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const published = new Set(publications.map((p) => p.productId));
    const proposalByProduct = new Map(proposals.map((p) => [p.productId, p]));
    const out: PreviewItem[] = [];
    for (const l of listings) {
      const p = productById.get(l.productId);
      const cat = categoryById.get(l.categoryId);
      if (!p || !cat) continue;
      const text = l.texts[0] ?? null;
      const specs = values
        .filter((v) => v.productId === p.id)
        .sort(
          (x, y) =>
            x.definition.sortOrder - y.definition.sortOrder ||
            x.definition.name.localeCompare(y.definition.name) ||
            (x.basis === y.basis ? 0 : x.basis === "SPECIFICATION" ? -1 : 1),
        )
        .map((v) => ({
          key: v.definition.key,
          name: v.definition.name,
          basis: v.basis,
          value: valueData(v),
          unit: v.unit,
          testMethod: v.testMethod,
        }));
      const imgs = images
        .filter((i) => i.productId === p.id)
        .map((i) => {
          const display = (i.variants as { display?: { width?: number; height?: number } } | null)
            ?.display;
          return {
            id: i.id,
            altText: i.altText,
            isCover: i.isCover,
            width: display?.width ?? 0,
            height: display?.height ?? 0,
          };
        });
      const snapshot = PublishedSnapshotSchema.parse({
        schemaVersion: 1,
        slug: p.slug,
        code: p.code,
        name: text?.title ?? p.name,
        // CURRENT texts only; the research proposal is returned apart from them.
        summary: text?.summary ?? p.summary,
        description: text?.description ?? p.description,
        category: { slug: cat.slug, name: cat.name },
        sortOrder: l.sortOrder,
        specs,
        images: imgs,
        // DP-209: the CURRENT listing SEO, as the next publication would carry it.
        seo: {
          ...listingSeo(l),
          ogImageId: imgs.some((i) => i.id === l.seoOgImageId) ? l.seoOgImageId : null,
        },
      });
      const prop = proposalByProduct.get(p.id);
      out.push({
        productId: p.id,
        snapshot,
        updatedAt: p.updatedAt,
        unpublished: !(published.has(p.id) && l.visibility === "VISIBLE"),
        proposal: prop
          ? {
              status: prop.status,
              version: prop.version,
              summary: prop.proposedSummary,
              description: prop.proposedDescription,
              reviewData: prop.reviewData,
            }
          : null,
      });
    }
    out.sort(
      (x, y) =>
        x.snapshot.sortOrder - y.snapshot.sortOrder ||
        compareProductNames(x.snapshot.name, y.snapshot.name),
    );
    return out;
  }

  /** The category tree of the previewed products, counted like the live catalogue (DP-160). */
  private static async categories(
    site: PublicSite,
    items: PreviewItem[],
  ): Promise<PublicCategory[]> {
    const direct = new Map<string, number>();
    for (const i of items)
      direct.set(i.snapshot.category.slug, (direct.get(i.snapshot.category.slug) ?? 0) + 1);
    if (direct.size === 0) return [];
    const cats = await site.db.productCategory.findMany({
      where: { siteId: site.siteId },
      select: { id: true, parentId: true, slug: true, name: true, sortOrder: true },
    });
    const byId = new Map(cats.map((c) => [c.id, c]));
    const total = new Map<string, number>();
    for (const c of cats) {
      const n = direct.get(c.slug) ?? 0;
      if (n === 0) continue;
      for (
        let cur: typeof c | undefined = c, i = 0;
        cur && i < 10;
        cur = byId.get(cur.parentId ?? ""), i++
      ) {
        total.set(cur.id, (total.get(cur.id) ?? 0) + n);
      }
    }
    return cats
      .filter((c) => (total.get(c.id) ?? 0) > 0)
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        parentSlug: c.parentId ? (byId.get(c.parentId)?.slug ?? null) : null,
        sortOrder: c.sortOrder,
        count: total.get(c.id) as number,
      }))
      .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name, "en"));
  }

  async list(ctx: RequestContext, token: string): Promise<CatalogPreviewListResponse> {
    const { site, claims } = await this.open(ctx, token);
    const items = await CatalogPreviewService.items(site);
    return {
      items: items.map((i) => ({
        ...toPublicSummary(i.snapshot, i.updatedAt.toISOString(), { hasDocuments: false }),
        unpublished: i.unpublished,
        proposalStatus: i.proposal?.status ?? null,
        hasProposalText: !!(i.proposal && (i.proposal.summary || i.proposal.description)),
      })),
      categories: await CatalogPreviewService.categories(site, items),
      expiresAt: claims.expiresAt.toISOString(),
    };
  }

  async product(
    ctx: RequestContext,
    token: string,
    rawSlug: string,
  ): Promise<CatalogPreviewProductResponse> {
    const slug = SlugSchema.safeParse(rawSlug);
    if (!slug.success || slug.data !== rawSlug) throw new ApiError("NOT_FOUND");
    const { site, claims } = await this.open(ctx, token);
    const [item] = await CatalogPreviewService.items(site, slug.data);
    if (!item) throw new ApiError("NOT_FOUND");
    const held: CatalogPreviewHeldValue[] = [];
    const review = item.proposal
      ? ProposalReviewDataSchema.safeParse(item.proposal.reviewData)
      : null;
    if (review?.success) {
      for (const it of review.data.items) {
        if ((it.kind === "DP002_HELD" || it.kind === "SITE_VALUE_WITHHELD") && it.heldValue) {
          held.push({
            kind: it.kind,
            raw: heldRawForDisplay(it.heldValue.raw),
            conflict: it.heldValue.conflict,
            finding: it.heldValue.finding,
          });
        }
      }
    }
    return {
      product: toPublicProduct(item.snapshot, item.updatedAt.toISOString()),
      unpublished: item.unpublished,
      proposal: item.proposal
        ? {
            status: item.proposal.status,
            version: item.proposal.version,
            summary: item.proposal.summary,
            description: item.proposal.description,
          }
        : null,
      held,
      expiresAt: claims.expiresAt.toISOString(),
    };
  }

  /** A public image variant of a product this site lists (any visibility, not archived). */
  async image(
    ctx: RequestContext,
    token: string,
    rawImageId: string,
    variant: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    if (!UUID.test(rawImageId) || !(PUBLIC_IMAGE_VARIANTS as readonly string[]).includes(variant)) {
      throw new ApiError("NOT_FOUND");
    }
    const { site } = await this.open(ctx, token);
    const image = await site.db.productImage.findUnique({
      where: { id: rawImageId.toLowerCase() },
      select: { productId: true, isPublic: true, variants: true },
    });
    if (!image || !image.isPublic) throw new ApiError("NOT_FOUND");
    const listing = await site.db.productSiteListing.findFirst({
      where: {
        siteId: site.siteId,
        productId: image.productId,
        product: { status: { not: "ARCHIVED" } },
      },
      select: { id: true },
    });
    if (!listing) throw new ApiError("NOT_FOUND");
    const key = (image.variants as Record<string, { key?: string }> | null)?.[variant]?.key;
    if (!key) throw new ApiError("NOT_FOUND");
    let data: Buffer | null;
    try {
      data = await this.storage.get(key);
    } catch {
      throw new ApiError("STORAGE_UNAVAILABLE");
    }
    if (!data) throw new ApiError("NOT_FOUND");
    return { data, contentType: "image/webp" };
  }
}
