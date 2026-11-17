/**
 * DP-197: what the console shows about a product on one site, in three words — Draft, Published,
 * Unpublished — and what the Publication tab's Publish button does. The listing's technical
 * visibility (HIDDEN / VISIBLE) is never shown: publishing switches the listing on when needed
 * (DP-198: in the publishing transaction itself, in both modes), unpublishing takes the product
 * off the site. Pure functions over the API's answers; the API
 * (checkPublication, the publish and unpublish transitions, the database guards) still decides.
 */
import type {
  ListingVisibility,
  ProductStatus,
  PublicationIssue,
  SitePublication,
} from "@dream/contracts";

export type SiteStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";

export const SITE_STATUS_LABEL: Readonly<Record<SiteStatus, string>> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
};

/**
 * Draft: never published on the site. Published: live there — the public catalogue shows a
 * product when its publication is PUBLISHED, its listing VISIBLE and the master not archived
 * (apps/api catalog/live.ts). Unpublished: published before, off the site now.
 */
export function siteStatus(input: {
  publication: { status: "PUBLISHED" | "UNPUBLISHED" } | null;
  listing: ListingVisibility | null;
  productStatus?: ProductStatus;
}): SiteStatus {
  if (!input.publication) return "DRAFT";
  const live =
    input.publication.status === "PUBLISHED" &&
    input.listing === "VISIBLE" &&
    input.productStatus !== "ARCHIVED";
  return live ? "PUBLISHED" : "UNPUBLISHED";
}

export interface PublicationPlan {
  status: SiteStatus;
  /**
   * DP-198 (R-29): Publish shows the hidden listing in the same API transaction (`makeVisible`,
   * both modes; the API's `canShowListing`: product:publish and product:edit of the site). False
   * when it is shown already, or cannot be shown (then `listing_hidden` stays blocking).
   */
  showListing: boolean;
  blocking: PublicationIssue[];
  warnings: PublicationIssue[];
  /** Published and nothing changed since: Publish has nothing to do. */
  upToDate: boolean;
  /** The Publish button may be pressed (before any request is pending). */
  canPublish: boolean;
  publishLabel: "Publish" | "Republish";
  /** The Unpublish button is offered: the product is live on the site. */
  canUnpublish: boolean;
}

const SHOWN_ON_PUBLISH = "Not shown on this site yet: publishing shows it.";
const CANNOT_SHOW =
  "Not shown on this site yet. Publishing here also needs edit rights on this site's listing.";

/** The API's readiness text for the two listing codes, without the technical terms. */
function plain(issue: PublicationIssue): PublicationIssue {
  if (issue.code === "listing_shown_on_publish") return { ...issue, message: SHOWN_ON_PUBLISH };
  if (issue.code === "listing_hidden") return { ...issue, message: CANNOT_SHOW };
  return issue;
}

export function planPublication(
  site: SitePublication,
  opts: { productStatus: ProductStatus },
): PublicationPlan {
  const pub = site.publication;
  const status = siteStatus({
    publication: pub,
    listing: site.listing?.visibility ?? null,
    productStatus: opts.productStatus,
  });
  const showListing = site.listing?.visibility === "HIDDEN" && site.canShowListing;
  const blocking = site.readiness.blocking.map(plain);
  const warnings = site.readiness.warnings.map(plain);
  const upToDate = status === "PUBLISHED" && !site.outdated.master && !site.outdated.listing;
  return {
    status,
    showListing,
    blocking,
    warnings,
    upToDate,
    canPublish: site.canPublish && site.listing !== null && blocking.length === 0 && !upToDate,
    publishLabel: status === "PUBLISHED" ? "Republish" : "Publish",
    canUnpublish: site.canPublish && pub?.status === "PUBLISHED" && status === "PUBLISHED",
  };
}
