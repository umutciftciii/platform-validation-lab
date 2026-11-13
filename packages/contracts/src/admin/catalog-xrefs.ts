/**
 * Global brands, global products and product cross-references (PM-6, DP-036; ADR-015). The
 * admin console, the API and the public sites share these contracts.
 *
 * - Global brands and their products (other manufacturers' products, with grade) are
 *   platform-wide reference data: `product_master:edit` (PLATFORM) changes them, staff with
 *   `product:read` on any site read them. They are archived, never deleted.
 * - A cross-reference links one of our product masters to one global product:
 *     SIMILAR               staff judgement, no documented equivalence;
 *     PENDING_VERIFICATION  an editor asked for verification, naming the evidence (the active
 *                           revision of a PM-5 technical document of the same product) and a
 *                           technical comparison;
 *     VERIFIED              a second person with `product:approve` (PLATFORM) who neither edited
 *                           nor requested it confirmed it (separation of duties);
 *     REMOVED               withdrawn; kept with its history, never shown.
 *   Any content change returns a request or a verification to SIMILAR.
 * - A verification records what it was based on: the source revision, the product's
 *   specification fingerprint and the global product's version. If any of them changes, the
 *   verification is `stale`: the admin asks for a new verification and the public sites stop
 *   showing the relation (it is never silently downgraded or kept as VERIFIED).
 * - A site shows a cross-reference only when that site's publisher (`product:publish`) enabled
 *   it, the product is live there (PM-3) and the relation holds. The public sites receive brand,
 *   manufacturer, product, grade and the relation level only: never the staff texts, and the
 *   platform never writes an equivalence claim of its own.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

export const GLOBAL_BRAND_NAME_MAX = 120;
export const GLOBAL_MANUFACTURER_MAX = 200;
export const GLOBAL_PRODUCT_NAME_MAX = 200;
export const GLOBAL_GRADE_MAX = 120;
export const GLOBAL_NOTES_MAX = 2000;
export const XREF_DESCRIPTION_MAX = 2000;
export const XREF_COMPARISON_MAX = 8000;
export const XREF_COMMENT_MAX = 2000;
export const XREFS_PER_PRODUCT_MAX = 100;
export const GLOBAL_SEARCH_LIMIT = 50;
export const XREF_HISTORY_MAX = 100;

/** The stored comparison key of a name: trimmed, whitespace collapsed, lower case. */
export function globalNameKey(name: string, grade?: string | null): string {
  const raw = grade ? `${name} | ${grade}` : name;
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const commentText = optionalText(XREF_COMMENT_MAX);
const requiredComment = z.string().trim().min(1).max(XREF_COMMENT_MAX);

export const GLOBAL_CATALOG_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const GlobalCatalogStatusSchema = z.enum(GLOBAL_CATALOG_STATUSES);
export type GlobalCatalogStatus = z.infer<typeof GlobalCatalogStatusSchema>;

// --- global brands --------------------------------------------------------------------------

export const GlobalBrandInputSchema = z.strictObject({
  name: requiredText(GLOBAL_BRAND_NAME_MAX),
  manufacturer: requiredText(GLOBAL_MANUFACTURER_MAX),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .nullish()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: optionalText(GLOBAL_NOTES_MAX),
});
export const GlobalBrandCreateRequestSchema = GlobalBrandInputSchema;
export type GlobalBrandCreateRequest = z.input<typeof GlobalBrandCreateRequestSchema>;
export const GlobalBrandUpdateRequestSchema = GlobalBrandInputSchema.extend({
  version: VersionSchema,
});
export type GlobalBrandUpdateRequest = z.input<typeof GlobalBrandUpdateRequestSchema>;
/** Archive and restore name the version they were based on. */
export const GlobalStateRequestSchema = z.strictObject({ version: VersionSchema });

export const GlobalBrandSchema = z.strictObject({
  id: UuidSchema,
  name: z.string(),
  manufacturer: z.string(),
  country: z.string().nullable(),
  notes: z.string().nullable(),
  status: GlobalCatalogStatusSchema,
  version: z.number().int(),
  productCount: z.number().int(),
  archivedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type GlobalBrand = z.infer<typeof GlobalBrandSchema>;

export const GlobalBrandListResponseSchema = z.strictObject({
  items: z.array(GlobalBrandSchema).max(GLOBAL_SEARCH_LIMIT),
  /** product_master:edit: may create, change and archive brands and global products. */
  canEdit: z.boolean(),
});
export type GlobalBrandListResponse = z.infer<typeof GlobalBrandListResponseSchema>;
export const GlobalBrandResponseSchema = z.strictObject({ brand: GlobalBrandSchema });
export type GlobalBrandResponse = z.infer<typeof GlobalBrandResponseSchema>;

// --- global products ------------------------------------------------------------------------

export const GlobalProductInputSchema = z.strictObject({
  name: requiredText(GLOBAL_PRODUCT_NAME_MAX),
  grade: optionalText(GLOBAL_GRADE_MAX),
  description: optionalText(GLOBAL_NOTES_MAX),
});
export const GlobalProductCreateRequestSchema = GlobalProductInputSchema;
export type GlobalProductCreateRequest = z.input<typeof GlobalProductCreateRequestSchema>;
export const GlobalProductUpdateRequestSchema = GlobalProductInputSchema.extend({
  version: VersionSchema,
});
export type GlobalProductUpdateRequest = z.input<typeof GlobalProductUpdateRequestSchema>;

export const GlobalBrandRefSchema = z.strictObject({
  id: UuidSchema,
  name: z.string(),
  manufacturer: z.string(),
  status: GlobalCatalogStatusSchema,
});
export type GlobalBrandRef = z.infer<typeof GlobalBrandRefSchema>;

export const GlobalProductSchema = z.strictObject({
  id: UuidSchema,
  brand: GlobalBrandRefSchema,
  name: z.string(),
  grade: z.string().nullable(),
  description: z.string().nullable(),
  status: GlobalCatalogStatusSchema,
  version: z.number().int(),
  archivedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type GlobalProduct = z.infer<typeof GlobalProductSchema>;

export const GlobalProductListResponseSchema = z.strictObject({
  items: z.array(GlobalProductSchema).max(GLOBAL_SEARCH_LIMIT),
  canEdit: z.boolean(),
});
export type GlobalProductListResponse = z.infer<typeof GlobalProductListResponseSchema>;
export const GlobalProductResponseSchema = z.strictObject({ product: GlobalProductSchema });
export type GlobalProductResponse = z.infer<typeof GlobalProductResponseSchema>;

// --- cross-references -----------------------------------------------------------------------

export const CROSS_REFERENCE_STATUSES = [
  "SIMILAR",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REMOVED",
] as const;
export const CrossReferenceStatusSchema = z.enum(CROSS_REFERENCE_STATUSES);
export type CrossReferenceStatus = z.infer<typeof CrossReferenceStatusSchema>;

export const CROSS_REFERENCE_STATUS_LABELS: Readonly<Record<CrossReferenceStatus, string>> = {
  SIMILAR: "Similar",
  PENDING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  REMOVED: "Removed",
};

export const CROSS_REFERENCE_ACTIONS = [
  "CREATED",
  "UPDATED",
  "VERIFICATION_REQUESTED",
  "VERIFIED",
  "VERIFICATION_REJECTED",
  "MARKED_SIMILAR",
  "VERIFICATION_RESET",
  "REMOVED",
  "RESTORED",
] as const;
export const CrossReferenceActionSchema = z.enum(CROSS_REFERENCE_ACTIONS);
export type CrossReferenceAction = z.infer<typeof CrossReferenceActionSchema>;

export const CrossReferenceCreateRequestSchema = z.strictObject({
  globalProductId: UuidSchema,
  description: optionalText(XREF_DESCRIPTION_MAX),
  comparison: optionalText(XREF_COMPARISON_MAX),
});
export type CrossReferenceCreateRequest = z.input<typeof CrossReferenceCreateRequestSchema>;
/** A content change of a pending or verified relation makes it SIMILAR again. */
export const CrossReferenceUpdateRequestSchema = z.strictObject({
  description: optionalText(XREF_DESCRIPTION_MAX),
  comparison: optionalText(XREF_COMPARISON_MAX),
  version: VersionSchema,
});
export type CrossReferenceUpdateRequest = z.input<typeof CrossReferenceUpdateRequestSchema>;
/** Names the evidence: the active revision of a technical document of the same product. */
export const CrossReferenceRequestVerificationSchema = z.strictObject({
  sourceRevisionId: UuidSchema,
  comment: commentText,
  version: VersionSchema,
});
export type CrossReferenceRequestVerification = z.input<
  typeof CrossReferenceRequestVerificationSchema
>;
export const CrossReferenceVerifyRequestSchema = z.strictObject({
  comment: commentText,
  version: VersionSchema,
});
/** Reject a request, downgrade to SIMILAR, or remove: a reason is required. */
export const CrossReferenceReasonRequestSchema = z.strictObject({
  comment: requiredComment,
  version: VersionSchema,
});
export const CrossReferenceStateRequestSchema = z.strictObject({ version: VersionSchema });
// --- publication responsibility (DP-091, owner decision 2026-11-11) -------------------------

/**
 * Publishing third-party brand and product names is Dream Petroleum BV's commercial
 * responsibility (no mandatory external legal review). Before a site shows a cross-reference,
 * its publisher confirms this statement; the API refuses a show without it and audits the
 * version, the time and the user. A new wording gets a new version.
 */
export const XREF_PUBLICATION_ACK_VERSION = "DP-091/2026-11-11";
export const XREF_PUBLICATION_ACK_TEXT =
  "I confirm, on behalf of Dream Petroleum BV, that this cross-reference names third-party brands and products only to identify and compare products; that it implies no partnership, affiliation, endorsement or manufacturer approval; that a similar product is shown as similar and never as a verified equivalent; that a verified relation rests on the recorded technical evidence and approval; and that no claim of exact equivalence or superior performance is made.";

export const CrossReferenceAcknowledgementSchema = z.strictObject({
  version: z.literal(XREF_PUBLICATION_ACK_VERSION),
  accepted: z.literal(true),
});
export type CrossReferenceAcknowledgement = z.infer<typeof CrossReferenceAcknowledgementSchema>;

/** Showing needs the publisher's acknowledgement of the current statement; hiding does not. */
export const CrossReferenceSiteRequestSchema = z
  .strictObject({
    visible: z.boolean(),
    version: VersionSchema,
    acknowledgement: CrossReferenceAcknowledgementSchema.optional(),
  })
  .refine((v) => !v.visible || v.acknowledgement !== undefined, {
    path: ["acknowledgement"],
    message: "required",
  });
export type CrossReferenceSiteRequest = z.infer<typeof CrossReferenceSiteRequestSchema>;

/** Why a verification no longer holds (it is then `stale`). */
export const VERIFICATION_STALE_REASONS = [
  "source_revision_replaced",
  "source_document_archived",
  "specs_changed",
  "global_product_changed",
  "global_product_archived",
] as const;
export const VerificationStaleReasonSchema = z.enum(VERIFICATION_STALE_REASONS);
export type VerificationStaleReason = z.infer<typeof VerificationStaleReasonSchema>;

export const VERIFICATION_STALE_TEXT: Readonly<Record<VerificationStaleReason, string>> = {
  source_revision_replaced: "The source document has a newer active revision.",
  source_document_archived: "The source document was archived.",
  specs_changed: "Our product's specifications changed after the verification.",
  global_product_changed: "The global product changed after the verification.",
  global_product_archived: "The global product or its brand is archived.",
};

export const VERIFICATION_STATES = ["none", "pending", "current", "stale"] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

const UserRef = z.strictObject({ id: UuidSchema, name: z.string() });

export const CrossReferenceVerificationSchema = z.strictObject({
  state: z.enum(VERIFICATION_STATES),
  staleReasons: z.array(VerificationStaleReasonSchema),
  source: z
    .strictObject({
      documentId: UuidSchema,
      documentTitle: z.string(),
      documentType: z.enum(["TDS", "SDS", "COA", "OTHER"]),
      revisionId: UuidSchema,
      revisionNumber: z.number().int(),
      /** The named revision is still the document's active revision. */
      isActiveRevision: z.boolean(),
    })
    .nullable(),
  requestedBy: UserRef.nullable(),
  requestedAt: IsoDate.nullable(),
  verifiedBy: UserRef.nullable(),
  verifiedAt: IsoDate.nullable(),
});
export type CrossReferenceVerification = z.infer<typeof CrossReferenceVerificationSchema>;

/** The effective state of a cross-reference on one site; `shown` only when every rule holds. */
export const CROSS_REFERENCE_SITE_STATES = [
  "shown",
  "hidden",
  "not_publishable",
  "verification_stale",
  "product_not_live",
] as const;
export type CrossReferenceSiteState = (typeof CROSS_REFERENCE_SITE_STATES)[number];

export const CrossReferenceSiteSchema = z.strictObject({
  siteId: UuidSchema,
  siteKey: z.enum(["BV", "CORPORATE"]),
  enabled: z.boolean(),
  state: z.enum(CROSS_REFERENCE_SITE_STATES),
  /** What the site shows right now (null when nothing). */
  shownAs: z.enum(["SIMILAR", "VERIFIED"]).nullable(),
  canPublish: z.boolean(),
});
export type CrossReferenceSite = z.infer<typeof CrossReferenceSiteSchema>;

export const CrossReferenceEventSchema = z.strictObject({
  id: UuidSchema,
  action: CrossReferenceActionSchema,
  fromStatus: CrossReferenceStatusSchema.nullable(),
  toStatus: CrossReferenceStatusSchema,
  version: z.number().int(),
  actor: UserRef,
  comment: z.string().nullable(),
  sourceRevisionId: UuidSchema.nullable(),
  createdAt: IsoDate,
});
export type CrossReferenceEvent = z.infer<typeof CrossReferenceEventSchema>;

export const ProductCrossReferenceSchema = z.strictObject({
  id: UuidSchema,
  productId: UuidSchema,
  globalProduct: GlobalProductSchema,
  status: CrossReferenceStatusSchema,
  description: z.string().nullable(),
  comparison: z.string().nullable(),
  version: z.number().int(),
  verification: CrossReferenceVerificationSchema,
  /** The caller may verify or reject now (approver, not an editor or the requester). */
  canVerify: z.boolean(),
  /** Why the caller may not verify (when a request is pending). */
  verifyBlockedReason: z.enum(["no_permission", "own_change"]).nullable(),
  sites: z.array(CrossReferenceSiteSchema).max(10),
  events: z.array(CrossReferenceEventSchema).max(XREF_HISTORY_MAX),
  removedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ProductCrossReference = z.infer<typeof ProductCrossReferenceSchema>;

export const ProductCrossReferenceListResponseSchema = z.strictObject({
  items: z.array(ProductCrossReferenceSchema).max(XREFS_PER_PRODUCT_MAX),
  canEdit: z.boolean(),
  /** product:approve (PLATFORM). */
  canApprove: z.boolean(),
});
export type ProductCrossReferenceListResponse = z.infer<
  typeof ProductCrossReferenceListResponseSchema
>;
export const ProductCrossReferenceResponseSchema = z.strictObject({
  crossReference: ProductCrossReferenceSchema,
});
export type ProductCrossReferenceResponse = z.infer<typeof ProductCrossReferenceResponseSchema>;

// --- public sites ---------------------------------------------------------------------------

/**
 * The fixed explanation a public site shows under its cross-references (DP-091, rule 6), in
 * English. The relation labels are fixed too; the API never sends claim text.
 */
export const XREF_PUBLIC_LABELS = {
  SIMILAR: "Comparable product, not a verified equivalent",
  VERIFIED: "Checked against technical documentation",
} as const;

export function xrefPublicNotice(company: string): string {
  return (
    `Third-party brand and product names are trademarks of their respective owners and are used ` +
    `only to identify and compare products. ${company} is not affiliated with, endorsed by or ` +
    `approved by these owners or manufacturers. "Similar" means comparable for the same ` +
    `applications, not a verified equivalent. "Verified" means ${company} checked the relation ` +
    `against technical documentation on the date shown; it is not a manufacturer approval and no ` +
    `claim of exact equivalence or superior performance is made. Check the technical data sheet ` +
    `and the equipment manufacturer's requirements before substituting a product.`
  );
}

/**
 * What a public site may show. No staff texts and no generated claims: the site renders the
 * relation level with its own fixed wording (see web-bv).
 */
export const PublicCrossReferenceSchema = z.strictObject({
  id: UuidSchema,
  brand: z.string(),
  manufacturer: z.string(),
  product: z.string(),
  grade: z.string().nullable(),
  relation: z.enum(["SIMILAR", "VERIFIED"]),
  /** Date of the verification (VERIFIED only). */
  verifiedAt: IsoDate.nullable(),
});
export type PublicCrossReference = z.infer<typeof PublicCrossReferenceSchema>;

export const PublicCrossReferenceListResponseSchema = z.strictObject({
  items: z.array(PublicCrossReferenceSchema).max(XREFS_PER_PRODUCT_MAX),
});
export type PublicCrossReferenceListResponse = z.infer<
  typeof PublicCrossReferenceListResponseSchema
>;
