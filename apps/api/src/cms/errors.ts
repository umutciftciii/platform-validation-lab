/**
 * Database refusals of the CMS mapped to the API error model (contracts errors.ts): a taken path
 * is 409 CONFLICT_STATE on `slug`; the path CHECKs (which the contracts already enforce) become
 * 400 VALIDATION_FAILED. Values are never echoed.
 */
import { ApiError } from "../iam/http/api-error.js";

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

export function staleVersion(): ApiError {
  return new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
}

/** Rethrows a known database refusal as an ApiError; anything else unchanged. */
export function mapCmsDbError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const text = errorText(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2002" || /unique constraint/i.test(text)) {
    const registry = text.includes("CmsPage_registry_siteId_templateKey_key");
    if (registry) throw new ApiError("CONFLICT_STATE", [{ path: "key", rule: "already_imported" }]);
    if (/CmsPageRevision_pageId_revisionNumber_key/.test(text)) {
      // Two publications of the same page at once: the second reloads.
      throw new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
    }
    throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "unique" }]);
  }
  if (/CmsPage_(path_format|template_path)/.test(text)) {
    throw new ApiError("VALIDATION_FAILED", [{ path: "slug", rule: "reserved" }]);
  }
  throw error;
}
