/**
 * Browser-side calls of the catalogue API (PM-1) through the admin's same-origin proxy. Returns
 * a value instead of throwing, with a readable message for the form: the contract's text for a
 * known error code, refined for the catalogue's validation and conflict details.
 */
import { CATALOG_API, DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";

export interface FieldIssue {
  path: string;
  rule: string;
}

export type CallResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; issues: FieldIssue[] };

const RULE_MESSAGES: Readonly<Record<string, string>> = {
  "version:stale": "Someone else changed this record. Reload the page to see their version.",
  "code:unique": "Another product already uses this code.",
  "slug:unique": "This slug is already in use.",
  "listing:unique": "This product is already listed on the site. Reload the page.",
  "parentId:too_deep": "Categories can be at most three levels deep.",
  "parentId:cycle": "A category cannot be moved below itself.",
  "parentId:unknown_parent": "The parent category does not exist on this site.",
  "categoryId:required": "Choose a category, or set a default category for this site first.",
  "categoryId:unknown": "The category does not exist on this site.",
  "visibility:product_archived": "An archived product cannot be visible on a site.",
  "status:archived": "Archived products cannot be edited. Restore it first.",
  "(root):has_children": "Move or delete the sub-categories first.",
  "(root):has_listings": "Move the products in this category first.",
  // PM-3 review and publication.
  "(root):own_change":
    "You changed or submitted this revision, so another reviewer must decide (separation of duties).",
  "status:not_draft": "Only a draft can be submitted. Reload the page to see the current state.",
  "status:not_in_review": "The product is no longer in review. Reload the page.",
  "status:published": "Unpublish the product on every site before archiving it.",
  "status:not_published": "The product is not published on this site.",
  "status:transition": "This status change is not possible. Reload the page.",
  "listingVersion:stale": "The site listing changed meanwhile. Reload the page and check it again.",
  "product:not_approved": "The product master must be approved in its current version.",
  "product:archived": "Archived products cannot be published.",
  "listing:listing_missing": "List the product on this site first.",
  "listing:listing_hidden": "Make the listing visible on this site first.",
  "images:cover_missing": "Add a cover image first.",
  "summary:summary_missing": "Add a summary (master or listing) first.",
  "(root):image_published": "This image is shown on a live site. Unpublish the product first.",
  // DP-166 image visibility.
  "isPublic:cover_cannot_be_hidden":
    "The cover cannot be hidden. Make another image the cover first.",
  "isPublic:hidden_image": "Show this image on the site before making it the cover.",
  "file:busy": "Image processing is busy. Try again in a moment.",
  // PM-5 technical documents.
  "status:document_archived": "This document is archived. Restore it first.",
  "(root):not_publishable":
    "Only an active, non-internal document with a file can be shown on a site.",
  "(root):too_many_documents": "This product already has the maximum number of documents.",
  "(root):too_many_revisions": "This document already has the maximum number of revisions.",
};

export function messageForIssues(code: string | null, issues: FieldIssue[]): string {
  for (const i of issues) {
    const text = RULE_MESSAGES[`${i.path}:${i.rule}`];
    if (text) return text;
  }
  if (code === "VALIDATION_FAILED" && issues.some((i) => i.path.startsWith("spec:"))) {
    return "Fix the blocking specification issues first (see the validation report).";
  }
  if (code === "VALIDATION_FAILED" && issues.length) {
    const fields = [...new Set(issues.map((i) => i.path))].join(", ");
    return `Check these fields: ${fields}.`;
  }
  if (code && code in DEFAULT_ERROR_MESSAGES) {
    return DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES];
  }
  return "The change could not be saved. Try again in a moment.";
}

export async function callCatalog<T>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<CallResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${CATALOG_API}${path}`, {
      method,
      headers:
        method === "POST"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "The admin API cannot be reached.", issues: [] };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const issues = parsed.success
    ? parsed.data.error.details.filter((d): d is FieldIssue => typeof d === "object")
    : [];
  return { ok: false, status: res.status, message: messageForIssues(code, issues), issues };
}
