/**
 * DP-197: the request bodies the console sends to POST /products/:id/listings/:siteId. Pure
 * functions, unit-tested: the Content tab's save never changes the listing's visibility. DP-198:
 * the Publication tab no longer saves the listing; Publish shows it in the API's transaction.
 */
import type { Listing, ListingUpsertRequest } from "@dream/contracts";

/** The fields the Content tab's listing form edits. */
export interface ListingFormValues {
  categoryId: string;
  sortOrder: string;
  title: string;
  summary: string;
  description: string;
}

/**
 * Content tab save: the edited fields with the listing's saved visibility, unchanged. A new
 * listing starts off the site (HIDDEN); only Publish shows it.
 */
export function listingSaveBody(
  listing: Listing | null,
  values: ListingFormValues,
): ListingUpsertRequest {
  return {
    version: listing?.version ?? null,
    categoryId: values.categoryId || null,
    visibility: listing?.visibility ?? "HIDDEN",
    sortOrder: Number.parseInt(values.sortOrder, 10) || 0,
    title: values.title,
    summary: values.summary,
    description: values.description,
  };
}
