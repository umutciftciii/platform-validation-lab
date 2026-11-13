/**
 * Technical document contracts (PM-5, DP-035): TDS, SDS, COA and other PDFs of a product master.
 * The admin console, the API and the public sites share them. Access model: ADR-014.
 *
 * - A document belongs to the platform-wide product master. Its metadata and files change with
 *   `product_master:edit` (PLATFORM); staff with `product:read` on any site read and preview it.
 * - The file is a chain of immutable revisions (1, 2, 3, ...). Exactly one revision is active;
 *   a new upload becomes the active revision, an older one can be made active again. Revisions
 *   are never edited or deleted. Archiving freezes a document; restoring it is the only change.
 * - Access policy (private by default): INTERNAL never leaves the admin. PUBLIC is downloadable
 *   on a site. LEAD_REQUIRED is requested with a short form and delivered with a short-lived grant
 *   and a watermark (DP-042, DP-043; ADR-016). MEMBERS_ONLY is listed but NOT downloadable until
 *   membership (DP-039) exists.
 * - A site shows a document only when that site's publisher (`product:publish`) enabled it AND
 *   the product is live there (PM-3: published, listing visible, master not archived).
 * - DP-086 (ADR-014 D5): the site serves the revision its publisher pinned, not simply the active
 *   one. A new active revision reaches a site only when that site's publisher confirms it; BV and
 *   Corporate may serve different revisions. Documents are not part of the PM-3 review.
 * - Uploads: one raw PDF body (`application/pdf`, at most 20 MB) per request; the API checks the
 *   real content (signature, structure, no encryption, no active content).
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

export const DOCUMENT_TYPES = ["TDS", "SDS", "COA", "OTHER"] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  TDS: "Technical data sheet",
  SDS: "Safety data sheet",
  COA: "Certificate of analysis",
  OTHER: "Other document",
};

export const DOCUMENT_ACCESS_POLICIES = [
  "PUBLIC",
  "MEMBERS_ONLY",
  "LEAD_REQUIRED",
  "INTERNAL",
] as const;
export const DocumentAccessPolicySchema = z.enum(DOCUMENT_ACCESS_POLICIES);
export type DocumentAccessPolicy = z.infer<typeof DocumentAccessPolicySchema>;

export const DOCUMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DOCUMENT_MIME_TYPE = "application/pdf";
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const DOCUMENTS_PER_PRODUCT_MAX = 50;
export const REVISIONS_PER_DOCUMENT_MAX = 100;
export const DOCUMENT_TITLE_MAX = 200;
export const DOCUMENT_DESCRIPTION_MAX = 2000;
export const REVISION_NOTE_MAX = 1000;
/** Header carrying the percent-encoded change note of a new revision (optional). */
export const REVISION_NOTE_HEADER = "x-dp-revision-note";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const DocumentInputSchema = z.strictObject({
  type: DocumentTypeSchema,
  title: z.string().trim().min(1).max(DOCUMENT_TITLE_MAX),
  description: optionalText(DOCUMENT_DESCRIPTION_MAX),
  accessPolicy: DocumentAccessPolicySchema.default("INTERNAL"),
});
export const DocumentCreateRequestSchema = DocumentInputSchema;
export type DocumentCreateRequest = z.input<typeof DocumentCreateRequestSchema>;
export const DocumentUpdateRequestSchema = DocumentInputSchema.extend({
  accessPolicy: DocumentAccessPolicySchema,
  version: VersionSchema,
});
export type DocumentUpdateRequest = z.input<typeof DocumentUpdateRequestSchema>;
/** Archive, restore and activate name the document version they were based on. */
export const DocumentStateRequestSchema = z.strictObject({ version: VersionSchema });
/**
 * Shows, hides or re-pins a document on one site (DP-086). Showing names the revision the
 * publisher confirms; it must be the active revision. Sending `visible: true` with another
 * revision on an already shown document moves the pin (the explicit approval of a new revision).
 */
export const DocumentSiteRequestSchema = z
  .strictObject({
    visible: z.boolean(),
    version: VersionSchema,
    revisionId: UuidSchema.optional(),
  })
  .refine((v) => !v.visible || v.revisionId !== undefined, {
    path: ["revisionId"],
    message: "required",
  });
export type DocumentSiteRequest = z.infer<typeof DocumentSiteRequestSchema>;

export const DocumentRevisionSchema = z.strictObject({
  id: UuidSchema,
  documentId: UuidSchema,
  revisionNumber: z.number().int(),
  isActive: z.boolean(),
  mimeType: z.literal(DOCUMENT_MIME_TYPE),
  byteSize: z.number().int(),
  sha256: z.string(),
  originalFilename: z.string(),
  pageCount: z.number().int().nullable(),
  pdfVersion: z.string().nullable(),
  changeNote: z.string().nullable(),
  uploadedBy: z.strictObject({ id: UuidSchema, displayName: z.string().nullable() }),
  createdAt: IsoDate,
});
export type DocumentRevision = z.infer<typeof DocumentRevisionSchema>;

/** Why a site does (not) serve a document right now; `served` only when every rule holds. */
export const DOCUMENT_SITE_STATES = [
  "served",
  /** DP-042 (ADR-016): LEAD_REQUIRED, delivered after the short form with a grant and watermark. */
  "served_on_request",
  "hidden",
  "internal",
  "archived",
  "no_file",
  "product_not_live",
  "awaiting_membership",
  "awaiting_lead_capture",
] as const;
export const DocumentSiteStateSchema = z.enum(DOCUMENT_SITE_STATES);
export type DocumentSiteState = z.infer<typeof DocumentSiteStateSchema>;

export const DocumentSiteSchema = z.strictObject({
  siteId: UuidSchema,
  siteKey: z.enum(["BV", "CORPORATE"]),
  /** The site's publisher enabled the document. */
  enabled: z.boolean(),
  /**
   * DP-086: the revision this site serves (pinned by its publisher), null when not enabled. A new
   * upload or another active revision never changes it.
   */
  pinnedRevision: z
    .strictObject({ id: UuidSchema, revisionNumber: z.number().int(), pinnedAt: IsoDate })
    .nullable(),
  /** Enabled, and the active revision is not the pinned one: waits for the publisher. */
  updateAvailable: z.boolean(),
  /** The effective state on the public site (also listed when not downloadable). */
  state: DocumentSiteStateSchema,
  /** product:publish on this site: may enable or disable it. */
  canPublish: z.boolean(),
});
export type DocumentSite = z.infer<typeof DocumentSiteSchema>;

export const ProductDocumentSchema = z.strictObject({
  id: UuidSchema,
  productId: UuidSchema,
  type: DocumentTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  accessPolicy: DocumentAccessPolicySchema,
  status: DocumentStatusSchema,
  version: z.number().int(),
  revisionCount: z.number().int(),
  activeRevision: DocumentRevisionSchema.nullable(),
  revisions: z.array(DocumentRevisionSchema).max(REVISIONS_PER_DOCUMENT_MAX),
  sites: z.array(DocumentSiteSchema).max(10),
  archivedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ProductDocument = z.infer<typeof ProductDocumentSchema>;

export const ProductDocumentListResponseSchema = z.strictObject({
  items: z.array(ProductDocumentSchema).max(DOCUMENTS_PER_PRODUCT_MAX),
  /** product_master:edit: may create, change, upload and archive. */
  canEdit: z.boolean(),
});
export type ProductDocumentListResponse = z.infer<typeof ProductDocumentListResponseSchema>;
export const ProductDocumentResponseSchema = z.strictObject({ document: ProductDocumentSchema });
export type ProductDocumentResponse = z.infer<typeof ProductDocumentResponseSchema>;

/** Admin download routes: `inline` opens the browser's viewer (preview), `attachment` saves. */
export const DOCUMENT_DISPOSITIONS = ["inline", "attachment"] as const;
export type DocumentDisposition = (typeof DOCUMENT_DISPOSITIONS)[number];

// --- public sites ---------------------------------------------------------------------------

export const PublicDocumentSchema = z.strictObject({
  id: UuidSchema,
  type: DocumentTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  access: z.enum(["PUBLIC", "MEMBERS_ONLY", "LEAD_REQUIRED"]),
  /** Downloadable without anything else: PUBLIC only (fail-closed, ADR-014). */
  downloadable: z.boolean(),
  /**
   * DP-042 (ADR-016): available after the short request form (LEAD_REQUIRED). MEMBERS_ONLY is
   * neither downloadable nor requestable until DP-039.
   */
  requestable: z.boolean(),
  revisionNumber: z.number().int(),
  byteSize: z.number().int(),
  pageCount: z.number().int().nullable(),
  updatedAt: IsoDate,
});
export type PublicDocument = z.infer<typeof PublicDocumentSchema>;

export const PublicDocumentListResponseSchema = z.strictObject({
  items: z.array(PublicDocumentSchema).max(DOCUMENTS_PER_PRODUCT_MAX),
});
export type PublicDocumentListResponse = z.infer<typeof PublicDocumentListResponseSchema>;
