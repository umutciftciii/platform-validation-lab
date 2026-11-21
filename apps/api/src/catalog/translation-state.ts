/**
 * ML-8b (ADR-028 D8, DP-239, DP-257): the translation state of a product's texts on one site,
 * shared by the console's language tabs (translations.service.ts), the publication view and the
 * publication itself (workflow.service.ts), so they agree on what is missing, outdated or live.
 *
 *  - Source revision: when a text in a language other than the default is saved, the SHA-256 of
 *    the default-language source it was written against is stored with it (migration 40). A
 *    different hash today → OUTDATED. The default language is the source, never outdated.
 *  - Live: the product's PUBLISHED snapshot on the site (v1 = English, v2 per language); a text
 *    is PUBLISHED when the snapshot carries exactly it in that language.
 *  - Required for a language to enter a publication (contracts RequiredTranslation): an own
 *    listing text, the category name and every specification name. Alt and SEO texts are listed
 *    as missing but never block.
 *
 * Platform-wide names (specifications, image alt texts) are translated from English, the language
 * of the platform-wide columns (ML-8a); site rows (listing, category) from the site's default.
 */
import { createHash } from "node:crypto";
import {
  combinedTranslationState,
  parseStoredSnapshot,
  snapshotLocaleTexts,
  translationState,
  type SiteLocale,
  type SnapshotLocaleTexts,
  type StoredSnapshot,
  type TranslationState,
} from "@dream/contracts";
import type { SiteScopedClient } from "../iam/site-scope.js";
import type { ScopedTx } from "./master.js";
import { LISTING_TEXT_SELECT, type ListingTextRow } from "./snapshot.js";

type Db = SiteScopedClient | ScopedTx;

/** The language of the platform-wide names (specifications, alt texts). */
export const PLATFORM_SOURCE_LOCALE = "en";

/** SHA-256 (hex) of a source: the values in a fixed order (null kept). */
export function sourceHash(values: readonly (string | null | undefined)[]): string {
  return createHash("sha256")
    .update(JSON.stringify(values.map((v) => v ?? null)))
    .digest("hex");
}

export interface ProductTexts {
  name: string;
  summary: string | null;
  description: string | null;
}

/**
 * What the site's page shows in the default language for title, summary and description: the
 * listing's own text, else the shared product text (as the publication falls back).
 */
export function listingSource(product: ProductTexts, def: ListingTextRow | undefined) {
  return {
    title: def?.title ?? product.name,
    summary: def?.summary ?? product.summary,
    description: def?.description ?? product.description,
    shared: {
      title: (def?.title ?? null) === null,
      summary: (def?.summary ?? null) === null,
      description: (def?.description ?? null) === null,
    },
  };
}

export const listingTextsHash = (s: ReturnType<typeof listingSource>) =>
  sourceHash([s.title, s.summary, s.description]);
export const listingSeoHash = (def: ListingTextRow | undefined) =>
  sourceHash([
    def?.seoTitle ?? null,
    def?.seoDescription ?? null,
    def?.seoOgTitle ?? null,
    def?.seoOgDescription ?? null,
  ]);
export const categoryHash = (t: { name: string; description: string | null } | undefined) =>
  sourceHash([t?.name ?? null, t?.description ?? null]);
export const nameHash = (name: string | null | undefined) => sourceHash([name ?? null]);

export interface ListingTextState extends ListingTextRow {
  sourceHash: string | null;
  seoSourceHash: string | null;
}

export interface ProductTextRows {
  defaultLocale: string;
  siteLocales: SiteLocale[];
  product: ProductTexts;
  listing: { id: string; version: number; categoryId: string; texts: ListingTextState[] } | null;
  category: { id: string; version: number } | null;
  categoryTexts: {
    locale: string;
    name: string;
    description: string | null;
    sourceHash: string | null;
  }[];
  /** The definitions the product has values for, in display order. */
  specs: { definitionId: string; key: string; version: number }[];
  specTexts: { definitionId: string; locale: string; name: string; sourceHash: string | null }[];
  images: { id: string; version: number; isPublic: boolean; originalFilename: string }[];
  imageTexts: {
    imageId: string;
    locale: string;
    altText: string | null;
    sourceHash: string | null;
  }[];
  /** The live (PUBLISHED) snapshot of the product on the site, if any. */
  live: StoredSnapshot | null;
}

/** Everything the translation states of one product on one site need (null: no such product). */
export async function loadProductTextRows(
  db: Db,
  productId: string,
  siteId: string,
  siteLocales: SiteLocale[],
): Promise<ProductTextRows | null> {
  const def = siteLocales.find((l) => l.isDefault);
  if (!def) return null;
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { name: true, summary: true, description: true },
  });
  if (!product) return null;
  const [listing, values, images, publication] = await Promise.all([
    db.productSiteListing.findUnique({
      where: { productId_siteId: { productId, siteId } },
      select: {
        id: true,
        version: true,
        categoryId: true,
        texts: { select: { ...LISTING_TEXT_SELECT, sourceHash: true, seoSourceHash: true } },
      },
    }),
    db.productSpecValue.findMany({
      where: { productId },
      select: { definition: { select: { id: true, key: true, version: true, sortOrder: true } } },
    }),
    db.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, version: true, isPublic: true, originalFilename: true },
    }),
    db.productPublication.findUnique({
      where: { productId_siteId: { productId, siteId } },
      select: { status: true, snapshot: true },
    }),
  ]);
  const category = listing
    ? await db.productCategory.findUnique({
        where: { id: listing.categoryId },
        select: { id: true, version: true },
      })
    : null;
  const byId = new Map(values.map((v) => [v.definition.id, v.definition]));
  const defs = [...byId.values()];
  const [categoryTexts, specTexts, imageTexts] = await Promise.all([
    category
      ? db.productCategoryText.findMany({
          where: { categoryId: category.id },
          select: { locale: true, name: true, description: true, sourceHash: true },
        })
      : [],
    defs.length
      ? db.specDefinitionText.findMany({
          where: { definitionId: { in: defs.map((d) => d.id) } },
          select: { definitionId: true, locale: true, name: true, sourceHash: true },
        })
      : [],
    images.length
      ? db.productImageText.findMany({
          where: { imageId: { in: images.map((i) => i.id) } },
          select: { imageId: true, locale: true, altText: true, sourceHash: true },
        })
      : [],
  ]);
  // PM-2 order: definition sort order, then the source (English) name, then the key.
  const sourceName = (id: string) =>
    specTexts.find((t) => t.definitionId === id && t.locale === PLATFORM_SOURCE_LOCALE)?.name ?? "";
  const specs = defs
    .sort(
      (x, y) =>
        x.sortOrder - y.sortOrder ||
        sourceName(x.id).localeCompare(sourceName(y.id)) ||
        x.key.localeCompare(y.key),
    )
    .map((d) => ({ definitionId: d.id, key: d.key, version: d.version }));
  return {
    defaultLocale: def.locale,
    siteLocales,
    product,
    listing,
    category,
    categoryTexts,
    specs,
    specTexts,
    images,
    imageTexts,
    live: publication?.status === "PUBLISHED" ? parseStoredSnapshot(publication.snapshot) : null,
  };
}

const hasOwnText = (t: ListingTextRow | undefined) =>
  !!t && (t.title !== null || t.summary !== null || t.description !== null);

/** The state of every text of the product in one language (see the header). */
export function localeView(rows: ProductTextRows, locale: string) {
  const isDefault = locale === rows.defaultLocale;
  const liveTexts: SnapshotLocaleTexts | null = rows.live
    ? snapshotLocaleTexts(rows.live, locale)
    : null;
  const liveImages = new Set(rows.live ? rows.live.images.map((i) => i.id) : []);
  const missing: string[] = [];
  const requiredMissing: string[] = [];

  // --- listing texts and SEO texts ---
  const lt = (l: string) => rows.listing?.texts.find((t) => t.locale === l);
  const own = lt(locale);
  const defRow = lt(rows.defaultLocale);
  const src = listingSource(rows.product, defRow);
  let listing: {
    state: TranslationState | null;
    seoState: TranslationState | null;
    hasText: boolean;
    source: ReturnType<typeof listingSource>;
  } | null = null;
  if (rows.listing) {
    const hasText = hasOwnText(own);
    const value = {
      name: own?.title ?? rows.product.name,
      summary: own?.summary ?? (isDefault ? rows.product.summary : null),
      description: own?.description ?? (isDefault ? rows.product.description : null),
    };
    const textsLive =
      !!liveTexts &&
      liveTexts.name === value.name &&
      liveTexts.summary === value.summary &&
      liveTexts.description === value.description;
    const seo = {
      title: own?.seoTitle ?? null,
      description: own?.seoDescription ?? null,
      ogTitle: own?.seoOgTitle ?? null,
      ogDescription: own?.seoOgDescription ?? null,
    };
    const hasSeo = Object.values(seo).some((v) => v !== null);
    const defSeo = [
      defRow?.seoTitle,
      defRow?.seoDescription,
      defRow?.seoOgTitle,
      defRow?.seoOgDescription,
    ];
    const seoLive =
      !!liveTexts &&
      liveTexts.seo.title === seo.title &&
      liveTexts.seo.description === seo.description &&
      liveTexts.seo.ogTitle === seo.ogTitle &&
      liveTexts.seo.ogDescription === seo.ogDescription;
    listing = {
      hasText,
      source: src,
      state: translationState({
        hasValue: isDefault || hasText,
        hasSource: true,
        isDefault,
        sourceChanged: !!own && own.sourceHash !== listingTextsHash(src),
        live: textsLive,
      }),
      seoState: translationState({
        hasValue: hasSeo,
        hasSource: defSeo.some((v) => v),
        isDefault,
        sourceChanged: !!own && hasSeo && own.seoSourceHash !== listingSeoHash(defRow),
        live: seoLive,
      }),
    };
    if (!isDefault) {
      if (!hasText) requiredMissing.push("listing");
      if (!src.shared.title && own?.title == null) missing.push("title");
      if (src.summary !== null && own?.summary == null) missing.push("summary");
      if (src.description !== null && own?.description == null) missing.push("description");
      const seoKeys = ["title", "description", "ogTitle", "ogDescription"] as const;
      seoKeys.forEach((k, i) => {
        if (defSeo[i] && seo[k] === null) missing.push(`seo.${k}`);
      });
    }
  }

  // --- category ---
  const ct = (l: string) => rows.categoryTexts.find((t) => t.locale === l);
  const catOwn = ct(locale);
  const catSrc = ct(rows.defaultLocale);
  const category = rows.category
    ? {
        state: translationState({
          hasValue: !!catOwn,
          hasSource: !!catSrc,
          isDefault,
          sourceChanged: !!catOwn && catOwn.sourceHash !== categoryHash(catSrc),
          live: !!liveTexts && !!catOwn && liveTexts.categoryName === catOwn.name,
        }),
      }
    : null;
  if (rows.category && !isDefault) {
    if (!catOwn) {
      requiredMissing.push("category");
      missing.push("category.name");
    }
    if (catSrc?.description && !catOwn?.description) missing.push("category.description");
  }

  // --- specification names ---
  const specs = rows.specs.map((s) => {
    const name = (l: string) =>
      rows.specTexts.find((t) => t.definitionId === s.definitionId && t.locale === l);
    const v = name(locale);
    const source = name(PLATFORM_SOURCE_LOCALE);
    if (!v && !isDefault) {
      requiredMissing.push(`spec:${s.key}`);
      missing.push(`spec:${s.key}`);
    }
    return {
      ...s,
      state: translationState({
        hasValue: !!v,
        hasSource: !!source,
        isDefault: isDefault || locale === PLATFORM_SOURCE_LOCALE,
        sourceChanged: !!v && v.sourceHash !== nameHash(source?.name),
        live: !!liveTexts && !!v && liveTexts.specNames[s.key] === v.name,
      }),
    };
  });

  // --- image alt texts ---
  const images = rows.images.map((i) => {
    const alt = (l: string) =>
      rows.imageTexts.find((t) => t.imageId === i.id && t.locale === l)?.altText ?? null;
    const row = rows.imageTexts.find((t) => t.imageId === i.id && t.locale === locale);
    const v = alt(locale);
    const source = alt(PLATFORM_SOURCE_LOCALE);
    if (i.isPublic && !isDefault && source && !v) missing.push(`image:${i.id}`);
    return {
      ...i,
      state: translationState({
        hasValue: v !== null,
        hasSource: source !== null,
        isDefault: isDefault || locale === PLATFORM_SOURCE_LOCALE,
        sourceChanged: !!row && v !== null && row.sourceHash !== nameHash(source),
        live:
          !!liveTexts &&
          i.isPublic &&
          liveImages.has(i.id) &&
          (liveTexts.imageAlts[i.id] ?? null) === v,
      }),
    };
  });

  const outdated = [listing?.seoState, ...images.map((i) => i.state)].some((s) => s === "OUTDATED");
  const state = outdated
    ? "OUTDATED"
    : combinedTranslationState([
        listing?.state ?? null,
        category?.state ?? null,
        ...specs.map((s) => s.state),
      ]);
  return {
    locale,
    isDefault,
    hasText: isDefault || (listing?.hasText ?? false),
    live: !!liveTexts,
    listing,
    category,
    specs,
    images,
    requiredMissing,
    missing,
    state,
  };
}
