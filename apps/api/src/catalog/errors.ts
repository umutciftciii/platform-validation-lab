/**
 * Database refusals of the catalogue mapped to the API error model. Unique constraints become
 * 409 CONFLICT_STATE naming the field; the tree and format guards become 400 VALIDATION_FAILED.
 * Values are never echoed (contracts errors.ts).
 */
import { ApiError } from "../iam/http/api-error.js";
import { redirectDbError } from "../seo/redirects.js";

/** Unique index name -> request field. */
const UNIQUE_FIELDS: ReadonlyArray<[string, string]> = [
  ["Product_code_key", "code"],
  ["Product_slug_key", "slug"],
  ["ProductCategory_siteId_slug_key", "slug"],
  ["ProductCategory_default_siteId_key", "isDefault"],
  ["ProductSiteListing_productId_siteId_key", "listing"],
  ["SpecDefinition_key_key", "key"],
  ["ProductSpecValue_productId_definitionId_key", "definitionId"],
  ["ProductImage_cover_productId_key", "isCover"],
  ["ProductPublication_productId_siteId_key", "publication"],
  ["ProductDocumentSite_documentId_siteId_key", "site"],
  // Two concurrent activations or uploads of one document: the loser reloads.
  ["ProductDocumentRevision_active_documentId_key", "version"],
  ["ProductDocumentRevision_documentId_revisionNumber_key", "version"],
  // PM-6 global catalogue and cross-references.
  ["GlobalBrand_nameKey_key", "name"],
  ["GlobalProduct_brandId_nameKey_key", "name"],
  ["ProductCrossReference_productId_globalProductId_key", "globalProductId"],
  ["ProductCrossReferenceSite_crossReferenceId_siteId_key", "site"],
  // DP-171: one proposal per product, site and locale.
  ["ProductContentProposal_productId_siteId_locale_key", "productId"],
];

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") parts.push(msg);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
    e = (e as { cause?: unknown }).cause;
  }
  return parts.join("\n");
}

function prismaCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Rethrows a known database refusal as an ApiError; anything else unchanged. */
export function mapDbError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const text = errorText(error);
  // DP-210: the redirect table's guards (chain, first use of a site's lock).
  const redirect = redirectDbError(text);
  if (redirect) throw redirect;
  if (prismaCode(error) === "P2002" || /unique constraint/i.test(text)) {
    const field =
      UNIQUE_FIELDS.find(([index]) => text.includes(index))?.[1] ??
      (/\bcode\b/.test(text) ? "code" : /\bslug\b/.test(text) ? "slug" : "(root)");
    throw new ApiError("CONFLICT_STATE", [{ path: field, rule: "unique" }]);
  }
  if (/catalog: a category cannot be moved below itself/.test(text)) {
    throw new ApiError("VALIDATION_FAILED", [{ path: "parentId", rule: "cycle" }]);
  }
  if (/catalog: categories have at most three levels/.test(text)) {
    throw new ApiError("VALIDATION_FAILED", [{ path: "parentId", rule: "too_deep" }]);
  }
  if (/catalog: a category parent must belong to the same site/.test(text)) {
    throw new ApiError("VALIDATION_FAILED", [{ path: "parentId", rule: "unknown_parent" }]);
  }
  // PM-3 workflow guards (migration 20261113090100_pm_3_review_publication).
  if (/catalog: separation of duties/.test(text)) {
    throw new ApiError("FORBIDDEN", [{ path: "(root)", rule: "own_change" }]);
  }
  if (/catalog: product status cannot change/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
  }
  if (/catalog: a review decision needs a product in review/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_in_review" }]);
  }
  if (/catalog: only the approved version of a product can be published/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_approved" }]);
  }
  if (/catalog: only the current visible listing can be published/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "listingVersion", rule: "stale" }]);
  }
  if (/catalog: a published product cannot be archived/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "published" }]);
  }
  if (/catalog: a published image cannot be deleted/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "image_published" }]);
  }
  // DP-166 (migration 20261201090000_dp_166_image_visibility): the cover is always public.
  if (/ProductImage_cover_public/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "isPublic", rule: "cover_cannot_be_hidden" }]);
  }
  // DP-171 proposal guards (migration 20261202090000_dp_171_content_proposals). Separation of
  // duties ("catalog: separation of duties") is mapped above with the PM-3 rule.
  if (/catalog: a decision needs a proposal in review/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_in_review" }]);
  }
  if (
    /catalog: (every proposal change increments its version|an event records the version)/.test(
      text,
    )
  ) {
    throw staleVersion();
  }
  if (
    /catalog: (a new proposal starts|the creator of a proposal|a proposal keeps|a changed proposal returns|a proposal change is either|the CREATED event)/.test(
      text,
    )
  ) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
  }
  // PM-5 document guards (migration 20261114090000_pm_5_technical_documents).
  if (/catalog: documents of an archived product cannot change/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
  }
  if (
    /catalog: (an archived document|revisions of an archived document) cannot change/.test(text)
  ) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "document_archived" }]);
  }
  if (
    /catalog: only an active, non-internal document with a file can be shown on a site/.test(text)
  ) {
    throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "not_publishable" }]);
  }
  // ML-9 document language guards (migration 20261214090000_ml_9_document_language).
  if (/catalog: the language of a document shown on a site cannot change/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "language", rule: "shown_on_site" }]);
  }
  if (/catalog: a site can only show a document in a language enabled on it/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "language", rule: "not_enabled" }]);
  }
  if (/catalog: a site can only pin the active revision of a document/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "revisionId", rule: "not_active" }]);
  }
  if (/catalog: a revision must take the next revision number/.test(text)) {
    throw staleVersion();
  }
  // PM-6 cross-reference guards (migration 20261116090000_pm_6_global_cross_references).
  if (/catalog: cross-references of an archived product cannot change/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
  }
  if (
    /catalog: (an archived global product cannot be cross-referenced|products of an archived brand cannot change)/.test(
      text,
    )
  ) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
  }
  if (/catalog: verification needs the active revision/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "sourceRevisionId", rule: "not_active" }]);
  }
  if (
    /catalog: (cross-reference status cannot change|a changed cross-reference must be verified again|a cross-reference starts as SIMILAR)/.test(
      text,
    )
  ) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
  }
  if (
    /catalog: (verification must confirm the requested source|only a pending request can be verified)/.test(
      text,
    )
  ) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_pending" }]);
  }
  if (/catalog: a removed cross-reference cannot change/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "removed" }]);
  }
  if (/catalog: only a live cross-reference of an active global product can be shown/.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "xref_not_publishable" }]);
  }
  if (prismaCode(error) === "P2003" || /foreign key constraint/i.test(text)) {
    throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "in_use" }]);
  }
  throw error;
}

export const staleVersion = () =>
  new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
