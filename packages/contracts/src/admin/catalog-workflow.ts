/**
 * Product review, approval and publication (PM-3: DP-068), shared by the API, the admin console
 * and the public sites.
 *
 * Workflow of the platform-wide product master:
 *
 *   DRAFT --submit--> IN_REVIEW --approve--> APPROVED
 *     ^                  |  \--request changes / withdraw--> DRAFT
 *     +--- any content change while IN_REVIEW or APPROVED (review reset) ---+
 *
 *  - Submitting and withdrawing need `product_master:edit` (PLATFORM).
 *  - Review decisions (approve, request changes) need `product:approve` platform-wide, and the
 *    reviewer may not have changed the content since the last approval, nor submitted it
 *    (separation of duties; also enforced by a database trigger).
 *  - Every transition names the master `version` it was based on (stale -> 409).
 *
 * Publication is per site and independent between sites (BV and Corporate): `product:publish`
 * of that site, an APPROVED master, a visible listing and no BLOCKING issue. Publishing stores
 * an immutable snapshot of the approved content with the master and listing versions, so the
 * live site never shows unapproved edits, and the published version stays traceable.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import {
  ProductStatusSchema,
  ListingVisibilitySchema,
  type ListingVisibility,
  type ProductStatus,
} from "./catalog.js";
import {
  ProductValidationSchema,
  SpecValueBasisSchema,
  SpecValueDataSchema,
  type ProductValidation,
  type ValidationIssue,
} from "./catalog-specs.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

export const REVIEW_COMMENT_MAX = 2000;
const OptionalComment = z
  .string()
  .trim()
  .max(REVIEW_COMMENT_MAX)
  .nullish()
  .transform((v) => (v ? v : null));

// --- requests --------------------------------------------------------------------------------

/** Submit for review, optionally with a note for the reviewer. */
export const SubmitReviewRequestSchema = z.strictObject({
  version: VersionSchema,
  comment: OptionalComment,
});
export type SubmitReviewRequest = z.input<typeof SubmitReviewRequestSchema>;

/** Take a submitted master back to DRAFT (the editor, before a decision). */
export const WithdrawReviewRequestSchema = z.strictObject({ version: VersionSchema });
export type WithdrawReviewRequest = z.input<typeof WithdrawReviewRequestSchema>;

export const ApproveRequestSchema = z.strictObject({
  version: VersionSchema,
  comment: OptionalComment,
});
export type ApproveRequest = z.input<typeof ApproveRequestSchema>;

/** Requesting changes always states why (the editor sees it in the history). */
export const RequestChangesRequestSchema = z.strictObject({
  version: VersionSchema,
  comment: z.string().trim().min(3).max(REVIEW_COMMENT_MAX),
});
export type RequestChangesRequest = z.input<typeof RequestChangesRequestSchema>;

/**
 * Publish (or republish) on one site: the master version and the listing version the publisher
 * reviewed. Either changed since -> 409 stale.
 */
export const PublishRequestSchema = z.strictObject({
  version: VersionSchema,
  listingVersion: VersionSchema,
});
export type PublishRequest = z.input<typeof PublishRequestSchema>;

/** Unpublish: the publication's own version. */
export const UnpublishRequestSchema = z.strictObject({
  version: VersionSchema,
  comment: OptionalComment,
});
export type UnpublishRequest = z.input<typeof UnpublishRequestSchema>;

// --- history -----------------------------------------------------------------------------------

export const REVIEW_ACTIONS = [
  "SUBMITTED",
  "WITHDRAWN",
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_RESET",
  "PUBLISHED",
  "UNPUBLISHED",
] as const;
export const ReviewActionSchema = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

/** A staff member as shown in the workflow: display name only, never an e-mail address. */
export const ActorSchema = z.strictObject({ id: UuidSchema, name: z.string() });
export type Actor = z.infer<typeof ActorSchema>;

export const ReviewEventSchema = z.strictObject({
  id: UuidSchema,
  action: ReviewActionSchema,
  /** Site of a publication event; null for master events. */
  siteId: UuidSchema.nullable(),
  productVersion: z.number().int(),
  actor: ActorSchema,
  comment: z.string().nullable(),
  createdAt: IsoDate,
});
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

// --- publication readiness -----------------------------------------------------------------------

export const PUBLICATION_ISSUE_CODES = [
  "not_approved",
  "archived",
  "listing_missing",
  "listing_hidden",
  "cover_missing",
  "summary_missing",
  "description_missing",
] as const;

export const PublicationIssueSchema = z.strictObject({
  severity: z.enum(["BLOCKING", "WARNING"]),
  /** A publication code above, or a validation engine code (catalog-specs.ts). */
  code: z.string(),
  target: z.string(),
  message: z.string(),
});
export type PublicationIssue = z.infer<typeof PublicationIssueSchema>;

export const PublicationReadinessSchema = z.strictObject({
  ok: z.boolean(),
  blocking: z.array(PublicationIssueSchema),
  warnings: z.array(PublicationIssueSchema),
});
export type PublicationReadiness = z.infer<typeof PublicationReadinessSchema>;

export interface ReadinessInput {
  product: {
    status: ProductStatus;
    summary: string | null;
    description: string | null;
  };
  listing: {
    visibility: ListingVisibility;
    text: { title: string | null; summary: string | null; description: string | null } | null;
  } | null;
  /** The shared validation engine's result for the master (validateProductData). */
  validation: ProductValidation;
  images: readonly { id: string; isCover: boolean; altText: string | null }[];
}

const pub = (
  severity: "BLOCKING" | "WARNING",
  code: (typeof PUBLICATION_ISSUE_CODES)[number],
  target: string,
  message: string,
): PublicationIssue => ({ severity, code, target, message });

const fromValidation = (i: ValidationIssue): PublicationIssue => ({ ...i });

/**
 * Whether a product may be published on one site. BLOCKING: the master is not APPROVED (or is
 * archived), the site has no listing or it is hidden, there is no cover image, or the validation
 * engine reports a BLOCKING issue. WARNING: every engine warning (DP-161: also "no technical
 * data"), a missing summary (DP-161: the catalogue source has none, so it is content to add, not
 * a gate) and a missing description. Used by the API to refuse, and by the console to
 * show the same list before the publisher clicks.
 */
export function checkPublication(input: ReadinessInput): PublicationReadiness {
  const blocking: PublicationIssue[] = [];
  const warnings: PublicationIssue[] = [];
  const { product, listing } = input;
  if (product.status === "ARCHIVED") {
    blocking.push(pub("BLOCKING", "archived", "product", "Archived products cannot be published."));
  } else if (product.status !== "APPROVED") {
    blocking.push(
      pub(
        "BLOCKING",
        "not_approved",
        "product",
        "The product master must be approved in its current version.",
      ),
    );
  }
  if (!listing) {
    blocking.push(
      pub("BLOCKING", "listing_missing", "listing", "The site does not list this product."),
    );
  } else if (listing.visibility !== "VISIBLE") {
    blocking.push(
      pub("BLOCKING", "listing_hidden", "listing", "The listing is hidden on this site."),
    );
  }
  if (!input.images.some((i) => i.isCover)) {
    blocking.push(pub("BLOCKING", "cover_missing", "images", "A cover image is required."));
  }
  if (!(listing?.text?.summary ?? product.summary)) {
    warnings.push(
      pub(
        "WARNING",
        "summary_missing",
        "summary",
        "No summary (listing or master): the product card and page show none.",
      ),
    );
  }
  blocking.push(...input.validation.blocking.map(fromValidation));
  warnings.push(...input.validation.warnings.map(fromValidation));
  if (!(listing?.text?.description ?? product.description)) {
    warnings.push(
      pub("WARNING", "description_missing", "description", "The product has no description."),
    );
  }
  return { ok: blocking.length === 0, blocking, warnings };
}

// --- workflow view -------------------------------------------------------------------------------

export const PUBLICATION_STATUSES = ["PUBLISHED", "UNPUBLISHED"] as const;
export const PublicationStatusSchema = z.enum(PUBLICATION_STATUSES);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const REVIEW_BLOCKED_REASONS = [
  "no_permission",
  "not_in_review",
  "own_change",
  "archived",
] as const;

export const PublicationSchema = z.strictObject({
  id: UuidSchema,
  status: PublicationStatusSchema,
  /** The master version whose snapshot is (or was) live. */
  productVersion: z.number().int(),
  listingVersion: z.number().int(),
  publishedAt: IsoDate,
  publishedBy: ActorSchema,
  unpublishedAt: IsoDate.nullable(),
  unpublishedBy: ActorSchema.nullable(),
  version: z.number().int(),
});
export type Publication = z.infer<typeof PublicationSchema>;

export const SitePublicationSchema = z.strictObject({
  siteId: UuidSchema,
  siteKey: z.enum(["BV", "CORPORATE"]),
  siteName: z.string(),
  /** product:publish on this site. */
  canPublish: z.boolean(),
  listing: z
    .strictObject({ version: z.number().int(), visibility: ListingVisibilitySchema })
    .nullable(),
  publication: PublicationSchema.nullable(),
  /** The live snapshot is older than the current master or listing. */
  outdated: z.strictObject({ master: z.boolean(), listing: z.boolean() }),
  readiness: PublicationReadinessSchema,
});
export type SitePublication = z.infer<typeof SitePublicationSchema>;

export const ProductWorkflowResponseSchema = z.strictObject({
  productId: UuidSchema,
  status: ProductStatusSchema,
  version: z.number().int(),
  submittedAt: IsoDate.nullable(),
  submittedBy: ActorSchema.nullable(),
  submittedVersion: z.number().int().nullable(),
  approvedAt: IsoDate.nullable(),
  approvedBy: ActorSchema.nullable(),
  approvedVersion: z.number().int().nullable(),
  permissions: z.strictObject({
    canSubmit: z.boolean(),
    canWithdraw: z.boolean(),
    canReview: z.boolean(),
    /** Why a reviewer cannot decide now; null when canReview. */
    reviewBlockedReason: z.enum(REVIEW_BLOCKED_REASONS).nullable(),
  }),
  validation: ProductValidationSchema,
  /** Newest first; publication events only for sites the caller may read. */
  history: z.array(ReviewEventSchema).max(200),
  /** One entry per site the caller may read. */
  sites: z.array(SitePublicationSchema).max(20),
});
export type ProductWorkflowResponse = z.infer<typeof ProductWorkflowResponseSchema>;

export const ReviewQueueItemSchema = z.strictObject({
  productId: UuidSchema,
  code: z.string(),
  name: z.string(),
  version: z.number().int(),
  submittedAt: IsoDate,
  submittedBy: ActorSchema.nullable(),
  comment: z.string().nullable(),
  blockingCount: z.number().int(),
  warningCount: z.number().int(),
  canReview: z.boolean(),
  reviewBlockedReason: z.enum(REVIEW_BLOCKED_REASONS).nullable(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;

export const ReviewQueueResponseSchema = z.strictObject({
  items: z.array(ReviewQueueItemSchema).max(100),
  total: z.number().int(),
  /** product:approve platform-wide (the caller is a reviewer). */
  canApprove: z.boolean(),
});
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponseSchema>;

// --- public content (the live sites) -------------------------------------------------------------

/**
 * The published content of one product on one site, frozen at publication. Only approved,
 * public fields: no ids of staff, no storage keys, file names, hashes or original images.
 */
export const PublishedSnapshotSchema = z.strictObject({
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
});
export type PublishedSnapshot = z.infer<typeof PublishedSnapshotSchema>;

export const PUBLIC_CATALOG_API = "/api/v1/public/catalog";
/** Public image variants: never the original upload. */
export const PUBLIC_IMAGE_VARIANTS = ["display", "thumb"] as const;
export type PublicImageVariant = (typeof PUBLIC_IMAGE_VARIANTS)[number];

export const PublicImageSchema = z.strictObject({
  id: UuidSchema,
  altText: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
});
export type PublicImage = z.infer<typeof PublicImageSchema>;

export const PublicProductSummarySchema = z.strictObject({
  slug: z.string(),
  code: z.string(),
  name: z.string(),
  /** DP-161: null when the product has no summary (no longer required for publication). */
  summary: z.string().nullable(),
  category: z.strictObject({ slug: z.string(), name: z.string() }),
  cover: PublicImageSchema.nullable(),
  publishedAt: IsoDate,
});
export type PublicProductSummary = z.infer<typeof PublicProductSummarySchema>;

/**
 * DP-160: a category of the public catalogue tree. Only categories with live products in them or
 * below them are listed; `count` includes the products of the sub-categories. The category of a
 * product is the one its published snapshot names.
 */
export const PublicCategorySchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
  parentSlug: z.string().nullable(),
  sortOrder: z.number().int(),
  count: z.number().int().min(1),
});
export type PublicCategory = z.infer<typeof PublicCategorySchema>;

export const PublicCategoryListResponseSchema = z.strictObject({
  items: z.array(PublicCategorySchema).max(1000),
});
export type PublicCategoryListResponse = z.infer<typeof PublicCategoryListResponseSchema>;

export const PublicProductListResponseSchema = z.strictObject({
  items: z.array(PublicProductSummarySchema).max(500),
});
export type PublicProductListResponse = z.infer<typeof PublicProductListResponseSchema>;

export const PublicProductSchema = PublicProductSummarySchema.extend({
  description: z.string().nullable(),
  specs: PublishedSnapshotSchema.shape.specs,
  images: z.array(PublicImageSchema).max(100),
});
export type PublicProduct = z.infer<typeof PublicProductSchema>;

export const PublicProductResponseSchema = z.strictObject({ product: PublicProductSchema });
export type PublicProductResponse = z.infer<typeof PublicProductResponseSchema>;

/** The public view of a snapshot (cover first in `images`, as the gallery shows it). */
export function toPublicProduct(s: PublishedSnapshot, publishedAt: string): PublicProduct {
  const img = (i: PublishedSnapshot["images"][number]): PublicImage => ({
    id: i.id,
    altText: i.altText,
    width: i.width,
    height: i.height,
  });
  const cover = s.images.find((i) => i.isCover) ?? null;
  return {
    slug: s.slug,
    code: s.code,
    name: s.name,
    summary: s.summary,
    category: s.category,
    cover: cover ? img(cover) : null,
    publishedAt,
    description: s.description,
    specs: s.specs,
    images: [...(cover ? [cover] : []), ...s.images.filter((i) => !i.isCover)].map(img),
  };
}

export function toPublicSummary(s: PublishedSnapshot, publishedAt: string): PublicProductSummary {
  const p = toPublicProduct(s, publishedAt);
  return {
    slug: p.slug,
    code: p.code,
    name: p.name,
    summary: p.summary,
    category: p.category,
    cover: p.cover,
    publishedAt: p.publishedAt,
  };
}
