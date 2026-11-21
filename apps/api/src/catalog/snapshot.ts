/**
 * ML-8a (ADR-028 D8): building the v2 publication snapshot from the catalogue's per-language
 * rows. Used by the publication (WorkflowService.publish) and the catalogue preview, so the
 * preview shows exactly what the next publication would store.
 *
 * Which languages a snapshot carries: the site's default language always; every other enabled
 * language of the site only when the listing has its own text there (title, summary or
 * description). Nothing is copied from another language: the product name is the only text
 * shared by all languages (names are codes or trade names, ADR-028 §1.2), everything else of a
 * language comes from that language's rows or stays null / out of the map.
 */
import {
  PublishedSnapshotV2Schema,
  type PublishedSnapshotV2,
  type SiteLocale,
  type SnapshotLocaleTexts,
  type SpecValueData,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import type { ScopedTx } from "./master.js";

export interface ListingTextRow {
  locale: string;
  title: string | null;
  summary: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgTitle: string | null;
  seoOgDescription: string | null;
}

/** The text columns of a listing text (selected wherever a snapshot is built). */
export const LISTING_TEXT_SELECT = {
  locale: true,
  title: true,
  summary: true,
  description: true,
  seoTitle: true,
  seoDescription: true,
  seoOgTitle: true,
  seoOgDescription: true,
} as const;

export interface SnapshotInput {
  defaultLocale: string;
  /** The site's enabled languages (any order; the default is always used). */
  locales: readonly string[];
  product: {
    slug: string;
    code: string;
    name: string;
    summary: string | null;
    description: string | null;
  };
  listing: {
    sortOrder: number;
    seoCanonicalPath: string | null;
    seoNoindex: boolean;
    seoOgImageId: string | null;
  };
  listingTexts: readonly ListingTextRow[];
  category: { slug: string };
  categoryTexts: readonly { locale: string; name: string }[];
  /** Values of the product with their definition's id and sort order (any order). */
  specs: readonly {
    definitionId: string;
    key: string;
    sortOrder: number;
    basis: "SPECIFICATION" | "TYPICAL";
    value: SpecValueData;
    unit: string | null;
    testMethod: string | null;
  }[];
  specTexts: readonly { definitionId: string; locale: string; name: string }[];
  /** The public images in display order. */
  images: readonly { id: string; isCover: boolean; width: number; height: number }[];
  imageTexts: readonly { imageId: string; locale: string; altText: string | null }[];
}

const hasOwnText = (t: ListingTextRow | undefined) =>
  !!t && (t.title !== null || t.summary !== null || t.description !== null);

/** The languages a publication writes (default first, then the others in tag order). */
export function snapshotLocalesOf(
  input: Pick<SnapshotInput, "defaultLocale" | "locales" | "listingTexts">,
): string[] {
  const others = input.locales
    .filter((l) => l !== input.defaultLocale)
    .filter((l) => hasOwnText(input.listingTexts.find((t) => t.locale === l)))
    .sort();
  return [input.defaultLocale, ...others];
}

/**
 * The v2 snapshot. 409 CONFLICT_STATE `{ path: "locale", rule: "default_text_missing" }` when the
 * default language lacks a category or specification name (the database keeps the English rows
 * in step with the English columns, so this means broken data, never a missing translation).
 */
export function buildSnapshotV2(input: SnapshotInput): PublishedSnapshotV2 {
  const def = input.defaultLocale;
  const specName = (definitionId: string, locale: string) =>
    input.specTexts.find((t) => t.definitionId === definitionId && t.locale === locale)?.name;
  const defName = (definitionId: string) => {
    const n = specName(definitionId, def);
    if (n === undefined) {
      throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "default_text_missing" }]);
    }
    return n;
  };
  // PM-2 order: definition sort order, then the default language's name, then the specification
  // value before the typical value of the same property (DP-156). Same in every language.
  const specs = [...input.specs].sort(
    (x, y) =>
      x.sortOrder - y.sortOrder ||
      defName(x.definitionId).localeCompare(defName(y.definitionId)) ||
      (x.basis === y.basis ? 0 : x.basis === "SPECIFICATION" ? -1 : 1),
  );
  for (const s of specs) defName(s.definitionId);
  const locales: Record<string, SnapshotLocaleTexts> = {};
  for (const locale of snapshotLocalesOf(input)) {
    const isDefault = locale === def;
    const t = input.listingTexts.find((x) => x.locale === locale);
    const categoryName = input.categoryTexts.find((c) => c.locale === locale)?.name ?? null;
    if (isDefault && categoryName === null) {
      throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "default_text_missing" }]);
    }
    const specNames: Record<string, string> = {};
    for (const s of specs) {
      const n = specName(s.definitionId, locale);
      if (n !== undefined) specNames[s.key] = n;
    }
    const imageAlts: Record<string, string> = {};
    for (const i of input.images) {
      const a = input.imageTexts.find((x) => x.imageId === i.id && x.locale === locale)?.altText;
      if (a) imageAlts[i.id] = a;
    }
    locales[locale] = {
      name: t?.title ?? input.product.name,
      // Only the default language falls back to the master's own (English) texts, as before.
      summary: t?.summary ?? (isDefault ? input.product.summary : null),
      description: t?.description ?? (isDefault ? input.product.description : null),
      categoryName,
      specNames,
      imageAlts,
      seo: {
        title: t?.seoTitle ?? null,
        description: t?.seoDescription ?? null,
        ogTitle: t?.seoOgTitle ?? null,
        ogDescription: t?.seoOgDescription ?? null,
      },
    };
  }
  const ogImageId = input.listing.seoOgImageId;
  return PublishedSnapshotV2Schema.parse({
    schemaVersion: 2,
    defaultLocale: def,
    slug: input.product.slug,
    code: input.product.code,
    category: { slug: input.category.slug },
    sortOrder: input.listing.sortOrder,
    specs: specs.map((s) => ({
      key: s.key,
      basis: s.basis,
      value: s.value,
      unit: s.unit,
      testMethod: s.testMethod,
    })),
    images: input.images.map((i) => ({
      id: i.id,
      isCover: i.isCover,
      width: i.width,
      height: i.height,
    })),
    // DP-209: an OG image no longer among the published images falls back to the cover.
    seo: {
      canonicalPath: input.listing.seoCanonicalPath,
      noindex: input.listing.seoNoindex,
      ogImageId: ogImageId && input.images.some((i) => i.id === ogImageId) ? ogImageId : null,
    },
    locales,
  });
}

type Db = SiteScopedClient | ScopedTx;

/** The default and the enabled languages of a site (the database guarantees a default). */
export function catalogLocales(all: readonly SiteLocale[]): {
  defaultLocale: string;
  locales: string[];
} {
  const def = all.find((l) => l.isDefault);
  if (!def) throw new ApiError("INTERNAL_ERROR");
  return { defaultLocale: def.locale, locales: all.filter((l) => l.enabled).map((l) => l.locale) };
}

/** The per-language rows of categories, definitions and images (one round trip per table). */
export async function loadTextRows(
  db: Db,
  ids: {
    categoryIds: readonly string[];
    definitionIds: readonly string[];
    imageIds: readonly string[];
  },
) {
  const [categoryTexts, specTexts, imageTexts] = await Promise.all([
    ids.categoryIds.length
      ? db.productCategoryText.findMany({
          where: { categoryId: { in: [...ids.categoryIds] } },
          select: { categoryId: true, locale: true, name: true, description: true },
        })
      : [],
    ids.definitionIds.length
      ? db.specDefinitionText.findMany({
          where: { definitionId: { in: [...ids.definitionIds] } },
          select: { definitionId: true, locale: true, name: true },
        })
      : [],
    ids.imageIds.length
      ? db.productImageText.findMany({
          where: { imageId: { in: [...ids.imageIds] } },
          select: { imageId: true, locale: true, altText: true },
        })
      : [],
  ]);
  return { categoryTexts, specTexts, imageTexts };
}

/** Display size of an image (its display variant; 0 when not derived yet). */
export function displaySize(variants: unknown): { width: number; height: number } {
  const display = (variants as { display?: { width?: number; height?: number } } | null)?.display;
  return { width: display?.width ?? 0, height: display?.height ?? 0 };
}
