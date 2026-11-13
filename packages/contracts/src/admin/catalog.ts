/**
 * Product catalogue administration contracts (PM-1: DP-031 product master, DP-032 site listing,
 * DP-033 categories, DP-034 search). The admin console and the API share them.
 *
 * - A product master is platform-wide; only `product_master:edit` (PLATFORM) changes it.
 * - A listing is one site's view of a product (visibility, category, the site's own English
 *   texts); `product:edit` of that site changes it. Categories belong to one site, likewise.
 * - Updates replace the whole editable record and name the `version` they were based on; a stale
 *   version answers 409 CONFLICT_STATE (`details: [{ path: "version", rule: "stale" }]`).
 * - Text inputs are trimmed; an empty optional text is stored as null.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

const IsoDate = z.iso.datetime({ offset: true });

/** Upper-case product code: letters, digits, dot, underscore, hyphen. */
export const ProductCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/);

/** Lower-case kebab-case URL slug. */
export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const requiredText = (max: number) => z.string().trim().min(1).max(max);
/** Optional text: missing, null or blank all mean "no value". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const DESCRIPTION_MAX = 8000;
export const SORT_ORDER_LIMIT = 1_000_000;
const SortOrderSchema = z.number().int().min(-SORT_ORDER_LIMIT).max(SORT_ORDER_LIMIT);
const VersionSchema = z.number().int().min(1);

/**
 * Lifecycle of a product master (PM-3): DRAFT -> IN_REVIEW -> APPROVED. A content change while
 * IN_REVIEW or APPROVED returns the master to DRAFT (the approval never silently survives an
 * edit). ARCHIVED masters cannot be reviewed or published.
 */
export const PRODUCT_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"] as const;
export const ProductStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const LISTING_VISIBILITIES = ["VISIBLE", "HIDDEN"] as const;
export const ListingVisibilitySchema = z.enum(LISTING_VISIBILITIES);
export type ListingVisibility = z.infer<typeof ListingVisibilitySchema>;

/** PM-1 manages English content only; the data model is ready for more locales. */
export const CATALOG_CONTENT_LOCALE = "en";

// --- context ---------------------------------------------------------------------------------

export const CatalogSiteSchema = z.strictObject({
  id: UuidSchema,
  key: z.enum(["BV", "CORPORATE"]),
  name: z.string().max(200),
  /** product:edit on this site: listings and categories. */
  canEdit: z.boolean(),
  /** product:publish on this site (PM-3). */
  canPublish: z.boolean(),
});
export type CatalogSite = z.infer<typeof CatalogSiteSchema>;

/** What the signed-in user may do in the catalogue. Sites are only those with product:read. */
export const CatalogContextResponseSchema = z.strictObject({
  sites: z.array(CatalogSiteSchema).max(20),
  /** product_master:edit (PLATFORM). */
  canEditMaster: z.boolean(),
  /** product:approve platform-wide (PM-3): review decisions on product masters. */
  canApprove: z.boolean(),
});
export type CatalogContextResponse = z.infer<typeof CatalogContextResponseSchema>;

// --- products --------------------------------------------------------------------------------

export const ProductMasterInputSchema = z.strictObject({
  code: ProductCodeSchema,
  slug: SlugSchema,
  name: requiredText(200),
  summary: optionalText(500),
  description: optionalText(DESCRIPTION_MAX),
});
export type ProductMasterInput = z.input<typeof ProductMasterInputSchema>;

export const ProductCreateRequestSchema = ProductMasterInputSchema;
export type ProductCreateRequest = z.input<typeof ProductCreateRequestSchema>;

export const ProductUpdateRequestSchema = ProductMasterInputSchema.extend({
  version: VersionSchema,
});
export type ProductUpdateRequest = z.input<typeof ProductUpdateRequestSchema>;

/** Archive or restore: only the version. */
export const ProductStateRequestSchema = z.strictObject({ version: VersionSchema });
export type ProductStateRequest = z.infer<typeof ProductStateRequestSchema>;

export const ProductSchema = z.strictObject({
  id: UuidSchema,
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  status: ProductStatusSchema,
  version: z.number().int(),
  archivedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Product = z.infer<typeof ProductSchema>;

export const ListingTextSchema = z.strictObject({
  title: z.string().nullable(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
});

export const ListingSchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  categoryId: UuidSchema,
  visibility: ListingVisibilitySchema,
  sortOrder: z.number().int(),
  version: z.number().int(),
  /** English texts (PM-1); null when none were entered. */
  text: ListingTextSchema.nullable(),
  updatedAt: IsoDate,
});
export type Listing = z.infer<typeof ListingSchema>;

export const ProductDetailResponseSchema = z.strictObject({
  product: ProductSchema,
  /** The listing on the requested site, or null when the site does not list the product. */
  listing: ListingSchema.nullable(),
});
export type ProductDetailResponse = z.infer<typeof ProductDetailResponseSchema>;

export const PRODUCT_SORT_FIELDS = ["name", "code", "updatedAt", "createdAt"] as const;
export const LISTING_FILTERS = ["all", "listed", "unlisted"] as const;
export const PAGE_SIZE_MAX = 100;

/** GET /products query (strings from the URL, coerced). siteId is required: the site view. */
export const ProductListQuerySchema = z.strictObject({
  siteId: UuidSchema,
  q: z.string().trim().max(100).optional(),
  status: ProductStatusSchema.optional(),
  listing: z.enum(LISTING_FILTERS).default("all"),
  visibility: ListingVisibilitySchema.optional(),
  /** Includes the category's descendants. */
  categoryId: UuidSchema.optional(),
  sort: z.enum(PRODUCT_SORT_FIELDS).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(25),
});
export type ProductListQuery = z.input<typeof ProductListQuerySchema>;

export const ProductListItemSchema = z.strictObject({
  id: UuidSchema,
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  status: ProductStatusSchema,
  version: z.number().int(),
  updatedAt: IsoDate,
  listing: z
    .strictObject({
      id: UuidSchema,
      visibility: ListingVisibilitySchema,
      categoryId: UuidSchema,
      categoryName: z.string(),
      updatedAt: IsoDate,
    })
    .nullable(),
  /** PM-3: the publication on the requested site, or null when never published there. */
  publication: z
    .strictObject({
      status: z.enum(["PUBLISHED", "UNPUBLISHED"]),
      productVersion: z.number().int(),
    })
    .nullable(),
});
export type ProductListItem = z.infer<typeof ProductListItemSchema>;

export const ProductListResponseSchema = z.strictObject({
  items: z.array(ProductListItemSchema).max(PAGE_SIZE_MAX),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;

// --- listings --------------------------------------------------------------------------------

/**
 * Create or replace the product's listing on one site. `version` is null to create; then a
 * missing categoryId means the site's default category.
 */
export const ListingUpsertRequestSchema = z.strictObject({
  version: VersionSchema.nullable(),
  categoryId: UuidSchema.nullish(),
  visibility: ListingVisibilitySchema,
  sortOrder: SortOrderSchema.default(0),
  title: optionalText(200),
  summary: optionalText(500),
  description: optionalText(DESCRIPTION_MAX),
});
export type ListingUpsertRequest = z.input<typeof ListingUpsertRequestSchema>;

export const ListingResponseSchema = z.strictObject({ listing: ListingSchema });
export type ListingResponse = z.infer<typeof ListingResponseSchema>;

// --- categories ------------------------------------------------------------------------------

export const CATEGORY_MAX_DEPTH = 3;

export const CategoryInputSchema = z.strictObject({
  name: requiredText(120),
  slug: SlugSchema,
  parentId: UuidSchema.nullable(),
  description: optionalText(1000),
  sortOrder: SortOrderSchema.default(0),
});
export type CategoryInput = z.input<typeof CategoryInputSchema>;

export const CategoryCreateRequestSchema = CategoryInputSchema;
export type CategoryCreateRequest = z.input<typeof CategoryCreateRequestSchema>;

export const CategoryUpdateRequestSchema = CategoryInputSchema.extend({ version: VersionSchema });
export type CategoryUpdateRequest = z.input<typeof CategoryUpdateRequestSchema>;

export const CategoryDefaultRequestSchema = z.strictObject({ version: VersionSchema });

export const CategorySchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  parentId: UuidSchema.nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
  version: z.number().int(),
  /** Listings directly in this category. */
  listingCount: z.number().int(),
  childCount: z.number().int(),
  updatedAt: IsoDate,
});
export type Category = z.infer<typeof CategorySchema>;

export const CategoryListResponseSchema = z.strictObject({
  items: z.array(CategorySchema).max(1000),
});
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;

export const CategoryResponseSchema = z.strictObject({ category: CategorySchema });
export type CategoryResponse = z.infer<typeof CategoryResponseSchema>;

/** Paths of the catalogue API under /api/v1/admin/catalog. */
export const CATALOG_API = "/api/v1/admin/catalog";
