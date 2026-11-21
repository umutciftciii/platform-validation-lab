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
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import { SEO_TEXT_LIMITS } from "../seo.js";
import { LocaleTagSchema } from "../site-locales.js";
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

/** Saves the listing texts of one language; `version` is the listing version (409 stale). */
export const ListingTranslationUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
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

/** One text unit in the requested language next to the default language's text. */
const pair = <T extends z.ZodType>(t: T) =>
  z.strictObject({ value: t.nullable(), source: t.nullable() });

export const ProductTranslationsResponseSchema = z.strictObject({
  productId: UuidSchema,
  siteId: UuidSchema,
  locale: LocaleTagSchema,
  defaultLocale: LocaleTagSchema,
  /** The language is enabled on the site (texts may be saved). */
  enabled: z.boolean(),
  listing: z
    .strictObject({
      id: UuidSchema,
      version: z.number().int(),
      /** A listing text row exists in this language (the publication will carry it). */
      hasText: z.boolean(),
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
        altText: pair(z.string()),
      }),
    )
    .max(100),
});
export type ProductTranslationsResponse = z.infer<typeof ProductTranslationsResponseSchema>;

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
