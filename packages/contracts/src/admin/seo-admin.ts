/**
 * DP-209: SEO administration of the BV site (ADR-024 D6). The admin "SEO" section and the API
 * share these contracts.
 *
 *  - Site defaults: the `bv.site-seo` CMS fragment (cms-bv.ts); drafted, published and restored
 *    through the existing CMS routes, so nothing here stores them a second time.
 *  - CMS pages and articles: the SEO fields of the page draft (cms.ts `CmsSeoSchema`), published
 *    with the page as part of its revision.
 *  - Products: the SEO of the product's listing on a site, saved with
 *    `POST /api/v1/admin/catalog/products/:id/listings/:siteId/seo` (`product:edit` of the site).
 *    A save is a listing change (listing version + 1, audited), so it reaches the site only with
 *    the next publication of the product, exactly like the listing texts (PM-3 snapshot).
 *  - `GET /api/v1/admin/seo/sites/:siteId/overview[?part=settings]`: pages, articles and products
 *    of the site with their SEO state, for the overview list (`part=settings`: the defaults only,
 *    for the editors' previews) (`content:read` and/or `product:read` of the site; the
 *    caller sees only the parts it may read). Read only: every row opens the existing editor.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import {
  ProductSeoSchema,
  PublicSiteSeoSettingsSchema,
  SEO_PATH_KINDS,
  SEO_TEXT_LIMITS,
  SeoCanonicalPathSchema,
} from "../seo.js";

export const ADMIN_SEO_API = "/api/v1/admin/seo";

const IsoDate = z.iso.datetime({ offset: true });
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

// --- product SEO (listing) -----------------------------------------------------------------------

/** The SEO fields of a product listing as an editor saves them. */
export const ListingSeoInputSchema = z.strictObject({
  title: optionalText(SEO_TEXT_LIMITS.title.max),
  description: optionalText(SEO_TEXT_LIMITS.description.max),
  ogTitle: optionalText(SEO_TEXT_LIMITS.ogTitle.max),
  ogDescription: optionalText(SEO_TEXT_LIMITS.ogDescription.max),
  canonicalPath: SeoCanonicalPathSchema.optional().transform((v) => v ?? null),
  noindex: z.boolean(),
  /** One of the product's images (checked by the API); null: the cover, then the site default. */
  ogImageId: UuidSchema.nullish().transform((v) => v ?? null),
});
export type ListingSeoInput = z.input<typeof ListingSeoInputSchema>;

/** Saves the listing's SEO; `version` is the listing version it was based on (409 when stale). */
export const ListingSeoUpdateRequestSchema = ListingSeoInputSchema.extend({
  version: VersionSchema,
});
export type ListingSeoUpdateRequest = z.input<typeof ListingSeoUpdateRequestSchema>;

export const ListingSeoResponseSchema = z.strictObject({
  listingId: UuidSchema,
  siteId: UuidSchema,
  version: z.number().int(),
  seo: ProductSeoSchema,
  updatedAt: IsoDate,
});
export type ListingSeoResponse = z.infer<typeof ListingSeoResponseSchema>;

// --- overview ------------------------------------------------------------------------------------

/** The SEO state of one page, article or product (its draft, and whether that is live). */
export const SeoOverviewItemSchema = z.strictObject({
  /** CMS page id or product id. */
  id: UuidSchema,
  source: z.enum(["cms", "product"]),
  kind: z.enum(SEO_PATH_KINDS),
  name: z.string(),
  /** The address on the site ("/about-us", "/products/x"). */
  path: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  ogTitle: z.string().nullable(),
  ogDescription: z.string().nullable(),
  hasOgImage: z.boolean(),
  canonicalPath: z.string().nullable(),
  noindex: z.boolean(),
  /** Published (CMS) or live (product: published and listed) on the site now. */
  live: z.boolean(),
  /** The saved draft (CMS) or listing (product) differs from what the site shows. */
  pendingChanges: z.boolean(),
  /** In the sitemap now: live, without noindex, its own canonical (from the published state). */
  inSitemap: z.boolean(),
});
export type SeoOverviewItem = z.infer<typeof SeoOverviewItemSchema>;

export const SeoOverviewResponseSchema = z.strictObject({
  site: z.strictObject({ id: UuidSchema, key: z.enum(["BV", "CORPORATE"]), name: z.string() }),
  /** What the caller may do; the API checks again on every change. */
  permissions: z.strictObject({
    readPages: z.boolean(),
    editPages: z.boolean(),
    publishPages: z.boolean(),
    readProducts: z.boolean(),
    editProducts: z.boolean(),
  }),
  /** The `bv.site-seo` fragment: null until it is imported into the CMS. */
  settings: z
    .strictObject({
      pageId: UuidSchema,
      version: z.number().int(),
      published: z.boolean(),
      pendingChanges: z.boolean(),
      /** The saved draft (the editor shows it); validated against the fragment's fields. */
      draft: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  /**
   * The published defaults the site uses now (`bv.site-seo`), or null while unpublished: the
   * previews of the page and product editors apply them as the site does.
   */
  liveSettings: PublicSiteSeoSettingsSchema.nullable(),
  items: z.array(SeoOverviewItemSchema).max(2000),
});
export type SeoOverviewResponse = z.infer<typeof SeoOverviewResponseSchema>;
