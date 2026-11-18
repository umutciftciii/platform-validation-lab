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
 *
 * DP-193 (ADR-023): a second publication mode. `APPROVED` (the default, unchanged) publishes an
 * APPROVED master. `DIRECT` publishes the CURRENT version of a DRAFT or IN_REVIEW master without a
 * technical review; it needs `product:approve` platform-wide AND `product:publish` of the site
 * (checked by the API and again by the database), never changes the master's status and is
 * recorded as such (publication row, history comment, audit action). A hidden listing may be shown
 * in the same transaction (`makeVisible`, needs `product:edit` of the site). Everything else stays:
 * archived, missing listing, stale versions, missing cover and invalid technical data block.
 *
 * DP-198 (R-29): `makeVisible` works in both modes. An APPROVED publication may show the hidden
 * listing in the same transaction as the publication (`product:edit` of the site as well), so the
 * console no longer switches the listing on with a separate request first. Publishing again what
 * is already live (same mode, same master and listing versions) is refused (`already_published`).
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import { EMPTY_PRODUCT_SEO, ProductSeoSchema } from "../seo.js";
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

/** DP-193: how a publication was authorised (see the header). */
export const PUBLICATION_MODES = ["APPROVED", "DIRECT"] as const;
export const PublicationModeSchema = z.enum(PUBLICATION_MODES);
export type PublicationMode = z.infer<typeof PublicationModeSchema>;

/**
 * Publish (or republish) on one site: the master version and the listing version the publisher
 * reviewed. Either changed since -> 409 stale. DP-193: `approvalMode` defaults to APPROVED, so
 * older clients keep their behaviour; `makeVisible` shows a hidden listing in the same
 * transaction (DP-198: in both modes; needs `product:edit` of the site).
 */
export const PublishRequestSchema = z.strictObject({
  version: VersionSchema,
  listingVersion: VersionSchema,
  approvalMode: PublicationModeSchema.default("APPROVED"),
  makeVisible: z.boolean().default(false),
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
  // DP-193 (all WARNING): direct publication without a technical review, a hidden listing the
  // direct publication shows, a research proposal the company has not approved (optional), and
  // wording that needs a certificate or source document.
  "not_reviewed",
  "listing_shown_on_publish",
  "company_review_pending",
  "sensitive_claim",
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
  /** DP-193: the mode the publisher will use; APPROVED when omitted (the PM-3 rules). */
  mode?: PublicationMode;
  /**
   * DP-193 / DP-198: the publisher may show a hidden listing in the same step (both modes;
   * product:edit of the site).
   */
  canShowListing?: boolean;
  /** DP-193: the site's research proposal (DP-171), when there is one. */
  proposal?: { status: "REVIEW_PENDING" | "CHANGES_REQUESTED" | "APPROVED" } | null;
}

/**
 * DP-193: wording that would need a certificate or a source document (ADR-022 CLAIM_RISK: SAF,
 * pharmaceutical, cosmetic, food contact, CTL, ...). Found in the public title, summary or
 * description, it is a WARNING the publisher sees before publishing; it never edits the text.
 * Acronyms match case-sensitively as whole words, phrases case-insensitively.
 */
export const SENSITIVE_CLAIMS: readonly {
  key: string;
  label: string;
  /** Phrases, any case. */
  phrases: RegExp | null;
  /** Acronyms as whole words in capitals ("saf" in ordinary words never matches). */
  acronyms: RegExp | null;
}[] = [
  {
    key: "saf",
    label: "SAF / aviation fuel",
    phrases: /sustainable aviation|aviation fuel|jet fuel/i,
    acronyms: /\bSAF\b/,
  },
  {
    key: "pharmaceutical",
    label: "pharmaceutical or pharmacopoeia grade",
    phrases: /pharmaceutical|pharma[- ]grade|pharmacopoei|\bPh\.? ?Eur\b/i,
    acronyms: /\bUSP\b/,
  },
  { key: "cosmetic", label: "cosmetic grade", phrases: /cosmetic/i, acronyms: null },
  {
    key: "food",
    label: "food grade or food contact",
    phrases: /food[- ]grade|food contact|food[- ]safe|incidental food/i,
    acronyms: /\b(?:NSF|H1|FDA)\b/,
  },
  { key: "medical", label: "medical use", phrases: /\bmedical\b|\bmedicinal\b/i, acronyms: null },
  {
    key: "ctl_gtl",
    label: "CTL / GTL origin",
    phrases: /coal[- ]to[- ]liquids?|gas[- ]to[- ]liquids?/i,
    acronyms: /\b(?:CTL|GTL)\b/,
  },
  {
    key: "certification",
    label: "certification or OEM approval",
    phrases: /\bcertified\b|\bcertificate\b|OEM approv|\bapproved by\b/i,
    acronyms: null,
  },
  {
    key: "environmental",
    label: "environmental claim",
    phrases: /biodegradable|renewable|bio[- ]based|carbon[- ]neutral|eco[- ]friendly/i,
    acronyms: null,
  },
];

/** DP-193: the sensitive claim categories found in public texts. */
export function findSensitiveClaims(
  ...texts: readonly (string | null | undefined)[]
): { key: string; label: string }[] {
  const all = texts.filter((t): t is string => !!t).join("\n");
  if (!all) return [];
  return SENSITIVE_CLAIMS.filter(
    (c) => (c.phrases?.test(all) ?? false) || (c.acronyms?.test(all) ?? false),
  ).map(({ key, label }) => ({ key, label }));
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
 *
 * DP-193, mode DIRECT: a DRAFT or IN_REVIEW master is a WARNING (`not_reviewed`) instead of
 * `not_approved`. DP-198, both modes: a hidden listing is a WARNING (`listing_shown_on_publish`)
 * when the publisher may show it, else still BLOCKING. In both modes a research proposal the company has not
 * approved (`company_review_pending`) and sensitive wording in the public text
 * (`sensitive_claim`) are WARNINGS. Archived, listing missing, cover missing and the engine's
 * BLOCKING issues block in both modes.
 */
export function checkPublication(input: ReadinessInput): PublicationReadiness {
  const blocking: PublicationIssue[] = [];
  const warnings: PublicationIssue[] = [];
  const { product, listing } = input;
  const direct = input.mode === "DIRECT";
  if (product.status === "ARCHIVED") {
    blocking.push(pub("BLOCKING", "archived", "product", "Archived products cannot be published."));
  } else if (product.status !== "APPROVED") {
    if (direct) {
      warnings.push(
        pub(
          "WARNING",
          "not_reviewed",
          "product",
          "No second person has reviewed this version (optional).",
        ),
      );
    } else {
      blocking.push(
        pub(
          "BLOCKING",
          "not_approved",
          "product",
          "The product master must be approved in its current version.",
        ),
      );
    }
  }
  if (!listing) {
    blocking.push(
      pub("BLOCKING", "listing_missing", "listing", "The site does not list this product."),
    );
  } else if (listing.visibility !== "VISIBLE") {
    if (input.canShowListing) {
      warnings.push(
        pub(
          "WARNING",
          "listing_shown_on_publish",
          "listing",
          "The listing is hidden; publishing makes it visible on this site.",
        ),
      );
    } else {
      blocking.push(
        pub("BLOCKING", "listing_hidden", "listing", "The listing is hidden on this site."),
      );
    }
  }
  if (!input.images.some((i) => i.isCover)) {
    blocking.push(pub("BLOCKING", "cover_missing", "images", "A cover image is required."));
  }
  const summary = listing?.text?.summary ?? product.summary;
  const description = listing?.text?.description ?? product.description;
  if (!summary) {
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
  if (!description) {
    warnings.push(
      pub("WARNING", "description_missing", "description", "The product has no description."),
    );
  }
  for (const claim of findSensitiveClaims(listing?.text?.title, summary, description)) {
    warnings.push(
      pub(
        "WARNING",
        "sensitive_claim",
        `text:${claim.key}`,
        `The public text mentions ${claim.label}: publish it only with a certificate or source document.`,
      ),
    );
  }
  if (input.proposal && input.proposal.status !== "APPROVED") {
    warnings.push(
      pub(
        "WARNING",
        "company_review_pending",
        "proposal",
        "The company has not reviewed this site's research proposal (optional).",
      ),
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
  /** DP-193: how the live (or last live) snapshot was authorised. */
  approvalMode: PublicationModeSchema,
  version: z.number().int(),
});
export type Publication = z.infer<typeof PublicationSchema>;

/**
 * DP-193: the site's research proposal (DP-171) as the product page uses it: its customer text
 * for "Copy the proposal into the form" and its claim-risk notes. Never the held technical
 * values (DP-002), which stay in the company review.
 */
export const SiteProposalSchema = z.strictObject({
  id: UuidSchema,
  status: z.enum(["REVIEW_PENDING", "CHANGES_REQUESTED", "APPROVED"]),
  version: z.number().int(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  /** Texts of the proposal's CLAIM_RISK review items (wording that needs a certificate). */
  claimRisks: z.array(z.string()).max(50),
});
export type SiteProposal = z.infer<typeof SiteProposalSchema>;

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
  /**
   * DP-193: the mode the console publishes with and `readiness` is checked for: DIRECT when the
   * caller may publish directly (product:approve platform-wide and product:publish here) and the
   * master is not APPROVED; APPROVED otherwise.
   */
  publishMode: PublicationModeSchema,
  /**
   * DP-193 / DP-198: Publish may show a hidden listing in the same transaction, in either mode
   * (product:publish and product:edit of this site).
   */
  canShowListing: z.boolean(),
  /**
   * DP-193: the caller may open this product in the BV catalogue preview (DP-173: BV only — the
   * preview pages exist on the BV site only; DP-204: product_proposal:review or product:publish
   * of the site).
   */
  canPreview: z.boolean(),
  /** DP-193: the site's research proposal for this product, if any. */
  proposal: SiteProposalSchema.nullable(),
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
  /**
   * DP-209: the listing's SEO at publication. Snapshots taken before DP-209 have none (the site
   * falls back to the product's own fields). Changing it takes a new publication, like the texts.
   */
  seo: ProductSeoSchema.optional(),
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

/** The fields a list entry and the product page share. */
const PublicProductBaseSchema = z.strictObject({
  slug: z.string(),
  code: z.string(),
  name: z.string(),
  /** DP-161: null when the product has no summary (no longer required for publication). */
  summary: z.string().nullable(),
  category: z.strictObject({ slug: z.string(), name: z.string() }),
  cover: PublicImageSchema.nullable(),
  publishedAt: IsoDate,
});

/**
 * One entry of the public list. DP-163: the two flags drive the card indicators and are true only
 * for content a visitor can actually reach: `hasTechnicalData` when the published snapshot holds
 * at least one value, `hasDocuments` when at least one document shown on this site can be
 * downloaded or requested (never INTERNAL, never a policy that is still closed).
 */
export const PublicProductSummarySchema = PublicProductBaseSchema.extend({
  hasTechnicalData: z.boolean(),
  hasDocuments: z.boolean(),
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

export const PublicProductSchema = PublicProductBaseSchema.extend({
  description: z.string().nullable(),
  specs: PublishedSnapshotSchema.shape.specs,
  images: z.array(PublicImageSchema).max(100),
  /** DP-209: the published SEO; `ogImageId` is always one of `images` or null. */
  seo: ProductSeoSchema.default(EMPTY_PRODUCT_SEO),
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
    seo: s.seo
      ? {
          ...s.seo,
          ogImageId: s.images.some((i) => i.id === s.seo?.ogImageId) ? s.seo.ogImageId : null,
        }
      : EMPTY_PRODUCT_SEO,
  };
}

/**
 * The list entry of a snapshot. `hasDocuments` needs the site's document rows, so the caller
 * passes it (DP-163); the technical-data flag comes from the snapshot itself.
 */
export function toPublicSummary(
  s: PublishedSnapshot,
  publishedAt: string,
  site: { hasDocuments: boolean } = { hasDocuments: false },
): PublicProductSummary {
  const p = toPublicProduct(s, publishedAt);
  return {
    slug: p.slug,
    code: p.code,
    name: p.name,
    summary: p.summary,
    category: p.category,
    cover: p.cover,
    publishedAt: p.publishedAt,
    hasTechnicalData: s.specs.length > 0,
    hasDocuments: site.hasDocuments,
  };
}
