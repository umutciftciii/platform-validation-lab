/**
 * DP-197: the request bodies the console sends to POST /products/:id/listings/:siteId. Pure
 * functions, unit-tested: the Content tab's save never changes the listing's visibility, and the
 * Publication tab's switch-on step changes nothing but the visibility.
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

/**
 * Publication tab, approved path: the saved listing again with only its visibility changed
 * (switched on before publishing, or back off when publishing failed).
 */
export function listingVisibilityBody(
  listing: Listing,
  visibility: Listing["visibility"],
  version: number,
): ListingUpsertRequest {
  return {
    version,
    categoryId: listing.categoryId,
    visibility,
    sortOrder: listing.sortOrder,
    title: listing.text?.title ?? null,
    summary: listing.text?.summary ?? null,
    description: listing.text?.description ?? null,
  };
}
