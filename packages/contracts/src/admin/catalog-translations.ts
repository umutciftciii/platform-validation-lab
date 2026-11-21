/**
 * ML-8a (ADR-028 D8, DP-239, DP-214): catalogue texts per language.
 *
 * Every text a visitor reads about a product has one row per language:
 *
 *  | Text                                   | Table                  | Key                       |
 *  | -------------------------------------- | ---------------------- | ------------------------- |
 *  | listing title, summary, description    | `ProductListingText`   | listing, locale           |
 *  | product SEO title/description, OG texts (DP-214) | `ProductListingText` | listing, locale  |
 *  | category name and description          | `ProductCategoryText`  | category, locale          |
 *  | specification name                     | `SpecDefinitionText`   | definition, locale        |
 *  | image alt text                         | `ProductImageText`     | image, locale             |
 *
 * Product codes, slugs, units, test methods, values, the canonical path, noindex and the OG image
 * are language-neutral and stay where they are.
 *
 * The English columns of before ML-8a (`ProductCategory.name/description`, `SpecDefinition.name`,
 * `ProductImage.altText`, `ProductSiteListing.seo*`) are kept for one release and stay equal to
 * the English rows (database triggers, both directions), so the endpoints of before ML-8a keep
 * working unchanged and a rollback loses nothing. Readers use the per-language rows.
 *
 * Endpoints (admin, under CATALOG_API), all naming the version they were based on (409 stale):
 *  - `GET  /products/:id/translations?siteId&locale` — the product's texts in one language next
 *    to the default language (`product:read` of the site);
 *  - `POST /products/:id/listings/:siteId/texts/:locale` — listing texts and SEO texts of one
 *    language (`product:edit` of the site; listing version + 1);
 *  - `POST /categories/:id/texts/:locale` — a category's name and description (`product:edit`);
 *  - `POST /spec-definitions/:id/texts/:locale` — a specification name (`product_master:edit`);
 *  - `POST /images/:id/texts/:locale` — an image alt text (`product_master:edit`; like the
 *    English alt text it is master content: an approval is reset, ADR-023 unchanged).
 * The language must be enabled on the site (sites, for platform-wide rows: on any site the
 * caller may read); 409 `{ path: "locale", rule: "not_enabled" }` otherwise. A null name/alt text
 * removes the translation (not allowed for the site's default language, whose texts are
 * required where English ones are). Nothing reaches a public site before the next publication.
 *
 * ML-8b (admin language tabs): every text unit carries a translation state (`TRANSLATION_STATES`):
 *  - MISSING: no text in this language (while the default language has one);
 *  - DRAFT: saved, not (or not like this) in the live publication of the product;
 *  - PUBLISHED: exactly what the live publication carries in this language;
 *  - OUTDATED: the default-language source changed since the translation was saved (the API
 *    stores the SHA-256 of the source on every save, migration 40); saving again, or confirming
 *    it unchanged, makes it current. The default language is the source: never OUTDATED.
 * Saving a translation never publishes it: the publisher chooses the languages of a publication
 * (catalog-workflow.ts `PublishRequest.locales`). No text is ever copied from another language.
 *  - `GET /sites/:siteId/categories/translations?locale` and
 *    `GET /spec-definitions/translations?locale` list the categories of a site and the
 *    specification definitions with their texts in one language next to the default language.
 *  - `GET /products/:id/sites/:siteId/publication-preview?locale` shows what the next
 *    publication would carry in one language next to what is live (admin only).
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import { SEO_TEXT_LIMITS } from "../seo.js";
import { LocaleTagSchema, SiteLocaleSchema } from "../site-locales.js";
import { PublishedSnapshotV1Schema } from "./catalog-snapshot.js";
import { DESCRIPTION_MAX } from "./catalog.js";
import { ALT_TEXT_MAX } from "./catalog-specs.js";

const VersionSchema = z.number().int().min(1);
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Optional plain text: missing, null or blank all mean "no value" (stored as null). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL.test(v), { message: "control_characters" })
    .nullish()
    .transform((v) => (v ? v : null));

export const CatalogLocaleParamSchema = LocaleTagSchema;

/** The SEO texts of one language (canonical path, noindex and OG image are language-neutral). */
export const ListingSeoTextsSchema = z.strictObject({
  title: z.string().nullable(),
  description: z.string().nullable(),
  ogTitle: z.string().nullable(),
  ogDescription: z.string().nullable(),
});
export type ListingSeoTexts = z.infer<typeof ListingSeoTextsSchema>;

export const EMPTY_LISTING_SEO_TEXTS: ListingSeoTexts = {
  title: null,
  description: null,
  ogTitle: null,
  ogDescription: null,
};

/** ML-8b: the two parts of a listing text a translator checks against the source separately. */
export const LISTING_TEXT_SECTIONS = ["texts", "seo"] as const;
export const ListingTextSectionSchema = z.enum(LISTING_TEXT_SECTIONS);
export type ListingTextSection = z.infer<typeof ListingTextSectionSchema>;

/**
 * Saves the listing texts of one language; `version` is the listing version (409 stale). Every
 * field is written (send the current values of a part you do not edit). ML-8b: `sections` names
 * the parts this save was checked against today's default-language source ("texts": title,
 * summary, description; "seo": the SEO texts); their source revision is recorded, which clears
 * OUTDATED. Default: both (the behaviour of before ML-8b).
 */
export const ListingTranslationUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  sections: z
    .array(ListingTextSectionSchema)
    .max(2)
    .default(["texts", "seo"])
    .transform((v) => [...new Set(v)]),
  title: optionalText(200),
  summary: optionalText(500),
  description: optionalText(DESCRIPTION_MAX),
  seo: z
    .strictObject({
      title: optionalText(SEO_TEXT_LIMITS.title.max),
      description: optionalText(SEO_TEXT_LIMITS.description.max),
      ogTitle: optionalText(SEO_TEXT_LIMITS.ogTitle.max),
      ogDescription: optionalText(SEO_TEXT_LIMITS.ogDescription.max),
    })
    .default({ title: null, description: null, ogTitle: null, ogDescription: null }),
});
export type ListingTranslationUpdateRequest = z.input<typeof ListingTranslationUpdateRequestSchema>;

export const CategoryTranslationUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  /** null removes the translation (not for the default language). */
  name: optionalText(120),
  description: optionalText(1000),
});
export type CategoryTranslationUpdateRequest = z.input<
  typeof CategoryTranslationUpdateRequestSchema
>;

export const SpecDefinitionTranslationUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  /** null removes the translation (not for the default language). */
  name: optionalText(120),
});
export type SpecDefinitionTranslationUpdateRequest = z.input<
  typeof SpecDefinitionTranslationUpdateRequestSchema
>;

export const ImageTranslationUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  /** null removes the alt text of this language. */
  altText: optionalText(ALT_TEXT_MAX),
});
export type ImageTranslationUpdateRequest = z.input<typeof ImageTranslationUpdateRequestSchema>;

// --- ML-8b: translation states ------------------------------------------------------------------

export const TRANSLATION_STATES = ["MISSING", "DRAFT", "PUBLISHED", "OUTDATED"] as const;
export const TranslationStateSchema = z.enum(TRANSLATION_STATES);
export type TranslationState = z.infer<typeof TranslationStateSchema>;

export const TRANSLATION_STATE_LABELS: Readonly<Record<TranslationState, string>> = {
  MISSING: "Missing",
  DRAFT: "Draft",
  PUBLISHED: "Published",
  OUTDATED: "Outdated",
};

export interface TranslationStateInput {
  /** The unit has a text in this language. */
  hasValue: boolean;
  /** The default language has a text for the unit (something to translate). */
  hasSource: boolean;
  /** This is the site's default language (the source itself). */
  isDefault: boolean;
  /** The source changed since the translation was saved (never for the default language). */
  sourceChanged: boolean;
  /** The live publication carries exactly this text in this language. */
  live: boolean;
}

/**
 * The state of one text unit in one language, or null when there is nothing to translate (no
 * source text and no translation, e.g. an image without an alt text in either language).
 */
export function translationState(i: TranslationStateInput): TranslationState | null {
  if (!i.hasValue) return i.hasSource || i.isDefault ? "MISSING" : null;
  if (!i.isDefault && i.sourceChanged) return "OUTDATED";
  return i.live ? "PUBLISHED" : "DRAFT";
}

/** The state of several units together: the most urgent one (OUTDATED, MISSING, DRAFT). */
export function combinedTranslationState(
  states: readonly (TranslationState | null)[],
): TranslationState | null {
  const set = new Set(states.filter((s): s is TranslationState => s !== null));
  for (const s of ["OUTDATED", "MISSING", "DRAFT", "PUBLISHED"] as const) if (set.has(s)) return s;
  return null;
}

/**
 * What a language needs before a publication may carry it (ADR-028 §5: shown only when complete):
 * an own listing text, the category name and every specification name. Missing alt texts and
 * SEO texts are listed (`missing`) but do not block.
 */
export type RequiredTranslation = "listing" | "category" | `spec:${string}`;

/**
 * DP-257: the languages whose sensitive-claim word list (catalog-workflow.ts SENSITIVE_CLAIMS) is
 * reviewed. The list is English; it also finds acronyms and names in other languages (SAF, USP,
 * NSF, CTL, OEM, ...), but a Dutch text can make a claim in Dutch words it does not know, so a
 * language outside this list is never treated as checked: the publisher confirms a manual check
 * (`PublishRequest.manualReview`) until a reviewed word list exists (DP-252).
 */
export const CLAIM_SCAN_LOCALES: readonly string[] = ["en"];
export const ClaimScanSchema = z.enum(["AUTOMATIC", "MANUAL"]);
export type ClaimScan = z.infer<typeof ClaimScanSchema>;
export const claimScanOf = (locale: string): ClaimScan =>
  CLAIM_SCAN_LOCALES.includes(locale) ? "AUTOMATIC" : "MANUAL";

/** One text unit in the requested language next to the default language's text. */
const pair = <T extends z.ZodType>(t: T) =>
  z.strictObject({ value: t.nullable(), source: t.nullable() });
const StateSchema = TranslationStateSchema.nullable();

export const ProductTranslationsResponseSchema = z.strictObject({
  productId: UuidSchema,
  siteId: UuidSchema,
  locale: LocaleTagSchema,
  defaultLocale: LocaleTagSchema,
  /** The language is enabled on the site (texts may be saved). */
  enabled: z.boolean(),
  /** ML-8b: the language is shown to visitors (SiteLocale.public; BV "nl": false). */
  public: z.boolean(),
  /** ML-8b: the site's languages (the console's language tabs), default first. */
  locales: z.array(SiteLocaleSchema).max(20),
  /** ML-8b: the product is live on the site, and its live snapshot has texts in this language. */
  live: z.strictObject({ published: z.boolean(), hasLocale: z.boolean() }),
  /** ML-8b: what blocks this language in a publication (empty: it may be published). */
  requiredMissing: z.array(z.string()).max(600),
  /**
   * ML-8b: every field that has a default-language text but none here ("title", "seo.title",
   * "category.name", "spec:<key>", "image:<id>", ...).
   */
  missing: z.array(z.string()).max(1200),
  listing: z
    .strictObject({
      id: UuidSchema,
      version: z.number().int(),
      /** A listing text row exists in this language. */
      hasText: z.boolean(),
      /** ML-8b: state of title, summary and description together, and of the SEO texts. */
      state: StateSchema,
      seoState: StateSchema,
      /**
       * ML-8b: the source of title, summary or description is the shared product text (the site
       * has no own default-language text for it and falls back, as its page does).
       */
      sharedSource: z.strictObject({
        title: z.boolean(),
        summary: z.boolean(),
        description: z.boolean(),
      }),
      title: pair(z.string()),
      summary: pair(z.string()),
      description: pair(z.string()),
      seo: z.strictObject({
        title: pair(z.string()),
        description: pair(z.string()),
        ogTitle: pair(z.string()),
        ogDescription: pair(z.string()),
      }),
    })
    .nullable(),
  category: z
    .strictObject({
      id: UuidSchema,
      version: z.number().int(),
      state: StateSchema,
      name: pair(z.string()),
      description: pair(z.string()),
    })
    .nullable(),
  specs: z
    .array(
      z.strictObject({
        definitionId: UuidSchema,
        key: z.string(),
        version: z.number().int(),
        state: StateSchema,
        name: pair(z.string()),
      }),
    )
    .max(500),
  images: z
    .array(
      z.strictObject({
        id: UuidSchema,
        version: z.number().int(),
        isPublic: z.boolean(),
        /** ML-8b: for the console's label (never published). */
        originalFilename: z.string(),
        state: StateSchema,
        altText: pair(z.string()),
      }),
    )
    .max(100),
});
export type ProductTranslationsResponse = z.infer<typeof ProductTranslationsResponseSchema>;

/** ML-8b: `GET /sites/:siteId/categories/translations?locale` (product:read of the site). */
export const CategoryTranslationListResponseSchema = z.strictObject({
  siteId: UuidSchema,
  locale: LocaleTagSchema,
  defaultLocale: LocaleTagSchema,
  /** The site's languages (the page's language tabs), default first. */
  locales: z.array(SiteLocaleSchema).max(20),
  enabled: z.boolean(),
  /** product:edit of the site (texts may be saved). */
  canEdit: z.boolean(),
  items: z
    .array(
      z.strictObject({
        id: UuidSchema,
        slug: z.string(),
        parentId: UuidSchema.nullable(),
        version: z.number().int(),
        /** Live products of the site in this category (their snapshots carry the name). */
        liveProducts: z.number().int(),
        state: StateSchema,
        name: pair(z.string()),
        description: pair(z.string()),
      }),
    )
    .max(1000),
});
export type CategoryTranslationListResponse = z.infer<typeof CategoryTranslationListResponseSchema>;

/**
 * ML-8b: `GET /spec-definitions/translations?locale` (who may read the definitions; the language
 * enabled on one of the caller's sites). The source is English, the language of the platform-wide
 * names (ML-8a).
 */
export const SpecDefinitionTranslationListResponseSchema = z.strictObject({
  locale: LocaleTagSchema,
  sourceLocale: LocaleTagSchema,
  /** The languages enabled on at least one of the caller's sites (source first). */
  locales: z.array(LocaleTagSchema).max(20),
  enabled: z.boolean(),
  /** product_master:edit (names may be saved). */
  canEdit: z.boolean(),
  items: z
    .array(
      z.strictObject({
        id: UuidSchema,
        key: z.string(),
        archived: z.boolean(),
        version: z.number().int(),
        /** Live publications (sites the caller may read) that show this specification. */
        liveProducts: z.number().int(),
        state: StateSchema,
        name: pair(z.string()),
      }),
    )
    .max(1000),
});
export type SpecDefinitionTranslationListResponse = z.infer<
  typeof SpecDefinitionTranslationListResponseSchema
>;

/**
 * ML-8b (DP-257): `GET /products/:id/sites/:siteId/publication-preview?locale` — the product in
 * ONE language as the next publication would carry it if that language is chosen (`next`), next
 * to what is live in that language (`live`). Admin only (product:read of the site); nothing is
 * written. `next` is null when the language could not be shown (`requiredMissing`).
 */
export const PublicationPreviewResponseSchema = z.strictObject({
  productId: UuidSchema,
  siteId: UuidSchema,
  locale: LocaleTagSchema,
  defaultLocale: LocaleTagSchema,
  public: z.boolean(),
  next: PublishedSnapshotV1Schema.nullable(),
  live: PublishedSnapshotV1Schema.nullable(),
  requiredMissing: z.array(z.string()).max(600),
  missing: z.array(z.string()).max(1200),
  /** Sensitive wording found in this language's text (the English word list, see `claimScan`). */
  claims: z.array(z.strictObject({ key: z.string(), label: z.string() })).max(50),
  /**
   * AUTOMATIC: the language has a reviewed sensitive-claim word list. MANUAL: it has none yet
   * (DP-252), so the publisher must check the text by hand before publishing it.
   */
  claimScan: ClaimScanSchema,
});
export type PublicationPreviewResponse = z.infer<typeof PublicationPreviewResponseSchema>;

export const CategoryTranslationResponseSchema = z.strictObject({
  categoryId: UuidSchema,
  locale: LocaleTagSchema,
  version: z.number().int(),
  name: z.string().nullable(),
  description: z.string().nullable(),
});
export type CategoryTranslationResponse = z.infer<typeof CategoryTranslationResponseSchema>;

export const SpecDefinitionTranslationResponseSchema = z.strictObject({
  definitionId: UuidSchema,
  locale: LocaleTagSchema,
  version: z.number().int(),
  name: z.string().nullable(),
});
export type SpecDefinitionTranslationResponse = z.infer<
  typeof SpecDefinitionTranslationResponseSchema
>;

export const ImageTranslationResponseSchema = z.strictObject({
  imageId: UuidSchema,
  locale: LocaleTagSchema,
  version: z.number().int(),
  altText: z.string().nullable(),
});
export type ImageTranslationResponse = z.infer<typeof ImageTranslationResponseSchema>;

export const ListingTranslationResponseSchema = z.strictObject({
  listingId: UuidSchema,
  siteId: UuidSchema,
  locale: LocaleTagSchema,
  version: z.number().int(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  seo: ListingSeoTextsSchema,
});
export type ListingTranslationResponse = z.infer<typeof ListingTranslationResponseSchema>;
