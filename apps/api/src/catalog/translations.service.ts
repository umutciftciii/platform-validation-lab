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
 *
 * ML-8b: every save in a language other than the source records the source revision it was
 * written against (translation-state.ts; migration 40), which drives the OUTDATED state; the
 * reading endpoints return the translation state of every unit, what is missing and what blocks
 * the language in a publication; `publicationPreview` shows one language of the next publication
 * next to the live one (nothing written). The site scope and the permissions are the ones above.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CategoryTranslationUpdateRequestSchema,
  claimScanOf,
  findSensitiveClaims,
  ImageTranslationUpdateRequestSchema,
  ListingTranslationUpdateRequestSchema,
  localizeSnapshot,
  LocaleTagSchema,
  localeEditProblem,
  parseStoredSnapshot,
  snapshotLocaleTexts,
  sortSiteLocales,
  SpecDefinitionTranslationUpdateRequestSchema,
  translationState,
  type CategoryTranslationListResponse,
  type CategoryTranslationResponse,
  type ImageTranslationResponse,
  type ListingTranslationResponse,
  type ProductTranslationsResponse,
  type PublicationPreviewResponse,
  type SpecDefinitionTranslationListResponse,
  type SpecDefinitionTranslationResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { siteLocalesOf } from "../cms/site-locales.js";
import { mapDbError, staleVersion } from "./errors.js";
import { changeMaster } from "./master.js";
import {
  buildSnapshotV2,
  catalogLocales,
  displaySize,
  LISTING_TEXT_SELECT,
  loadTextRows,
} from "./snapshot.js";
import { requireMasterRead, uuidOr404, valueData } from "./specs.service.js";
import {
  categoryHash,
  listingSeoHash,
  listingSource,
  listingTextsHash,
  loadProductTextRows,
  localeView,
  nameHash,
  PLATFORM_SOURCE_LOCALE,
} from "./translation-state.js";

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
    const locales = sortSiteLocales((await siteLocalesOf(db, [siteId])).get(siteId) ?? []);
    const def = locales.find((l) => l.isDefault);
    if (!def) throw new ApiError("INTERNAL_ERROR");
    const rows = await loadProductTextRows(db, productId, siteId, locales);
    if (!rows) throw new ApiError("NOT_FOUND");
    const view = localeView(rows, locale);
    const lt = (l: string) => rows.listing?.texts.find((t) => t.locale === l);
    const ct = (l: string) => rows.categoryTexts.find((t) => t.locale === l);
    const pair = <T>(get: (l: string) => T | null | undefined, source?: T | null) => ({
      value: get(locale) ?? null,
      source: source === undefined ? (get(def.locale) ?? null) : source,
    });
    const src = view.listing?.source;
    const row = locales.find((l) => l.locale === locale);
    return {
      productId,
      siteId,
      locale,
      defaultLocale: def.locale,
      enabled: localeEditProblem(locales, locale) === null,
      public: Boolean(row?.enabled && row.public),
      locales,
      live: { published: rows.live !== null, hasLocale: view.live },
      requiredMissing: view.requiredMissing,
      missing: view.missing,
      listing:
        rows.listing && view.listing && src
          ? {
              id: rows.listing.id,
              version: rows.listing.version,
              hasText: lt(locale) !== undefined,
              state: view.listing.state,
              seoState: view.listing.seoState,
              sharedSource: src.shared,
              // ML-8b: the source is what the default-language page shows (own text, else the
              // shared product text it falls back to).
              title: pair((l) => lt(l)?.title, src.title),
              summary: pair((l) => lt(l)?.summary, src.summary),
              description: pair((l) => lt(l)?.description, src.description),
              seo: {
                title: pair((l) => lt(l)?.seoTitle),
                description: pair((l) => lt(l)?.seoDescription),
                ogTitle: pair((l) => lt(l)?.seoOgTitle),
                ogDescription: pair((l) => lt(l)?.seoOgDescription),
              },
            }
          : null,
      category:
        rows.category && view.category
          ? {
              id: rows.category.id,
              version: rows.category.version,
              state: view.category.state,
              name: pair((l) => ct(l)?.name),
              description: pair((l) => ct(l)?.description),
            }
          : null,
      specs: view.specs.map((d) => ({
        definitionId: d.definitionId,
        key: d.key,
        version: d.version,
        state: d.state,
        name: pair(
          (l) =>
            rows.specTexts.find((t) => t.definitionId === d.definitionId && t.locale === l)?.name,
          rows.specTexts.find(
            (t) => t.definitionId === d.definitionId && t.locale === PLATFORM_SOURCE_LOCALE,
          )?.name ?? null,
        ),
      })),
      images: view.images.map((i) => ({
        id: i.id,
        version: i.version,
        isPublic: i.isPublic,
        originalFilename: i.originalFilename,
        state: i.state,
        altText: pair(
          (l) => rows.imageTexts.find((t) => t.imageId === i.id && t.locale === l)?.altText,
          rows.imageTexts.find((t) => t.imageId === i.id && t.locale === PLATFORM_SOURCE_LOCALE)
            ?.altText ?? null,
        ),
      })),
    };
  }

  // --- ML-8b: language lists of categories and specification names ------------------------------

  async categoryList(
    ctx: RequestContext,
    rawSiteId: string,
    query: Record<string, unknown>,
  ): Promise<CategoryTranslationListResponse> {
    const a = await this.access.begin(ctx);
    const siteId = CatalogTranslationsService.siteId(rawSiteId);
    await a.require(READ, { scope: "site", siteId }, { type: "product_category", id: null });
    const locale = localeOr404(query.locale);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const locales = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
    const def = locales.find((l) => l.isDefault);
    if (!def) throw new ApiError("INTERNAL_ERROR");
    const [cats, texts, pubs] = await Promise.all([
      db.productCategory.findMany({
        where: { siteId },
        orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
        select: { id: true, slug: true, parentId: true, version: true },
      }),
      db.productCategoryText.findMany({
        where: { siteId, locale: { in: [...new Set([locale, def.locale])] } },
        select: { categoryId: true, locale: true, name: true, description: true, sourceHash: true },
      }),
      db.productPublication.findMany({
        where: { siteId, status: "PUBLISHED" },
        select: { snapshot: true },
      }),
    ]);
    // The live products of each category (by slug: a snapshot names its category by slug).
    const live = pubs.map((p) => parseStoredSnapshot(p.snapshot)).filter((x) => x !== null);
    const isDefault = locale === def.locale;
    return {
      siteId,
      locale,
      defaultLocale: def.locale,
      locales: sortSiteLocales(locales),
      enabled: localeEditProblem(locales, locale) === null,
      canEdit: a.allows(EDIT, { scope: "site", siteId }),
      items: cats.map((c) => {
        const own = texts.find((t) => t.categoryId === c.id && t.locale === locale);
        const src = texts.find((t) => t.categoryId === c.id && t.locale === def.locale);
        const shown = live.filter((s) => s.category.slug === c.slug);
        // Published: every live snapshot that carries this language shows exactly this name.
        const names = shown
          .map((s) => snapshotLocaleTexts(s, locale))
          .filter((t) => t !== null)
          .map((t) => t.categoryName);
        return {
          id: c.id,
          slug: c.slug,
          parentId: c.parentId,
          version: c.version,
          liveProducts: shown.length,
          state: translationState({
            hasValue: !!own,
            hasSource: !!src,
            isDefault,
            sourceChanged: !!own && !isDefault && own.sourceHash !== categoryHash(src),
            live: !!own && names.length > 0 && names.every((n) => n === own.name),
          }),
          name: { value: own?.name ?? null, source: src?.name ?? null },
          description: { value: own?.description ?? null, source: src?.description ?? null },
        };
      }),
    };
  }

  async definitionList(
    ctx: RequestContext,
    query: Record<string, unknown>,
  ): Promise<SpecDefinitionTranslationListResponse> {
    const a = await this.access.begin(ctx);
    await requireMasterRead(a, { type: "spec_definition", id: null });
    const locale = localeOr404(query.locale);
    const readable = a.sitesWith(READ);
    const sites = a.db({ siteIds: readable, includePlatform: false });
    const all = await siteLocalesOf(sites, readable);
    const enabled = [...all.values()].some((list) => localeEditProblem(list, locale) === null);
    const db = a.db({ siteIds: readable, includePlatform: true });
    const [defs, texts, pubs] = await Promise.all([
      db.specDefinition.findMany({
        orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
        select: { id: true, key: true, archived: true, version: true },
      }),
      db.specDefinitionText.findMany({
        where: { locale: { in: [...new Set([locale, PLATFORM_SOURCE_LOCALE])] } },
        select: { definitionId: true, locale: true, name: true, sourceHash: true },
      }),
      readable.length
        ? db.productPublication.findMany({
            where: { siteId: { in: readable }, status: "PUBLISHED" },
            select: { snapshot: true },
          })
        : [],
    ]);
    const live = pubs.map((p) => parseStoredSnapshot(p.snapshot)).filter((x) => x !== null);
    const isSource = locale === PLATFORM_SOURCE_LOCALE;
    const tags = new Set(
      [...all.values()].flatMap((list) => list.filter((l) => l.enabled).map((l) => l.locale)),
    );
    return {
      locale,
      sourceLocale: PLATFORM_SOURCE_LOCALE,
      locales: [
        PLATFORM_SOURCE_LOCALE,
        ...[...tags].filter((t) => t !== PLATFORM_SOURCE_LOCALE).sort(),
      ],
      enabled,
      canEdit: a.allows(MASTER, PLATFORM),
      items: defs.map((d) => {
        const own = texts.find((t) => t.definitionId === d.id && t.locale === locale);
        const src = texts.find(
          (t) => t.definitionId === d.id && t.locale === PLATFORM_SOURCE_LOCALE,
        );
        const shown = live.filter((s) => s.specs.some((x) => x.key === d.key));
        const names = shown
          .map((s) => snapshotLocaleTexts(s, locale))
          .filter((t) => t !== null)
          .map((t) => t.specNames[d.key] ?? null);
        return {
          id: d.id,
          key: d.key,
          archived: d.archived,
          version: d.version,
          liveProducts: shown.length,
          state: translationState({
            hasValue: !!own,
            hasSource: !!src,
            isDefault: isSource,
            sourceChanged: !!own && !isSource && own.sourceHash !== nameHash(src?.name),
            live: !!own && names.length > 0 && names.every((n) => n === own.name),
          }),
          name: { value: own?.name ?? null, source: src?.name ?? null },
        };
      }),
    };
  }

  // --- ML-8b (DP-257): one language of the next publication, next to the live one --------------

  async publicationPreview(
    ctx: RequestContext,
    rawProductId: string,
    rawSiteId: string,
    query: Record<string, unknown>,
  ): Promise<PublicationPreviewResponse> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    const siteId = CatalogTranslationsService.siteId(rawSiteId);
    await a.require(READ, { scope: "site", siteId }, { type: "product", id: productId });
    const locale = localeOr404(query.locale);
    const db = a.db({ siteIds: [siteId], includePlatform: true });
    const all = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
    if (localeEditProblem(all, locale)) throw notEnabled();
    const { defaultLocale, locales } = catalogLocales(all);
    const rows = await loadProductTextRows(db, productId, siteId, all);
    if (!rows) throw new ApiError("NOT_FOUND");
    const view = localeView(rows, locale);
    const next = await CatalogTranslationsService.nextSnapshot(db, productId, siteId, {
      defaultLocale,
      locales,
      locale,
    });
    const own = rows.listing?.texts.find((t) => t.locale === locale);
    const row = all.find((l) => l.locale === locale);
    return {
      productId,
      siteId,
      locale,
      defaultLocale,
      public: Boolean(row?.enabled && row.public),
      next: view.requiredMissing.length ? null : next,
      live: rows.live ? localizeSnapshot(rows.live, locale) : null,
      requiredMissing: view.requiredMissing,
      missing: view.missing,
      claims:
        locale === defaultLocale
          ? findSensitiveClaims(next?.name, next?.summary, next?.description)
          : findSensitiveClaims(own?.title, own?.summary, own?.description),
      claimScan: claimScanOf(locale),
    };
  }

  /**
   * The view of one language of the snapshot the next publication would store if the language
   * were chosen (built like WorkflowService.publish, current rows only); null when the listing,
   * its category or a complete text is missing.
   */
  private static async nextSnapshot(
    db: ReturnType<StaffAccess["db"]>,
    productId: string,
    siteId: string,
    o: { defaultLocale: string; locales: string[]; locale: string },
  ) {
    const product = await db.product.findUnique({ where: { id: productId } });
    const listing = await db.productSiteListing.findUnique({
      where: { productId_siteId: { productId, siteId } },
      include: { texts: { select: LISTING_TEXT_SELECT } },
    });
    if (!product || !listing) return null;
    const category = await db.productCategory.findUnique({
      where: { id: listing.categoryId },
      select: { id: true, slug: true },
    });
    if (!category) return null;
    const [values, images] = await Promise.all([
      db.productSpecValue.findMany({
        where: { productId },
        include: { definition: { select: { id: true, key: true, sortOrder: true } } },
      }),
      db.productImage.findMany({
        where: { productId, isPublic: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, isCover: true, variants: true },
      }),
    ]);
    const textRows = await loadTextRows(db, {
      categoryIds: [category.id],
      definitionIds: [...new Set(values.map((v) => v.definition.id))],
      imageIds: images.map((i) => i.id),
    });
    const snapshot = buildSnapshotV2({
      defaultLocale: o.defaultLocale,
      locales: o.locales,
      only: [o.locale],
      product,
      listing,
      listingTexts: listing.texts,
      category,
      categoryTexts: textRows.categoryTexts,
      specs: values.map((v) => ({
        definitionId: v.definition.id,
        key: v.definition.key,
        sortOrder: v.definition.sortOrder,
        basis: v.basis,
        value: valueData(v),
        unit: v.unit,
        testMethod: v.testMethod,
      })),
      specTexts: textRows.specTexts,
      images: images.map((i) => ({ id: i.id, isCover: i.isCover, ...displaySize(i.variants) })),
      imageTexts: textRows.imageTexts,
    });
    return localizeSnapshot(snapshot, o.locale);
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
    const siteLocales = await CatalogTranslationsService.requireSiteLocale(a, siteId, locale);
    const isDefault = siteLocales.find((l) => l.isDefault)?.locale === locale;
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
            texts: { select: LISTING_TEXT_SELECT },
          },
        });
        if (!listing) throw new ApiError("NOT_FOUND", [{ path: "listing", rule: "missing" }]);
        if (listing.version !== input.version) throw staleVersion();
        const before = listing.texts.find((t) => t.locale === locale);
        // ML-8b: the source revision of the parts this save was checked against (not for the
        // default language, which is the source).
        const hashes: { sourceHash?: string; seoSourceHash?: string } = {};
        if (!isDefault) {
          const def = listing.texts.find((t) =>
            siteLocales.some((l) => l.isDefault && l.locale === t.locale),
          );
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { name: true, summary: true, description: true },
          });
          if (!product) throw new ApiError("NOT_FOUND");
          if (input.sections.includes("texts")) {
            hashes.sourceHash = listingTextsHash(listingSource(product, def));
          }
          if (input.sections.includes("seo")) hashes.seoSourceHash = listingSeoHash(def);
        }
        const res = await tx.productSiteListing.updateMany({
          where: { id: listing.id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        if (before) {
          await tx.productListingText.update({
            where: { listingId_locale: { listingId: listing.id, locale } },
            data: { ...text, ...hashes },
          });
        } else if (Object.values(text).some((v) => v !== null)) {
          await tx.productListingText.create({
            data: { listingId: listing.id, siteId, locale, ...text, ...hashes },
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
            ...(isDefault ? {} : { checked: input.sections }),
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
    const siteLocales = await CatalogTranslationsService.requireSiteLocale(a, siteId, locale);
    const defaultLocale = siteLocales.find((l) => l.isDefault)?.locale;
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
          const source =
            locale === defaultLocale
              ? null
              : await tx.productCategoryText.findUnique({
                  where: { categoryId_locale: { categoryId: id, locale: defaultLocale ?? "" } },
                  select: { name: true, description: true },
                });
          const data = {
            name: input.name,
            description: input.description,
            // ML-8b: the source revision this translation was written against.
            ...(locale === defaultLocale ? {} : { sourceHash: categoryHash(source ?? undefined) }),
          };
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
          // ML-8b: the English name this translation was written against.
          const hash =
            locale === PLATFORM_SOURCE_LOCALE
              ? {}
              : {
                  sourceHash: nameHash(
                    (
                      await tx.specDefinitionText.findUnique({
                        where: {
                          definitionId_locale: { definitionId: id, locale: PLATFORM_SOURCE_LOCALE },
                        },
                        select: { name: true },
                      })
                    )?.name,
                  ),
                };
          await tx.specDefinitionText.upsert({
            where: { definitionId_locale: { definitionId: id, locale } },
            create: { definitionId: id, locale, name: input.name, ...hash },
            update: { name: input.name, ...hash },
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
          // ML-8b: the English alt text this translation was written against.
          const hash =
            locale === PLATFORM_SOURCE_LOCALE
              ? {}
              : {
                  sourceHash: nameHash(
                    (
                      await tx.productImageText.findUnique({
                        where: { imageId_locale: { imageId: id, locale: PLATFORM_SOURCE_LOCALE } },
                        select: { altText: true },
                      })
                    )?.altText,
                  ),
                };
          await tx.productImageText.upsert({
            where: { imageId_locale: { imageId: id, locale } },
            create: { imageId: id, locale, altText: input.altText, ...hash },
            update: { altText: input.altText, ...hash },
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
