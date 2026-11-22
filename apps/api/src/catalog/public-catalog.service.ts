/**
 * Public product content of one site (PM-3). Serves the live sites' servers (web-bv,
 * web-corporate) through their proxy keys; the site comes from the key (PublicSiteService), never
 * from the request.
 *
 * A product is public on a site only while all of these hold:
 *  - its publication on that site is PUBLISHED (a publisher approved it there);
 *  - its listing on that site is VISIBLE (hiding a listing takes it off the site at once);
 *  - the master is not ARCHIVED (archiving is refused while published; checked again here).
 * The content is the publication's snapshot: the approved version, never the current draft.
 * Images are served only when a live publication of this site shows them, and only as the
 * derived WebP variants (no original, no metadata, no file name).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DOCUMENT_ACCESS_POLICIES,
  LocaleTagSchema,
  PUBLIC_IMAGE_VARIANTS,
  parseStoredSnapshot,
  readSnapshot,
  SlugSchema,
  toPublicProduct,
  toPublicSummary,
  type PublicProduct,
  type PublicCategory,
  type PublicCategoryListResponse,
  type PublicProductListResponse,
  type PublicProductSummary,
  type PublishedSnapshot,
  type PublicCrossReference,
  type PublicCrossReferenceListResponse,
  type PublicDocument,
  type PublicDocumentListResponse,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService, type PublicSite } from "../iam/public-site.js";
import {
  decideDocumentAccess,
  offeredToVisitors,
  DocumentStampers,
  StamperMissing,
  type DeliveryContext,
} from "./document-delivery.js";
import { GLOBAL_PRODUCT_INCLUDE } from "./global-catalog.service.js";
import { liveRows, pageDocumentLanguages, publicDocumentLanguages, type LiveRow } from "./live.js";
import { compareProductNames } from "./product-order.js";
import { currentSpecHash, factsOf } from "./xrefs.service.js";
import { publicRelation } from "./xref-rules.js";
import { MEDIA_STORAGE } from "../media/media.module.js";
import { ImageGateBusy, ImageProcessingGate } from "../media/image-gate.js";
import { PUBLIC_RATE_LIMITS, PublicRateLimitService, ipSubject } from "../iam/public-rate-limit.js";
import { DocumentGrantsService, type GrantForDownload } from "../leads/document-grants.service.js";
import type { MediaStorage } from "../media/storage.js";
import { siteLocalesOf } from "../cms/site-locales.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PublicCatalogService {
  private readonly log = new Logger("PublicCatalog");

  constructor(
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(DocumentStampers) private readonly stampers: DocumentStampers,
    @Inject(PublicRateLimitService) private readonly limits: PublicRateLimitService,
    @Inject(DocumentGrantsService) private readonly grants: DocumentGrantsService,
    @Inject(ImageProcessingGate) private readonly gate: ImageProcessingGate,
  ) {}

  /** Publications of the site that are live (published, listing visible, master not archived). */
  private static live(site: PublicSite, where: Record<string, unknown> = {}): Promise<LiveRow[]> {
    return liveRows(site, where);
  }

  /**
   * ML-8a / ML-8c (ADR-028 D8): the language of a public catalogue request. Without `locale` the
   * site's default language (as before ML-8a). A given language must be enabled AND public on the
   * site (`SiteLocale.public`); anything else is a 404 that reveals nothing, so the Dutch catalogue
   * stays closed while `nl` is not public, whatever was published in Dutch.
   */
  static async locale(site: PublicSite, raw: unknown): Promise<string> {
    const all = (await siteLocalesOf(site.db, [site.siteId])).get(site.siteId) ?? [];
    const def = all.find((l) => l.isDefault);
    if (!def) throw new ApiError("INTERNAL_ERROR");
    if (raw === undefined) return def.locale;
    const tag = LocaleTagSchema.safeParse(raw);
    if (!tag.success) throw new ApiError("NOT_FOUND");
    if (tag.data === def.locale) return def.locale;
    const row = all.find((l) => l.locale === tag.data);
    if (!row?.enabled || !row.public) throw new ApiError("NOT_FOUND");
    return row.locale;
  }

  /**
   * ML-8c: the live publication of a product in `locale`: its snapshot must have a complete text
   * in that language (nothing falls back to another language). null: not in this language.
   */
  private liveIn(row: LiveRow | undefined, locale: string): PublishedSnapshot | null {
    return row ? this.parse(row, locale) : null;
  }

  /** The view of `locale`; null (not served) when the snapshot has no complete text in it. */
  private parse(row: LiveRow, locale: string): PublishedSnapshot | null {
    if (!parseStoredSnapshot(row.snapshot)) {
      this.log.error("a published snapshot does not match the contract; it is not served");
      return null;
    }
    return readSnapshot(row.snapshot, locale);
  }

  async list(ctx: RequestContext, rawLocale?: unknown): Promise<PublicProductListResponse> {
    const site = await this.sites.begin(ctx);
    const locale = await PublicCatalogService.locale(site, rawLocale);
    const rows = await PublicCatalogService.live(site);
    const withDocuments = await PublicCatalogService.productsWithOfferedDocuments(
      site,
      rows.map((r) => r.productId),
      locale,
    );
    const items: (PublicProductSummary & { sortOrder: number })[] = [];
    for (const row of rows) {
      const s = this.parse(row, locale);
      if (s)
        items.push({
          ...toPublicSummary(s, row.publishedAt.toISOString(), {
            hasDocuments: withDocuments.has(row.productId),
          }),
          sortOrder: s.sortOrder,
        });
    }
    // DP-160: names compare naturally ("White Oil 15#" before "White Oil 100#", "50 g" before "25 kg");
    // ML-8c: in the collation of the request's language
    items.sort((x, y) => x.sortOrder - y.sortOrder || compareProductNames(x.name, y.name, locale));
    return { items: items.map(({ sortOrder: _s, ...rest }) => (void _s, rest)) };
  }

  /**
   * DP-163: the live products that have at least one document a visitor can obtain on this site:
   * shown here with a pinned revision, ACTIVE, and of a policy that is open (PUBLIC, or
   * LEAD_REQUIRED through the request form) and, ML-9, in a language the page of `locale` lists.
   * A few queries for the whole list, no per-product calls.
   */
  private static async productsWithOfferedDocuments(
    site: PublicSite,
    productIds: string[],
    locale: string,
  ): Promise<Set<string>> {
    const policies = DOCUMENT_ACCESS_POLICIES.filter((p) => offeredToVisitors(p));
    if (productIds.length === 0 || policies.length === 0) return new Set();
    const languages = pageDocumentLanguages(await publicDocumentLanguages(site), locale);
    if (languages.length === 0) return new Set();
    const docs = await site.db.productDocument.findMany({
      where: {
        productId: { in: productIds },
        status: "ACTIVE",
        accessPolicy: { in: policies },
        language: { in: languages },
      },
      select: { id: true, productId: true },
    });
    if (docs.length === 0) return new Set();
    const shown = await site.db.productDocumentSite.findMany({
      where: { siteId: site.siteId, documentId: { in: docs.map((d) => d.id) } },
      select: { documentId: true },
    });
    const shownIds = new Set(shown.map((s) => s.documentId));
    return new Set(docs.filter((d) => shownIds.has(d.id)).map((d) => d.productId));
  }

  /**
   * DP-160: the category tree of the live products. A category is listed when a live product's
   * snapshot names it or one of its descendants; ancestors come from the site's current tree.
   * Nothing about drafts, hidden listings or empty categories is revealed.
   */
  async categories(ctx: RequestContext, rawLocale?: unknown): Promise<PublicCategoryListResponse> {
    const site = await this.sites.begin(ctx);
    const locale = await PublicCatalogService.locale(site, rawLocale);
    const rows = await PublicCatalogService.live(site);
    const direct = new Map<string, number>();
    const def = await PublicCatalogService.locale(site, undefined);
    const snapshotNames = new Map<string, string>();
    for (const row of rows) {
      const s = this.parse(row, locale);
      if (!s) continue;
      direct.set(s.category.slug, (direct.get(s.category.slug) ?? 0) + 1);
      // one approved name per category (publications of one category carry the same table text
      // unless one was published before a later edit; the first one read is kept)
      if (locale !== def && !snapshotNames.has(s.category.slug)) {
        snapshotNames.set(s.category.slug, s.category.name);
      }
    }
    if (direct.size === 0) return { items: [] };
    // ML-8a: names in the request's language; a category without one is left out.
    const [tree, texts] = await Promise.all([
      site.db.productCategory.findMany({
        where: { siteId: site.siteId },
        select: { id: true, parentId: true, slug: true, sortOrder: true },
      }),
      site.db.productCategoryText.findMany({
        where: { siteId: site.siteId, locale },
        select: { categoryId: true, name: true },
      }),
    ]);
    const nameOf = new Map(texts.map((t) => [t.categoryId, t.name]));
    // ML-8c: in a language other than the default one, a category that live products name takes
    // the name those publications carry (the approved text), never a later draft of the table;
    // its ancestors (named by no snapshot) keep their saved name in that language.
    if (snapshotNames.size) {
      for (const c of tree) {
        const published = snapshotNames.get(c.slug);
        if (published !== undefined) nameOf.set(c.id, published);
      }
    }
    const cats = tree.flatMap((c) => {
      const name = nameOf.get(c.id);
      return name === undefined ? [] : [{ ...c, name }];
    });
    const byId = new Map(tree.map((c) => [c.id, c]));
    const total = new Map<string, number>();
    for (const c of tree) {
      const n = direct.get(c.slug) ?? 0;
      if (n === 0) continue;
      // add this category's products to it and every ancestor (the tree has at most 3 levels)
      for (
        let cur: typeof c | undefined = c, i = 0;
        cur && i < 10;
        cur = byId.get(cur.parentId ?? ""), i++
      ) {
        total.set(cur.id, (total.get(cur.id) ?? 0) + n);
      }
    }
    const items: PublicCategory[] = cats
      .filter((c) => (total.get(c.id) ?? 0) > 0)
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        parentSlug: c.parentId ? (byId.get(c.parentId)?.slug ?? null) : null,
        sortOrder: c.sortOrder,
        count: total.get(c.id) as number,
      }))
      .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name, locale));
    return { items };
  }

  async product(
    ctx: RequestContext,
    rawSlug: string,
    rawLocale?: unknown,
  ): Promise<{ product: PublicProduct }> {
    const slug = SlugSchema.safeParse(rawSlug);
    if (!slug.success || slug.data !== rawSlug) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    const locale = await PublicCatalogService.locale(site, rawLocale);
    const [row] = await PublicCatalogService.live(site, {
      snapshot: { path: ["slug"], equals: slug.data },
    });
    const s = row ? this.parse(row, locale) : null;
    if (!row || !s) throw new ApiError("NOT_FOUND");
    return { product: toPublicProduct(s, row.publishedAt.toISOString()) };
  }

  /** A public image variant: only when a live publication of this site shows the image. */
  async image(
    ctx: RequestContext,
    rawImageId: string,
    variant: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    if (!UUID.test(rawImageId) || !(PUBLIC_IMAGE_VARIANTS as readonly string[]).includes(variant)) {
      throw new ApiError("NOT_FOUND");
    }
    const imageId = rawImageId.toLowerCase();
    const site = await this.sites.begin(ctx);
    const live = await PublicCatalogService.live(site, { imageIds: { has: imageId } });
    if (live.length === 0) throw new ApiError("NOT_FOUND");
    const image = await site.db.productImage.findUnique({
      where: { id: imageId },
      select: { variants: true },
    });
    const key = (image?.variants as Record<string, { key?: string }> | null)?.[variant]?.key;
    if (!key) throw new ApiError("NOT_FOUND");
    let data: Buffer | null;
    try {
      data = await this.storage.get(key);
    } catch {
      throw new ApiError("STORAGE_UNAVAILABLE");
    }
    if (!data) {
      this.log.warn("public image variant missing in the media storage");
      throw new ApiError("NOT_FOUND");
    }
    return { data, contentType: "image/webp" };
  }

  // --- cross-references (PM-6, ADR-015) ------------------------------------------------------

  /**
   * Cross-references of a live product on this site: shown on the site by its publisher, not
   * removed, global product and brand active. VERIFIED only while its verification holds (source
   * revision, specification fingerprint, global product version unchanged); a stale verification
   * is not shown at all. Only names and the relation level leave the platform: the staff texts
   * (description, comparison) and the evidence stay internal, and no claim text is generated.
   */
  async crossReferences(
    ctx: RequestContext,
    rawSlug: string,
    rawLocale?: unknown,
  ): Promise<PublicCrossReferenceListResponse> {
    const slug = SlugSchema.safeParse(rawSlug);
    if (!slug.success || slug.data !== rawSlug) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    const locale = await PublicCatalogService.locale(site, rawLocale);
    const [row] = await PublicCatalogService.live(site, {
      snapshot: { path: ["slug"], equals: slug.data },
    });
    // ML-8c: only for a product published in the request's language.
    if (!row || !this.liveIn(row, locale)) throw new ApiError("NOT_FOUND");
    const shown = await site.db.productCrossReferenceSite.findMany({
      where: { siteId: site.siteId, crossReference: { productId: row.productId } },
      select: { crossReferenceId: true },
    });
    if (shown.length === 0) return { items: [] };
    const rows = await site.db.productCrossReference.findMany({
      where: {
        id: { in: shown.map((s) => s.crossReferenceId) },
        productId: row.productId,
        status: { in: ["SIMILAR", "PENDING_VERIFICATION", "VERIFIED"] },
      },
      include: {
        globalProduct: { include: GLOBAL_PRODUCT_INCLUDE },
        sourceRevision: {
          select: { isActive: true, document: { select: { status: true } } },
        },
      },
      take: 100,
    });
    const specHash = await currentSpecHash(site.db, row.productId);
    const items: PublicCrossReference[] = [];
    for (const x of rows) {
      const relation = publicRelation(
        factsOf(
          {
            status: x.status,
            verifiedSpecHash: x.verifiedSpecHash,
            verifiedGlobalVersion: x.verifiedGlobalVersion,
            globalProduct: x.globalProduct,
            sourceRevision: x.sourceRevision
              ? {
                  id: "",
                  revisionNumber: 0,
                  isActive: x.sourceRevision.isActive,
                  document: {
                    id: "",
                    title: "",
                    type: "OTHER",
                    status: x.sourceRevision.document.status,
                  },
                }
              : null,
          },
          specHash,
        ),
      );
      if (!relation) continue;
      items.push({
        id: x.id,
        brand: x.globalProduct.brand.name,
        manufacturer: x.globalProduct.brand.manufacturer,
        product: x.globalProduct.name,
        grade: x.globalProduct.grade,
        relation,
        verifiedAt: relation === "VERIFIED" ? (x.verifiedAt?.toISOString() ?? null) : null,
      });
    }
    // Verified first, then by brand and product name: a stable, neutral order.
    items.sort(
      (a, b) =>
        (a.relation === b.relation ? 0 : a.relation === "VERIFIED" ? -1 : 1) ||
        a.brand.localeCompare(b.brand, "en") ||
        a.product.localeCompare(b.product, "en"),
    );
    return { items };
  }

  // --- technical documents (PM-5, ADR-014) ----------------------------------------------------

  /**
   * Documents of a live product on this site: shown on the site by its publisher, active, not
   * INTERNAL. Each lists the revision this site pinned (DP-086), not simply the active one.
   * ML-9 (ADR-028 D10): documents in the page's language and, as the fallback, in the site's
   * default language (both public), each with its language; per type the page's language first.
   * LEAD_REQUIRED is `requestable` (short form, then a grant; ADR-016); MEMBERS_ONLY is listed
   * but closed until DP-039.
   */
  async documents(
    ctx: RequestContext,
    rawSlug: string,
    rawLocale?: unknown,
  ): Promise<PublicDocumentListResponse> {
    const slug = SlugSchema.safeParse(rawSlug);
    if (!slug.success || slug.data !== rawSlug) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    const locale = await PublicCatalogService.locale(site, rawLocale);
    const [row] = await PublicCatalogService.live(site, {
      snapshot: { path: ["slug"], equals: slug.data },
    });
    // ML-8c: only for a product published in the request's language. ML-9: the files are not
    // translated; each document has its own language, which the site names.
    if (!row || !this.liveIn(row, locale)) throw new ApiError("NOT_FOUND");
    const languages = pageDocumentLanguages(await publicDocumentLanguages(site), locale);
    if (languages.length === 0) return { items: [] };
    const found = await site.db.productDocument.findMany({
      where: {
        productId: row.productId,
        status: "ACTIVE",
        accessPolicy: { not: "INTERNAL" },
        language: { in: languages },
      },
      orderBy: [{ type: "asc" }, { title: "asc" }],
      take: 50,
    });
    // Stable: per type, the page's language before the fallback (the order of `languages`).
    const rank = (l: string) => languages.indexOf(l);
    const candidates = found
      .map((d, i) => ({ d, i }))
      .sort((x, y) =>
        x.d.type === y.d.type ? rank(x.d.language) - rank(y.d.language) || x.i - y.i : x.i - y.i,
      )
      .map(({ d }) => d);
    if (candidates.length === 0) return { items: [] };
    const shown = await site.db.productDocumentSite.findMany({
      where: { siteId: site.siteId, documentId: { in: candidates.map((d) => d.id) } },
      select: { documentId: true, revision: true },
    });
    const pinned = new Map(shown.map((s) => [s.documentId, s.revision]));
    const docs = candidates.filter((d) => pinned.has(d.id));
    const items: PublicDocument[] = [];
    for (const d of docs) {
      const rev = pinned.get(d.id);
      if (!rev || d.accessPolicy === "INTERNAL") continue;
      const access = decideDocumentAccess(d.accessPolicy);
      items.push({
        id: d.id,
        type: d.type,
        title: d.title,
        description: d.description,
        language: d.language,
        access: d.accessPolicy,
        downloadable: access.downloadable && access.requires === "nothing",
        // DP-042: a lead-gated document is requested with the short form first (ADR-016).
        requestable: access.downloadable && access.requires === "lead_grant",
        revisionNumber: rev.revisionNumber,
        byteSize: rev.byteSize,
        pageCount: rev.pageCount,
        updatedAt: rev.createdAt.toISOString(),
      });
    }
    return { items };
  }

  /**
   * The file of a downloadable document on this site. Everything else answers 404, so a gated or
   * internal document is indistinguishable from an unknown id.
   *
   *  - PUBLIC: the revision this site pinned (DP-086), unchanged (identity stamper).
   *  - LEAD_REQUIRED (DP-043, ADR-016 D5): only with a valid download grant of a lead request on
   *    this site; the revision recorded in the request, stamped for its recipient. The grant is
   *    counted and the download recorded (one transaction) before the bytes leave.
   *  - MEMBERS_ONLY / INTERNAL: never (DP-039 / ADR-014).
   *
   * In every case the document must be shown on this site, ACTIVE, in a language public here
   * (ML-9) and its product live here at download time. Downloads are rate limited per client IP prefix (ADR-016 D7, R-18).
   */
  async documentFile(
    ctx: RequestContext,
    rawId: string,
    grantToken?: string,
  ): Promise<{ data: Buffer; filename: string; sha256: string | null }> {
    if (!UUID.test(rawId)) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const site = await this.sites.begin(ctx);
    await this.limits.consume([
      {
        name: "document_download_ip",
        subject: ipSubject(ctx),
        ...PUBLIC_RATE_LIMITS.documentDownloadPerIp,
      },
    ]);
    const shown = await site.db.productDocumentSite.findFirst({
      where: { siteId: site.siteId, documentId: id },
      select: { revision: true },
    });
    if (!shown) throw new ApiError("NOT_FOUND");
    const doc = await site.db.productDocument.findUnique({ where: { id } });
    if (!doc || !shown.revision || doc.status !== "ACTIVE") throw new ApiError("NOT_FOUND");
    // ML-9: a document in a language that is not public here does not exist for visitors.
    if (!(await publicDocumentLanguages(site)).languages.has(doc.language)) {
      throw new ApiError("NOT_FOUND");
    }
    const access = decideDocumentAccess(doc.accessPolicy);
    if (!access.downloadable) throw new ApiError("NOT_FOUND");

    let revision: { id: string; revisionNumber: number; storageKey: string; sha256: string | null };
    let grant: GrantForDownload | null = null;
    if (access.requires === "nothing") {
      revision = shown.revision;
    } else if (access.requires === "lead_grant") {
      grant = await this.grants.find(site, grantToken, doc.id);
      if (!grant) throw new ApiError("NOT_FOUND");
      revision = { ...grant.revision, sha256: null };
    } else {
      throw new ApiError("NOT_FOUND");
    }
    const [live] = await PublicCatalogService.live(site, { productId: doc.productId });
    const snapshot = live ? parseStoredSnapshot(live.snapshot) : null;
    if (!live || !snapshot) throw new ApiError("NOT_FOUND");
    let data: Buffer | null;
    try {
      data = await this.storage.get(revision.storageKey);
    } catch {
      throw new ApiError("STORAGE_UNAVAILABLE");
    }
    if (!data) {
      this.log.warn("public document revision missing in the media storage");
      throw new ApiError("NOT_FOUND");
    }
    const delivery: DeliveryContext = {
      documentId: doc.id,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      siteId: site.siteId,
      policy: doc.accessPolicy,
      ...(grant
        ? {
            grant: {
              id: grant.grantId,
              reference: grant.reference,
              recipientLabel: grant.recipientLabel,
              issuedAt: grant.issuedAt,
            },
          }
        : {}),
      requestId: ctx.requestId,
      deliveredAt: new Date(),
    };
    let out: Buffer;
    try {
      const stamper = this.stampers.for(doc.accessPolicy);
      const bytes = data;
      // A watermark re-serialises the PDF: one heavy job at a time (shared processing gate).
      out = grant
        ? await this.gate.run(() => stamper.stamp(bytes, delivery))
        : await stamper.stamp(bytes, delivery);
    } catch (e) {
      if (e instanceof StamperMissing) throw new ApiError("NOT_FOUND");
      if (e instanceof ImageGateBusy) {
        throw new ApiError("RATE_LIMITED", [], { "Retry-After": "5" });
      }
      this.log.error(`document stamping failed (${e instanceof Error ? e.name : "unknown"})`);
      throw new ApiError("INTERNAL_ERROR");
    }
    if (grant && !(await this.grants.consume(site, grant, out, ctx))) {
      throw new ApiError("NOT_FOUND");
    }
    const type = doc.type.toLowerCase();
    return {
      data: out,
      filename: `${snapshot.slug}-${type}-rev${revision.revisionNumber}.pdf`,
      sha256: grant ? null : revision.sha256,
    };
  }
}
