/**
 * ML-8a (ADR-028 D8, DP-239, DP-214): catalogue texts per language — see contracts
 * catalog-translations.ts for the endpoints and rules.
 *
 *  - Listing texts and SEO texts: `product:edit` of the site; listing version + 1.
 *  - Category name and description: `product:edit` of the category's site; category version + 1.
 *  - Specification name: `product_master:edit` (PLATFORM); definition version + 1.
 *  - Image alt text: `product_master:edit`; image version + 1 and, when the text changes, a
 *    master change (an approval is reset, exactly as for the English alt text).
 *
 * The language must be enabled on the site (platform-wide rows: on one of the sites); 409
 * `locale:not_enabled` otherwise. Nothing is published here: a public site sees a change only
 * with the next publication. Each change writes its audit event (field names, never values) in
 * the same transaction. "en" rows also update the English columns of before ML-8a (database
 * triggers), so the English name of a category or definition cannot be removed.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CategoryTranslationUpdateRequestSchema,
  ImageTranslationUpdateRequestSchema,
  ListingTranslationUpdateRequestSchema,
  LocaleTagSchema,
  localeEditProblem,
  SpecDefinitionTranslationUpdateRequestSchema,
  type CategoryTranslationResponse,
  type ImageTranslationResponse,
  type ListingTranslationResponse,
  type ProductTranslationsResponse,
  type SpecDefinitionTranslationResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { siteLocalesOf } from "../cms/site-locales.js";
import { mapDbError, staleVersion } from "./errors.js";
import { changeMaster } from "./master.js";
import { LISTING_TEXT_SELECT } from "./snapshot.js";
import { uuidOr404 } from "./specs.service.js";

const READ = "product:read";
const EDIT = "product:edit";
const MASTER = "product_master:edit";
const PLATFORM = { scope: "platform" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The language of the English columns of before ML-8a; its names cannot be removed. */
const LEGACY_LOCALE = "en";

const localeOr404 = (raw: unknown): string => {
  const r = LocaleTagSchema.safeParse(raw);
  if (!r.success) throw new ApiError("NOT_FOUND");
  return r.data;
};
const notEnabled = () => new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "not_enabled" }]);
const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.keys(after).filter((k) => (before[k] ?? null) !== after[k]);

@Injectable()
export class CatalogTranslationsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  private static siteId(raw: unknown): string {
    return typeof raw === "string" && UUID.test(raw)
      ? raw.toLowerCase()
      : "00000000-0000-0000-0000-000000000000";
  }

  /** Enabled on the site (site rows) — 409 otherwise. */
  private static async requireSiteLocale(a: StaffAccess, siteId: string, locale: string) {
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const list = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
    if (localeEditProblem(list, locale)) throw notEnabled();
    return list;
  }

  /** Enabled on one of the sites (platform-wide rows: definitions, images) — 409 otherwise. */
  private static async requireAnyLocale(a: StaffAccess, locale: string) {
    const ids = a.sites.map((s) => s.id);
    const db = a.db({ siteIds: ids, includePlatform: false });
    const all = await siteLocalesOf(db, ids);
    if (![...all.values()].some((list) => !localeEditProblem(list, locale))) throw notEnabled();
  }

  // --- reading ---------------------------------------------------------------------------------

  async product(
    ctx: RequestContext,
    rawProductId: string,
    query: Record<string, unknown>,
  ): Promise<ProductTranslationsResponse> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    const siteId = CatalogTranslationsService.siteId(query.siteId);
    await a.require(READ, { scope: "site", siteId }, { type: "product", id: productId });
    const locale = localeOr404(query.locale);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const locales = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
    const def = locales.find((l) => l.isDefault);
    if (!def) throw new ApiError("INTERNAL_ERROR");
    const pick = [...new Set([locale, def.locale])];
    const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new ApiError("NOT_FOUND");
    const [listing, values, images] = await Promise.all([
      db.productSiteListing.findUnique({
        where: { productId_siteId: { productId, siteId } },
        select: {
          id: true,
          version: true,
          categoryId: true,
          texts: { where: { locale: { in: pick } }, select: LISTING_TEXT_SELECT },
        },
      }),
      db.productSpecValue.findMany({
        where: { productId },
        select: { definition: { select: { id: true, key: true, version: true, sortOrder: true } } },
      }),
      db.productImage.findMany({
        where: { productId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, version: true, isPublic: true },
      }),
    ]);
    const category = listing
      ? await db.productCategory.findUnique({
          where: { id: listing.categoryId },
          select: { id: true, version: true },
        })
      : null;
    const defs = [...new Map(values.map((v) => [v.definition.id, v.definition])).values()].sort(
      (x, y) => x.sortOrder - y.sortOrder || x.key.localeCompare(y.key),
    );
    const [categoryTexts, specTexts, imageTexts] = await Promise.all([
      category
        ? db.productCategoryText.findMany({
            where: { categoryId: category.id, locale: { in: pick } },
            select: { locale: true, name: true, description: true },
          })
        : [],
      defs.length
        ? db.specDefinitionText.findMany({
            where: { definitionId: { in: defs.map((d) => d.id) }, locale: { in: pick } },
            select: { definitionId: true, locale: true, name: true },
          })
        : [],
      images.length
        ? db.productImageText.findMany({
            where: { imageId: { in: images.map((i) => i.id) }, locale: { in: pick } },
            select: { imageId: true, locale: true, altText: true },
          })
        : [],
    ]);
    const lt = (l: string) => listing?.texts.find((t) => t.locale === l);
    const ct = (l: string) => categoryTexts.find((t) => t.locale === l);
    const pair = <T>(get: (l: string) => T | null | undefined) => ({
      value: get(locale) ?? null,
      source: get(def.locale) ?? null,
    });
    return {
      productId,
      siteId,
      locale,
      defaultLocale: def.locale,
      enabled: localeEditProblem(locales, locale) === null,
      listing: listing
        ? {
            id: listing.id,
            version: listing.version,
            hasText: lt(locale) !== undefined,
            title: pair((l) => lt(l)?.title),
            summary: pair((l) => lt(l)?.summary),
            description: pair((l) => lt(l)?.description),
            seo: {
              title: pair((l) => lt(l)?.seoTitle),
              description: pair((l) => lt(l)?.seoDescription),
              ogTitle: pair((l) => lt(l)?.seoOgTitle),
              ogDescription: pair((l) => lt(l)?.seoOgDescription),
            },
          }
        : null,
      category: category
        ? {
            id: category.id,
            version: category.version,
            name: pair((l) => ct(l)?.name),
            description: pair((l) => ct(l)?.description),
          }
        : null,
      specs: defs.map((d) => ({
        definitionId: d.id,
        key: d.key,
        version: d.version,
        name: pair((l) => specTexts.find((t) => t.definitionId === d.id && t.locale === l)?.name),
      })),
      images: images.map((i) => ({
        id: i.id,
        version: i.version,
        isPublic: i.isPublic,
        altText: pair((l) => imageTexts.find((t) => t.imageId === i.id && t.locale === l)?.altText),
      })),
    };
  }

  // --- listing texts ---------------------------------------------------------------------------

  async saveListing(
    ctx: RequestContext,
    rawProductId: string,
    rawSiteId: string,
    rawLocale: string,
    body: unknown,
  ): Promise<ListingTranslationResponse> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    const siteId = CatalogTranslationsService.siteId(rawSiteId);
    await a.require(EDIT, { scope: "site", siteId }, { type: "product_listing", id: productId });
    const locale = localeOr404(rawLocale);
    const input = parseBody(ListingTranslationUpdateRequestSchema, body);
    await CatalogTranslationsService.requireSiteLocale(a, siteId, locale);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const text = {
      title: input.title,
      summary: input.summary,
      description: input.description,
      seoTitle: input.seo.title,
      seoDescription: input.seo.description,
      seoOgTitle: input.seo.ogTitle,
      seoOgDescription: input.seo.ogDescription,
    };
    try {
      return await db.$transaction(async (tx) => {
        const listing = await tx.productSiteListing.findUnique({
          where: { productId_siteId: { productId, siteId } },
          select: {
            id: true,
            version: true,
            texts: { where: { locale }, select: LISTING_TEXT_SELECT },
          },
        });
        if (!listing) throw new ApiError("NOT_FOUND", [{ path: "listing", rule: "missing" }]);
        if (listing.version !== input.version) throw staleVersion();
        const before = listing.texts[0];
        const res = await tx.productSiteListing.updateMany({
          where: { id: listing.id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        if (before) {
          await tx.productListingText.update({
            where: { listingId_locale: { listingId: listing.id, locale } },
            data: text,
          });
        } else if (Object.values(text).some((v) => v !== null)) {
          await tx.productListingText.create({
            data: { listingId: listing.id, siteId, locale, ...text },
          });
        }
        await a.audit(tx, {
          action: "catalog.listing_translation_updated",
          resourceType: "product_listing",
          resourceId: listing.id,
          siteId,
          permission: EDIT,
          metadata: {
            productId,
            locale,
            changed: changedKeys((before ?? {}) as Record<string, unknown>, text),
            version: listing.version + 1,
          },
        });
        return {
          listingId: listing.id,
          siteId,
          locale,
          version: listing.version + 1,
          title: text.title,
          summary: text.summary,
          description: text.description,
          seo: input.seo,
        };
      });
    } catch (e) {
      return mapDbError(e);
    }
  }

  // --- categories ------------------------------------------------------------------------------

  async saveCategory(
    ctx: RequestContext,
    rawId: string,
    rawLocale: string,
    body: unknown,
  ): Promise<CategoryTranslationResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const sites = a.sitesWith(EDIT);
    const scan = a.db({ siteIds: sites, includePlatform: false });
    const row = sites.length
      ? await scan.productCategory.findUnique({ where: { id }, select: { siteId: true } })
      : null;
    if (!row) {
      // Out of scope and unknown look the same (IDOR). The attempt is audited.
      await a.denied(EDIT, { type: "product_category", id }, "not_found_in_scope");
      throw new ApiError("NOT_FOUND");
    }
    const siteId = row.siteId;
    const locale = localeOr404(rawLocale);
    const input = parseBody(CategoryTranslationUpdateRequestSchema, body);
    if (input.name === null && input.description !== null) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "name", rule: "required" }]);
    }
    if (input.name === null && locale === LEGACY_LOCALE) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "name", rule: "required" }]);
    }
    await CatalogTranslationsService.requireSiteLocale(a, siteId, locale);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    try {
      return await db.$transaction(async (tx) => {
        const res = await tx.productCategory.updateMany({
          where: { id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        const before = await tx.productCategoryText.findUnique({
          where: { categoryId_locale: { categoryId: id, locale } },
          select: { name: true, description: true },
        });
        if (input.name === null) {
          if (before)
            await tx.productCategoryText.deleteMany({ where: { categoryId: id, locale } });
        } else {
          const data = { name: input.name, description: input.description };
          await tx.productCategoryText.upsert({
            where: { categoryId_locale: { categoryId: id, locale } },
            create: { categoryId: id, siteId, locale, ...data },
            update: data,
          });
        }
        await a.audit(tx, {
          action: "catalog.category_translation_updated",
          resourceType: "product_category",
          resourceId: id,
          siteId,
          permission: EDIT,
          metadata: {
            locale,
            changed: changedKeys(before ?? {}, {
              name: input.name,
              description: input.description,
            }),
            removed: input.name === null && before !== null,
            version: input.version + 1,
          },
        });
        return {
          categoryId: id,
          locale,
          version: input.version + 1,
          name: input.name,
          description: input.name === null ? null : input.description,
        };
      });
    } catch (e) {
      return mapDbError(e);
    }
  }

  // --- specification definitions ---------------------------------------------------------------

  async saveDefinition(
    ctx: RequestContext,
    rawId: string,
    rawLocale: string,
    body: unknown,
  ): Promise<SpecDefinitionTranslationResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "spec_definition", id });
    const locale = localeOr404(rawLocale);
    const input = parseBody(SpecDefinitionTranslationUpdateRequestSchema, body);
    if (input.name === null && locale === LEGACY_LOCALE) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "name", rule: "required" }]);
    }
    await CatalogTranslationsService.requireAnyLocale(a, locale);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      return await db.$transaction(async (tx) => {
        const def = await tx.specDefinition.findUnique({ where: { id }, select: { key: true } });
        if (!def) throw new ApiError("NOT_FOUND");
        const res = await tx.specDefinition.updateMany({
          where: { id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        const before = await tx.specDefinitionText.findUnique({
          where: { definitionId_locale: { definitionId: id, locale } },
          select: { name: true },
        });
        if (input.name === null) {
          if (before)
            await tx.specDefinitionText.deleteMany({ where: { definitionId: id, locale } });
        } else {
          await tx.specDefinitionText.upsert({
            where: { definitionId_locale: { definitionId: id, locale } },
            create: { definitionId: id, locale, name: input.name },
            update: { name: input.name },
          });
        }
        await a.audit(tx, {
          action: "catalog.spec_definition_translation_updated",
          resourceType: "spec_definition",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {
            key: def.key,
            locale,
            changed: changedKeys(before ?? {}, { name: input.name }),
            version: input.version + 1,
          },
        });
        return { definitionId: id, locale, version: input.version + 1, name: input.name };
      });
    } catch (e) {
      return mapDbError(e);
    }
  }

  // --- images ----------------------------------------------------------------------------------

  async saveImage(
    ctx: RequestContext,
    rawId: string,
    rawLocale: string,
    body: unknown,
  ): Promise<ImageTranslationResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product_image", id });
    const locale = localeOr404(rawLocale);
    const input = parseBody(ImageTranslationUpdateRequestSchema, body);
    await CatalogTranslationsService.requireAnyLocale(a, locale);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      return await db.$transaction(async (tx) => {
        const image = await tx.productImage.findUnique({
          where: { id },
          select: { productId: true, version: true },
        });
        if (!image) throw new ApiError("NOT_FOUND");
        if (image.version !== input.version) throw staleVersion();
        const before = await tx.productImageText.findUnique({
          where: { imageId_locale: { imageId: id, locale } },
          select: { altText: true },
        });
        const changed = (before?.altText ?? null) !== input.altText;
        // Like the English alt text (images.service.ts): a changed text is a master change.
        if (changed) await changeMaster(tx, a, image.productId, { cause: "image_updated" });
        const res = await tx.productImage.updateMany({
          where: { id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        if (input.altText === null && locale !== LEGACY_LOCALE) {
          if (before) await tx.productImageText.deleteMany({ where: { imageId: id, locale } });
        } else if (before || input.altText !== null) {
          await tx.productImageText.upsert({
            where: { imageId_locale: { imageId: id, locale } },
            create: { imageId: id, locale, altText: input.altText },
            update: { altText: input.altText },
          });
        }
        await a.audit(tx, {
          action: "catalog.image_translation_updated",
          resourceType: "product_image",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId: image.productId,
            locale,
            changed: changed ? ["altText"] : [],
            version: input.version + 1,
          },
        });
        return { imageId: id, locale, version: input.version + 1, altText: input.altText };
      });
    } catch (e) {
      return mapDbError(e);
    }
  }
}
