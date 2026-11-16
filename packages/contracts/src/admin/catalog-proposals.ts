/**
 * Content proposals (DP-171, ADR-022): research-drafted listing text for one product on one site,
 * reviewed by the company before anyone applies it. Shared by the API, the admin console and the
 * proposal import tool.
 *
 *   REVIEW_PENDING --approve--> APPROVED
 *        |  ^   \--request changes (comment required)--> CHANGES_REQUESTED
 *        |  +------------- revise (any content change) ------------+
 *
 *  - Creating and revising need `product:edit` of the site; the writer becomes an author of the
 *    revision.
 *  - Deciding (approve, request changes) needs `product_proposal:review` of the site, and the
 *    reviewer may not be an author of the revision (separation of duties; also a trigger).
 *  - Every change names the version it was based on (stale -> 409).
 *
 * A proposal is a layer of its own: it never writes to the product, its listing, texts,
 * specifications, images, documents or publications. An APPROVED proposal is neither a technical
 * approval (PM-3) nor a publication; applying it to the listing is a separate, later step.
 *
 * Customer-facing text (summary, description) and internal review data are separate fields.
 * Review notes ("[CONFIRM ...]"), held DP-002 values, inconsistencies and claim risks live in
 * `reviewData` only and never reach a public site.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import { REVIEW_COMMENT_MAX } from "./catalog-workflow.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const PROPOSAL_STATUSES = ["REVIEW_PENDING", "CHANGES_REQUESTED", "APPROVED"] as const;
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const PROPOSAL_ACTIONS = ["CREATED", "REVISED", "APPROVED", "CHANGES_REQUESTED"] as const;
export const ProposalActionSchema = z.enum(PROPOSAL_ACTIONS);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

/** Same limits as the listing texts the proposal is meant for (ProductListingText). */
export const PROPOSAL_SUMMARY_MAX = 500;
export const PROPOSAL_DESCRIPTION_MAX = 8000;

/** Internal markers that must never appear in customer-facing text. */
const REVIEW_MARKER = /\[confirm/i;

const customerText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !REVIEW_MARKER.test(v), {
      message: "review notes ([CONFIRM ...]) belong in reviewData, not in customer text",
    })
    .nullable();

// --- internal review data --------------------------------------------------------------------

/**
 * What a review item is about:
 *  - CONFIRM: a question for the company (wording, packaging, grade meaning, ...);
 *  - INCONSISTENCY: current site data and research disagree (e.g. a measured VI outside the class);
 *  - DP002_HELD: a technical value withheld at import (DP-002); never a product value;
 *  - SITE_VALUE_WITHHELD: a row the current site shows that the import left out (no test method
 *    or temperature); current-site data, shown as such, never a verified product value;
 *  - CLASS_CONFLICT: the product's class label is not supported by its data or sources;
 *  - CLAIM_RISK: wording that would need a certificate (pharmaceutical, cosmetic, SAF, CTL, ...);
 *  - MISSING_DOCUMENT: an original TDS, SDS or COA that does not exist yet;
 *  - PLACEHOLDER: the product itself is not defined well enough to describe.
 */
export const REVIEW_ITEM_KINDS = [
  "CONFIRM",
  "INCONSISTENCY",
  "DP002_HELD",
  "SITE_VALUE_WITHHELD",
  "CLASS_CONFLICT",
  "CLAIM_RISK",
  "MISSING_DOCUMENT",
  "PLACEHOLDER",
] as const;
export const ReviewItemKindSchema = z.enum(REVIEW_ITEM_KINDS);
export type ReviewItemKind = z.infer<typeof ReviewItemKindSchema>;

const Short = (max: number) => z.string().trim().min(1).max(max);

/**
 * A value withheld under DP-002 or left out at import, exactly as the source page gave it (never
 * normalised here).
 */
export const HeldValueSchema = z.strictObject({
  definition: Short(64),
  basis: z.enum(["SPECIFICATION", "TYPICAL"]),
  /** The source row as printed: property, limit, unit, method. */
  raw: Short(400),
  /** The page (or the research) shows a conflict for this value. */
  conflict: z.boolean(),
  finding: Short(1000).nullable(),
});
export type HeldValue = z.infer<typeof HeldValueSchema>;

export const ReviewItemSchema = z.strictObject({
  kind: ReviewItemKindSchema,
  /** The field the item is about, e.g. "summary", "spec:viscosity_index", "name", "documents". */
  field: Short(80).nullable(),
  text: Short(2000),
  /** Ids into `sources` below. */
  sourceIds: z.array(Short(40)).max(20),
  heldValue: HeldValueSchema.nullable(),
  /**
   * DP-172: the first 16 hex digits of the SHA-256 of the Turkish research text this item was
   * translated from (key prefix in docs/catalog/proposals/review-translations.en.json); absent
   * when the item was written in English. Short on purpose: a proposal must fit one 16 KiB request.
   */
  originRef: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const SOURCE_LEVELS = ["A", "B", "C", "D", "E"] as const;

export const ReviewSourceSchema = z.strictObject({
  id: Short(40),
  title: Short(300),
  url: z.string().trim().max(1000).nullable(),
  /** A own manufacturer document, B standard, C other producer, D Dream site summary, E trader. */
  level: z.enum(SOURCE_LEVELS).nullable(),
  documentDate: z.string().trim().max(120).nullable(),
});
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

export const REVIEW_LANGUAGES = ["en", "tr"] as const;

export const ProposalReviewDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** DP-172: language of the review texts; English for the company review. */
  language: z.enum(REVIEW_LANGUAGES).optional(),
  /** Research family, e.g. "Group II base oil". */
  family: Short(120).nullable(),
  items: z.array(ReviewItemSchema).max(200),
  sources: z.array(ReviewSourceSchema).max(100),
});
export type ProposalReviewData = z.infer<typeof ProposalReviewDataSchema>;

// --- requests --------------------------------------------------------------------------------

const OptionalComment = z
  .string()
  .trim()
  .max(REVIEW_COMMENT_MAX)
  .nullish()
  .transform((v) => (v ? v : null));

export const SourceRefSchema = Short(200);

/** Start a proposal for one product on the site (one per product, site and locale). */
export const CreateProposalRequestSchema = z.strictObject({
  productId: UuidSchema,
  locale: z.literal("en"),
  summary: customerText(PROPOSAL_SUMMARY_MAX),
  description: customerText(PROPOSAL_DESCRIPTION_MAX),
  reviewData: ProposalReviewDataSchema,
  sourceRef: SourceRefSchema,
  sourceSha256: Sha256,
});
export type CreateProposalRequest = z.input<typeof CreateProposalRequestSchema>;

/**
 * A new revision: returns the proposal to REVIEW_PENDING as version + 1.
 *
 * DP-191: every content field is optional. A field that is left out keeps its current value, so
 * the admin editor sends only the text it changed and stays far below the 16 KiB request limit
 * (the review data alone can take 15 KB). That is not the same as `null`: a `null` summary or
 * description clears that text, while `null` review data, source reference or source hash is
 * refused like any other invalid value. The import tool still sends the full body.
 */
export const ReviseProposalRequestSchema = z.strictObject({
  version: VersionSchema,
  summary: customerText(PROPOSAL_SUMMARY_MAX).optional(),
  description: customerText(PROPOSAL_DESCRIPTION_MAX).optional(),
  reviewData: ProposalReviewDataSchema.optional(),
  sourceRef: SourceRefSchema.optional(),
  sourceSha256: Sha256.optional(),
  comment: OptionalComment,
});
export type ReviseProposalRequest = z.input<typeof ReviseProposalRequestSchema>;

export const ApproveProposalRequestSchema = z.strictObject({
  version: VersionSchema,
  comment: OptionalComment,
});
export type ApproveProposalRequest = z.input<typeof ApproveProposalRequestSchema>;

/** Requesting changes always says what to change. */
export const RequestProposalChangesRequestSchema = z.strictObject({
  version: VersionSchema,
  comment: z.string().trim().min(3).max(REVIEW_COMMENT_MAX),
});
export type RequestProposalChangesRequest = z.input<typeof RequestProposalChangesRequestSchema>;

// --- responses -------------------------------------------------------------------------------

const ActorSchema = z.strictObject({ id: UuidSchema, name: z.string() });

export const ProposalEventSchema = z.strictObject({
  id: UuidSchema,
  action: ProposalActionSchema,
  proposalVersion: z.number().int(),
  actor: ActorSchema,
  comment: z.string().nullable(),
  contentSha256: Sha256,
  /**
   * DP-191: the proposed text of this version, kept with the event so that earlier texts are not
   * lost. `textRecorded` is false only for events written before DP-191 whose text could not be
   * verified against `contentSha256`; their text is unknown (never guessed), and `summary` and
   * `description` are then null.
   */
  textRecorded: z.boolean(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: IsoDate,
});
export type ProposalEvent = z.infer<typeof ProposalEventSchema>;

/** Counts per review item kind, for list badges. */
export const ReviewItemCountsSchema = z.record(ReviewItemKindSchema, z.number().int().min(0));

export const ProposalSummarySchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  productId: UuidSchema,
  productCode: z.string(),
  productName: z.string(),
  locale: z.string(),
  status: ProposalStatusSchema,
  version: z.number().int(),
  hasText: z.boolean(),
  itemCounts: ReviewItemCountsSchema,
  updatedAt: IsoDate,
});
export type ProposalSummary = z.infer<typeof ProposalSummarySchema>;

export const ProposalListResponseSchema = z.strictObject({
  proposals: z.array(ProposalSummarySchema),
  counts: z.record(ProposalStatusSchema, z.number().int().min(0)),
});
export type ProposalListResponse = z.infer<typeof ProposalListResponseSchema>;

export const PROPOSAL_DECISION_BLOCKS = ["no_permission", "not_in_review", "own_change"] as const;

export const ProposalResponseSchema = z.strictObject({
  proposal: z.strictObject({
    id: UuidSchema,
    siteId: UuidSchema,
    productId: UuidSchema,
    productCode: z.string(),
    productName: z.string(),
    locale: z.string(),
    summary: z.string().nullable(),
    description: z.string().nullable(),
    reviewData: ProposalReviewDataSchema,
    sourceRef: z.string(),
    sourceSha256: Sha256,
    status: ProposalStatusSchema,
    version: z.number().int(),
    authors: z.array(ActorSchema),
    decidedAt: IsoDate.nullable(),
    decidedBy: ActorSchema.nullable(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
  }),
  events: z.array(ProposalEventSchema),
  canRevise: z.boolean(),
  canDecide: z.boolean(),
  /** Why the caller cannot decide right now (null when canDecide). */
  decisionBlocked: z.enum(PROPOSAL_DECISION_BLOCKS).nullable(),
});
export type ProposalResponse = z.infer<typeof ProposalResponseSchema>;

/**
 * DP-172: what the signed-in user may do with proposals, per site. `reviewOnly` is true when the
 * user's permissions are limited to reading products and reviewing proposals (the company
 * reviewer): the console then shows only the company review.
 */
export const ProposalContextResponseSchema = z.strictObject({
  sites: z.array(
    z.strictObject({
      id: UuidSchema,
      key: z.enum(["BV", "CORPORATE"]),
      name: z.string(),
      canRead: z.boolean(),
      canReview: z.boolean(),
      canRevise: z.boolean(),
    }),
  ),
  reviewOnly: z.boolean(),
});
export type ProposalContextResponse = z.infer<typeof ProposalContextResponseSchema>;

/** Permissions a company reviewer holds; anything beyond them means a full console. */
export const REVIEW_ONLY_PERMISSIONS: readonly string[] = [
  "product:read",
  "product_proposal:review",
];

/** SHA-256 input of a proposal's text: summary and description, NUL-separated (null -> empty). */
export function proposalContentKey(summary: string | null, description: string | null): string {
  return `${summary ?? ""}\u0000${description ?? ""}`;
}

// --- import dataset (DP-171 tool) ------------------------------------------------------------

export const ProposalDatasetEntrySchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
  summary: customerText(PROPOSAL_SUMMARY_MAX),
  description: customerText(PROPOSAL_DESCRIPTION_MAX),
  reviewData: ProposalReviewDataSchema,
});
export type ProposalDatasetEntry = z.infer<typeof ProposalDatasetEntrySchema>;

/** The research proposal dataset (docs/catalog/proposals/*.json). */
export const ProposalDatasetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    dp: z.literal("DP-171"),
    site: z.enum(["BV", "CORPORATE"]),
    locale: z.literal("en"),
    sourceRef: SourceRefSchema,
    generatedAt: IsoDate,
    proposals: z.array(ProposalDatasetEntrySchema).min(1).max(1000),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    for (const [i, p] of d.proposals.entries()) {
      if (seen.has(p.code)) {
        ctx.addIssue({ code: "custom", path: ["proposals", i, "code"], message: "duplicate code" });
      }
      seen.add(p.code);
    }
  });
export type ProposalDataset = z.infer<typeof ProposalDatasetSchema>;
