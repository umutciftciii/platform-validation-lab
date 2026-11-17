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

/**
 * DP-203: what the console shows for a site. "Not listed" (the site has no listing and never
 * published the product) is not "Draft" (listed, never published): an unlisted site is a choice,
 * not a step left undone. Same three publication words otherwise.
 */
export type SiteDisplayStatus = SiteStatus | "NOT_LISTED";

export const SITE_STATUS_LABEL: Readonly<Record<SiteDisplayStatus, string>> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
  NOT_LISTED: "Not listed",
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

/**
 * DP-203: Not listed when the site has no listing and no publication; the site status otherwise
 * (a site that published the product before keeps Unpublished, whatever happened to the listing).
 */
export function siteDisplayStatus(input: {
  publication: { status: "PUBLISHED" | "UNPUBLISHED" } | null;
  listing: ListingVisibility | null;
  productStatus?: ProductStatus;
}): SiteDisplayStatus {
  if (!input.publication && !input.listing) return "NOT_LISTED";
  return siteStatus(input);
}

/**
 * DP-203: the master status is a separate, secondary fact. It is left out only where it would
 * repeat the site status: a Draft master next to sites that are all Draft or Not listed. Every
 * other master status — and Draft next to a Published or Unpublished site, which the DIRECT
 * publication model allows (ADR-023) — stays, so the two are never folded into one status.
 */
function masterAddsSomething(
  sites: readonly SiteDisplayStatus[],
  productStatus: ProductStatus,
): boolean {
  if (productStatus !== "DRAFT") return true;
  return sites.some((s) => s === "PUBLISHED" || s === "UNPUBLISHED");
}

/**
 * DP-200: what one row of the product list says about the selected site. The site status always
 * shows; the master status only when it tells the user something the site status does not. A new
 * master in Draft that was never published on the site would read "Draft" twice for one meaning
 * ("not live yet, still being prepared"), so that one pair shows the site status alone. Every
 * other pair stays: In review and Archived say where the master is, Approved says it is ready, and
 * Draft next to Published or Unpublished is a real difference. No new words, no visibility.
 */
export interface ListRowStatus {
  site: SiteDisplayStatus;
  /** Null when it would only repeat the site status. */
  master: ProductStatus | null;
}

export function listRowStatus(input: {
  publication: { status: "PUBLISHED" | "UNPUBLISHED" } | null;
  listing: ListingVisibility | null;
  productStatus: ProductStatus;
}): ListRowStatus {
  const site = siteDisplayStatus(input);
  return {
    site,
    master: masterAddsSomething([site], input.productStatus) ? input.productStatus : null,
  };
}

/**
 * DP-203: the product header. Each readable site's status first (the primary fact), then the
 * master status, labelled, only when it adds something (masterAddsSomething).
 */
export interface HeaderStatus {
  sites: { siteKey: "BV" | "CORPORATE"; status: SiteDisplayStatus }[];
  master: ProductStatus | null;
}

export function headerStatus(
  sites: readonly SitePublication[],
  productStatus: ProductStatus,
): HeaderStatus {
  const list = sites.map((s) => ({
    siteKey: s.siteKey,
    status: siteDisplayStatus({
      publication: s.publication,
      listing: s.listing?.visibility ?? null,
      productStatus,
    }),
  }));
  return {
    sites: list,
    master: masterAddsSomething(
      list.map((s) => s.status),
      productStatus,
    )
      ? productStatus
      : null,
  };
}

export interface PublicationPlan {
  status: SiteDisplayStatus;
  /**
   * DP-203: the site has no listing. Then `listing_missing` is no blocker on the card or the tab
   * (an unlisted site is a choice); listing the product on the Content tab is the next step, and
   * the other blockers stay listed as what publishing there would also need.
   */
  notListed: boolean;
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
  const status = siteDisplayStatus({
    publication: pub,
    listing: site.listing?.visibility ?? null,
    productStatus: opts.productStatus,
  });
  const notListed = site.listing === null;
  const showListing = site.listing?.visibility === "HIDDEN" && site.canShowListing;
  const blocking = site.readiness.blocking
    .filter((i) => !(notListed && i.code === "listing_missing"))
    .map(plain);
  const warnings = site.readiness.warnings.map(plain);
  const upToDate = status === "PUBLISHED" && !site.outdated.master && !site.outdated.listing;
  return {
    status,
    notListed,
    showListing,
    blocking,
    warnings,
    upToDate,
    canPublish: site.canPublish && !notListed && blocking.length === 0 && !upToDate,
    publishLabel: status === "PUBLISHED" ? "Republish" : "Publish",
    canUnpublish: site.canPublish && pub?.status === "PUBLISHED" && status === "PUBLISHED",
  };
}

/**
 * DP-203: the Publication tab's red marker — listed sites where publishing or republishing is
 * blocked, i.e. where someone has to act. An unlisted site never counts (nothing to fix there).
 */
export function blockedSiteCount(
  sites: readonly SitePublication[],
  productStatus: ProductStatus,
): number {
  return sites.filter((s) => {
    const plan = planPublication(s, { productStatus });
    return !plan.notListed && plan.blocking.length > 0;
  }).length;
}

/**
 * DP-203: whether the Second-person review offers "Submit for review". Hidden when the caller
 * publishes directly on every site it can read (DIRECT, ADR-023): the review cannot change what
 * that user may publish. Shown otherwise — on the APPROVED path it is the way to an approved
 * master — as a secondary action when the caller publishes directly on some sites only.
 * The API's canSubmit still decides whether it is allowed at all.
 */
export type SubmitOffer = "primary" | "secondary" | "hidden";

export function submitOffer(data: {
  permissions: { canSubmit: boolean };
  sites: readonly Pick<SitePublication, "publishMode">[];
}): SubmitOffer {
  if (!data.permissions.canSubmit) return "hidden";
  const direct = data.sites.filter((s) => s.publishMode === "DIRECT").length;
  if (direct === 0) return "primary";
  return direct === data.sites.length ? "hidden" : "secondary";
}
