/**
 * DP-173 (ADR-022 D5): the company catalogue preview of the BV site. Shared by the API, the admin
 * console (issuing the link) and the BV site (rendering the preview in the catalogue design).
 *
 *  - A preview link is short-lived and signed; it names the BV site and the staff session that
 *    issued it (never the session token). On every preview request the API checks that this
 *    session is still live and that its user still holds `product_proposal:review` or (DP-204)
 *    `product:publish` on BV.
 *  - The preview is read-only: products of the site's listings (published or not, never
 *    archived) with their CURRENT data, the research proposal kept apart, and the held/withheld
 *    values in a block of their own, never as specifications. No documents, no cross-references,
 *    no lead form, no publication.
 *  - Responses are never cached and never indexed.
 */
import { z } from "zod";
import { ProposalStatusSchema } from "./catalog-proposals.js";
import {
  PublicCategorySchema,
  PublicProductSchema,
  PublicProductSummarySchema,
} from "./catalog-workflow.js";

const IsoDate = z.iso.datetime({ offset: true });

/** How long a preview link works (at most; the issuing session's idle timeout ends it earlier). */
export const CATALOG_PREVIEW_TTL_MS = 30 * 60_000;

/** The BV site's preview routes under this path: `/preview/catalog/<token>/products…`. */
export const CATALOG_PREVIEW_PATH = "/preview/catalog";

/** Public API of the preview (the BV proxy key, GET only). */
export const CATALOG_PREVIEW_API = "/api/v1/public/catalog-preview";

/** `v1.<session id>.<user id>.<site>.<expiry ms>.<HMAC>` — URL-safe, no secret inside. */
export const CatalogPreviewTokenSchema = z
  .string()
  .regex(
    /^v1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.(BV|CORPORATE)\.\d{10,13}\.[0-9a-f]{64}$/,
    "malformed preview token",
  );

export const CatalogPreviewLinkResponseSchema = z.strictObject({
  url: z.string(),
  expiresAt: IsoDate,
});
export type CatalogPreviewLinkResponse = z.infer<typeof CatalogPreviewLinkResponseSchema>;

/** A product card of the preview: the public summary of its CURRENT data, plus the review state. */
export const CatalogPreviewSummarySchema = PublicProductSummarySchema.extend({
  /** The listing is not public on the live site (draft, hidden or not published). */
  unpublished: z.boolean(),
  proposalStatus: ProposalStatusSchema.nullable(),
  hasProposalText: z.boolean(),
});
export type CatalogPreviewSummary = z.infer<typeof CatalogPreviewSummarySchema>;

export const CatalogPreviewListResponseSchema = z.strictObject({
  items: z.array(CatalogPreviewSummarySchema).max(500),
  categories: z.array(PublicCategorySchema).max(1000),
  expiresAt: IsoDate,
});
export type CatalogPreviewListResponse = z.infer<typeof CatalogPreviewListResponseSchema>;

/** A value shown on the current site that is NOT product data (DP-002 held, or withheld). */
export const CatalogPreviewHeldValueSchema = z.strictObject({
  kind: z.enum(["DP002_HELD", "SITE_VALUE_WITHHELD"]),
  raw: z.string(),
  conflict: z.boolean(),
  finding: z.string().nullable(),
});
export type CatalogPreviewHeldValue = z.infer<typeof CatalogPreviewHeldValueSchema>;

export const CatalogPreviewProductResponseSchema = z.strictObject({
  /** The product's CURRENT data in the public shape (current texts, specifications, images). */
  product: PublicProductSchema,
  unpublished: z.boolean(),
  /** The research proposal, apart from the current data; null when none exists. */
  proposal: z
    .strictObject({
      status: ProposalStatusSchema,
      version: z.number().int(),
      summary: z.string().nullable(),
      description: z.string().nullable(),
    })
    .nullable(),
  held: z.array(CatalogPreviewHeldValueSchema).max(200),
  expiresAt: IsoDate,
});
export type CatalogPreviewProductResponse = z.infer<typeof CatalogPreviewProductResponseSchema>;
