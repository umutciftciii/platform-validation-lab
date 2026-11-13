/**
 * CMS S2 (DP-017, DP-134; ADR-020 D6/D7): drafts of designed pages, import from code, preview,
 * publication and the public read model.
 *
 * - Publishing copies the current draft into an immutable revision and points the page's single
 *   publication at it (PUBLISHED). Unpublishing keeps the revision and marks the publication
 *   UNPUBLISHED. Republishing publishes the current draft again as a new revision. The public
 *   sites read only the published revision: a draft never reaches them, and a page that is not
 *   published is not shown at all (no fallback to the content in code).
 * - A preview link is short-lived, bound to one page and one site, and signed by the API; the site
 *   renders the current draft with it (noindex, no cache).
 * - Import creates a designed page or fragment from the content that was in code, as a draft;
 *   it never overwrites (409 when the page exists).
 */
import { z } from "zod";
import { CmsSeoSchema } from "./cms.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

export const PUBLIC_CMS_API = "/api/v1/public/cms";

/** Saves the draft of a DESIGN page or fragment; its fields are validated by its template. */
export const CmsFixedDraftRequestSchema = z.strictObject({
  version: VersionSchema,
  title: z.string().trim().min(1).max(200),
  seo: CmsSeoSchema,
  content: z.record(z.string(), z.unknown()),
});
export type CmsFixedDraftRequest = z.input<typeof CmsFixedDraftRequestSchema>;

/** Publishes the draft version the publisher looked at (409 if it changed meanwhile). */
export const CmsPublishRequestSchema = z.strictObject({ version: VersionSchema });
export type CmsPublishRequest = z.infer<typeof CmsPublishRequestSchema>;

export const CmsUnpublishRequestSchema = z.strictObject({ publicationVersion: VersionSchema });
export type CmsUnpublishRequest = z.infer<typeof CmsUnpublishRequestSchema>;

export const CmsPreviewResponseSchema = z.object({ url: z.url(), expiresAt: IsoDate });
export type CmsPreviewResponse = z.infer<typeof CmsPreviewResponseSchema>;

export const CmsImportRequestSchema = z.strictObject({
  key: z.string().regex(/^(bv|corporate)\.[a-z0-9]+(-[a-z0-9]+)*$/),
  dryRun: z.boolean(),
});
export type CmsImportRequest = z.infer<typeof CmsImportRequestSchema>;

export const CmsImportResponseSchema = z.object({
  key: z.string(),
  dryRun: z.boolean(),
  /** Top-level fields and list sizes of the content to import (what the dry run checked). */
  summary: z.array(z.object({ field: z.string(), items: z.number().int().nullable() })),
  pageId: z.string().nullable(),
});
export type CmsImportResponse = z.infer<typeof CmsImportResponseSchema>;

// --- public read model ------------------------------------------------------------------------

export const CmsPublicPageSchema = z.object({
  kind: z.enum(["DESIGN", "TEMPLATE", "FRAGMENT"]),
  templateKey: z.string(),
  path: z.string().nullable(),
  title: z.string(),
  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    noindex: z.boolean(),
  }),
  content: z.record(z.string(), z.unknown()),
  /** null in a preview (the draft has no revision yet). */
  revisionNumber: z.number().int().nullable(),
  publishedAt: IsoDate.nullable(),
});
export type CmsPublicPage = z.infer<typeof CmsPublicPageSchema>;

/** A page with the site-wide fragments around it; a missing fragment is not shown. */
export const CmsPublicBundleSchema = z.object({
  page: CmsPublicPageSchema,
  fragments: z.record(z.string(), CmsPublicPageSchema.nullable()),
  preview: z.boolean(),
});
export type CmsPublicBundle = z.infer<typeof CmsPublicBundleSchema>;
