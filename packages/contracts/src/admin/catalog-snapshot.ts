/**
 * The published snapshot of a product on one site (PM-3) and how it is read per language
 * (ML-8a, ADR-028 D8).
 *
 * A publication stores one immutable JSON snapshot (`ProductPublication.snapshot`). Two shapes
 * exist and both stay readable:
 *
 *  - **v1** (`schemaVersion: 1`, before ML-8a): one language. Every v1 snapshot was written in
 *    English (`SNAPSHOT_V1_LOCALE`), the only catalogue language before ADR-028.
 *  - **v2** (`schemaVersion: 2`, ML-8a): the language-neutral content once (slug, code, category
 *    slug, technical values, images, canonical/noindex/OG image) and a map `locales` with the
 *    texts of every language that was ready at publication (name, summary, description, category
 *    name, specification names, image alt texts, SEO texts). The site's default language is
 *    always present. A language without its own listing text is not in the map: nothing is
 *    copied from another language, so no translation is ever invented.
 *
 * Readers never look at either shape directly: `readSnapshot(raw, locale)` returns the view of
 * one language (`PublishedSnapshot`, the v1 shape every reader used before ML-8a) or null when
 * the snapshot has no complete text in that language. The view of the default language of a v2
 * snapshot is exactly the v1 snapshot the same content gave before (tested), so the English
 * output of the sites does not change.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import { ProductSeoSchema } from "../seo.js";
import { LocaleTagSchema } from "../site-locales.js";
import { SpecValueBasisSchema, SpecValueDataSchema } from "./catalog-specs.js";

/** The language of every v1 snapshot (written before ML-8a, English only). */
export const SNAPSHOT_V1_LOCALE = "en";

/**
 * v1 and the per-language view: the content of one product on one site in one language. Only
 * approved, public fields: no ids of staff, no storage keys, file names, hashes or original
 * images.
 */
export const PublishedSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  slug: z.string(),
  code: z.string(),
  name: z.string(),
  /** DP-161: null when the product has no summary (no longer required for publication). */
  summary: z.string().nullable(),
  description: z.string().nullable(),
  category: z.strictObject({ slug: z.string(), name: z.string() }),
  sortOrder: z.number().int(),
  specs: z
    .array(
      z.strictObject({
        key: z.string(),
        name: z.string(),
        /** DP-156; snapshots taken before it hold specification values only. */
        basis: SpecValueBasisSchema.default("SPECIFICATION"),
        value: SpecValueDataSchema,
        unit: z.string().nullable(),
        testMethod: z.string().nullable(),
      }),
    )
    .max(500),
  images: z
    .array(
      z.strictObject({
        id: UuidSchema,
        altText: z.string().nullable(),
        isCover: z.boolean(),
        /** Size of the display variant. */
        width: z.number().int(),
        height: z.number().int(),
      }),
    )
    .max(100),
  /**
   * DP-209: the listing's SEO at publication. Snapshots taken before DP-209 have none (the site
   * falls back to the product's own fields). Changing it takes a new publication, like the texts.
   */
  seo: ProductSeoSchema.optional(),
});
/** The content of one language: what the public catalogue, SEO and menus read. */
export type PublishedSnapshot = z.infer<typeof PublishedSnapshotV1Schema>;
export type PublishedSnapshotV1 = PublishedSnapshot;

const SnapshotSeoTextsSchema = z.strictObject({
  title: z.string().nullable(),
  description: z.string().nullable(),
  ogTitle: z.string().nullable(),
  ogDescription: z.string().nullable(),
});

/** The texts of one language inside a v2 snapshot. */
export const SnapshotLocaleTextsSchema = z.strictObject({
  /** The listing title of this language, else the product name (names are not translated). */
  name: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  /** The category's name in this language; null: not translated (the language is incomplete). */
  categoryName: z.string().nullable(),
  /** Specification key → name in this language; a missing key is not translated. */
  specNames: z.record(z.string(), z.string()),
  /** Image id → alt text in this language; a missing id has no alt text in this language. */
  imageAlts: z.record(UuidSchema, z.string()),
  seo: SnapshotSeoTextsSchema,
});
export type SnapshotLocaleTexts = z.infer<typeof SnapshotLocaleTextsSchema>;

/** v2 (ML-8a): language-neutral content once, the texts per language. */
export const PublishedSnapshotV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    /** The site's default language at publication; always in `locales`. */
    defaultLocale: LocaleTagSchema,
    slug: z.string(),
    code: z.string(),
    category: z.strictObject({ slug: z.string() }),
    sortOrder: z.number().int(),
    specs: z
      .array(
        z.strictObject({
          key: z.string(),
          basis: SpecValueBasisSchema,
          value: SpecValueDataSchema,
          unit: z.string().nullable(),
          testMethod: z.string().nullable(),
        }),
      )
      .max(500),
    images: z
      .array(
        z.strictObject({
          id: UuidSchema,
          isCover: z.boolean(),
          width: z.number().int(),
          height: z.number().int(),
        }),
      )
      .max(100),
    seo: z.strictObject({
      canonicalPath: z.string().nullable(),
      noindex: z.boolean(),
      ogImageId: UuidSchema.nullable(),
    }),
    locales: z.record(LocaleTagSchema, SnapshotLocaleTextsSchema),
  })
  .refine((s) => Object.hasOwn(s.locales, s.defaultLocale), {
    path: ["locales"],
    message: "the default language is missing",
  })
  .refine((s) => Object.keys(s.locales).length <= 20, {
    path: ["locales"],
    message: "too many languages",
  });
export type PublishedSnapshotV2 = z.infer<typeof PublishedSnapshotV2Schema>;

/** What `ProductPublication.snapshot` holds: either version. */
export const StoredSnapshotSchema = z.union([PublishedSnapshotV1Schema, PublishedSnapshotV2Schema]);
export type StoredSnapshot = PublishedSnapshotV1 | PublishedSnapshotV2;

/** The stored snapshot, or null when the JSON is neither version (never served). */
export function parseStoredSnapshot(raw: unknown): StoredSnapshot | null {
  const r = StoredSnapshotSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** The languages a stored snapshot has texts for (default first for v2). */
export function snapshotLocales(s: StoredSnapshot): string[] {
  if (s.schemaVersion === 1) return [SNAPSHOT_V1_LOCALE];
  return [
    s.defaultLocale,
    ...Object.keys(s.locales)
      .filter((l) => l !== s.defaultLocale)
      .sort(),
  ];
}

/** The slug of a stored snapshot (language-neutral); null when the JSON is not a snapshot. */
export function storedSnapshotSlug(raw: unknown): string | null {
  return parseStoredSnapshot(raw)?.slug ?? null;
}

/** What a language of a v2 snapshot lacks (shown text of the default language not translated). */
export type SnapshotMissingText = "category" | `spec:${string}` | `image:${string}`;

export interface SnapshotLocaleCoverage {
  locale: string;
  /** Category and every specification name are there: the language can be shown. */
  complete: boolean;
  /** Untranslated category and specification names, and images without an alt text here while
   * the default language has one (alt texts do not block, ADR-028 §5 counts them). */
  missing: SnapshotMissingText[];
}

function coverageOf(s: PublishedSnapshotV2, locale: string): SnapshotLocaleCoverage | null {
  const t = s.locales[locale];
  if (!t) return null;
  const def = s.locales[s.defaultLocale];
  const missing: SnapshotMissingText[] = [];
  if (t.categoryName === null) missing.push("category");
  for (const key of new Set(s.specs.map((x) => x.key))) {
    if (!Object.hasOwn(t.specNames, key)) missing.push(`spec:${key}`);
  }
  const blocking = missing.length;
  for (const i of s.images) {
    if (def && Object.hasOwn(def.imageAlts, i.id) && !Object.hasOwn(t.imageAlts, i.id)) {
      missing.push(`image:${i.id}`);
    }
  }
  return { locale, complete: blocking === 0, missing };
}

/** Per language of the snapshot: whether it can be shown and what it lacks. */
export function snapshotCoverage(s: StoredSnapshot): SnapshotLocaleCoverage[] {
  if (s.schemaVersion === 1) return [{ locale: SNAPSHOT_V1_LOCALE, complete: true, missing: [] }];
  return snapshotLocales(s).map((l) => coverageOf(s, l) as SnapshotLocaleCoverage);
}

/**
 * The view of one language, or null when the snapshot has no complete text in it: a v1 snapshot
 * answers only for `SNAPSHOT_V1_LOCALE`; a v2 snapshot for each language in `locales` whose
 * category and specification names are all translated. Nothing falls back to another language.
 */
export function localizeSnapshot(s: StoredSnapshot, locale: string): PublishedSnapshot | null {
  if (s.schemaVersion === 1) return locale === SNAPSHOT_V1_LOCALE ? s : null;
  const t = s.locales[locale];
  const cov = coverageOf(s, locale);
  if (!t || !cov?.complete || t.categoryName === null) return null;
  // Parsed through the v1 schema: same key order and defaults as a stored v1 snapshot.
  return PublishedSnapshotV1Schema.parse({
    schemaVersion: 1,
    slug: s.slug,
    code: s.code,
    name: t.name,
    summary: t.summary,
    description: t.description,
    category: { slug: s.category.slug, name: t.categoryName },
    sortOrder: s.sortOrder,
    specs: s.specs.map((x) => ({
      key: x.key,
      name: t.specNames[x.key] as string,
      basis: x.basis,
      value: x.value,
      unit: x.unit,
      testMethod: x.testMethod,
    })),
    images: s.images.map((i) => ({
      id: i.id,
      altText: Object.hasOwn(t.imageAlts, i.id) ? (t.imageAlts[i.id] as string) : null,
      isCover: i.isCover,
      width: i.width,
      height: i.height,
    })),
    seo: {
      title: t.seo.title,
      description: t.seo.description,
      ogTitle: t.seo.ogTitle,
      ogDescription: t.seo.ogDescription,
      canonicalPath: s.seo.canonicalPath,
      noindex: s.seo.noindex,
      ogImageId: s.seo.ogImageId,
    },
  });
}

/** `localizeSnapshot` of the raw JSON of a publication; null when unreadable or not in `locale`. */
export function readSnapshot(raw: unknown, locale: string): PublishedSnapshot | null {
  const s = parseStoredSnapshot(raw);
  return s ? localizeSnapshot(s, locale) : null;
}

/** The language-neutral fields readers of addresses and the sitemap need (any version). */
export interface SnapshotAddress {
  slug: string;
  noindex: boolean;
  canonicalPath: string | null;
}

/** Slug, noindex and canonical path of the raw JSON of a publication; null when unreadable. */
export function readSnapshotAddress(raw: unknown): SnapshotAddress | null {
  const s = parseStoredSnapshot(raw);
  if (!s) return null;
  return s.schemaVersion === 1
    ? {
        slug: s.slug,
        noindex: s.seo?.noindex ?? false,
        canonicalPath: s.seo?.canonicalPath ?? null,
      }
    : { slug: s.slug, noindex: s.seo.noindex, canonicalPath: s.seo.canonicalPath };
}
