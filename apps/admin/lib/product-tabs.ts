/**
 * The product page's tabs (DP-187): which tab a URL opens, where an old `#section` link lands,
 * and in which tab a publication issue is fixed. Pure functions, shared by the server page and
 * the client tab shell, and unit-tested without a browser.
 */

export const PRODUCT_TABS = [
  { id: "content", label: "Content" },
  { id: "technical", label: "Technical" },
  { id: "media", label: "Media & Documents" },
  { id: "publication", label: "Publication" },
] as const;

export type ProductTabId = (typeof PRODUCT_TABS)[number]["id"];

export const DEFAULT_PRODUCT_TAB: ProductTabId = "content";

const TAB_IDS: ReadonlySet<string> = new Set(PRODUCT_TABS.map((t) => t.id));

/** `?tab=` of the product page; anything unknown opens the default tab. */
export function parseProductTab(value: string | string[] | undefined): ProductTabId {
  const v = Array.isArray(value) ? value[0] : value;
  return v && TAB_IDS.has(v) ? (v as ProductTabId) : DEFAULT_PRODUCT_TAB;
}

export function productTabLabel(tab: ProductTabId): string {
  return PRODUCT_TABS.find((t) => t.id === tab)?.label ?? tab;
}

/**
 * The section ids of the former one-page layout (review queue links, bookmarks). Each section
 * still exists under the same id, now inside one tab.
 */
export const SECTION_TAB: Readonly<Record<string, ProductTabId>> = {
  master: "content",
  listing: "content",
  "listing-panel": "content",
  specs: "technical",
  "cross-references": "technical",
  // DP-180: the research notes of the site's proposal.
  research: "technical",
  images: "media",
  documents: "media",
  review: "publication",
  publication: "publication",
  history: "publication",
};

/** The tab that holds `#section`, or null for an unknown hash. */
export function tabForHash(hash: string): ProductTabId | null {
  const id = hash.replace(/^#/, "");
  return SECTION_TAB[id] ?? null;
}

/** The product page URL for one site and tab (the default tab is left out of the URL). */
export function productHref(productId: string, siteParam: string, tab: ProductTabId): string {
  const q = new URLSearchParams({ site: siteParam });
  if (tab !== DEFAULT_PRODUCT_TAB) q.set("tab", tab);
  return `/products/${productId}?${q.toString()}`;
}

export interface IssueFix {
  /** The tab where the issue is fixed. */
  tab: ProductTabId;
  /** The section inside that tab (scrolled to). */
  section: string;
  /** What to do, in plain words. */
  hint: string;
  /** True when the fix is on one site's listing, so the link opens that site. */
  perSite?: boolean;
}

/**
 * Where and how a publication or validation issue is fixed (codes of checkPublication and of
 * validateProductData in @dream/contracts). Only explains: the API still decides.
 */
export function fixForIssue(code: string): IssueFix | null {
  switch (code) {
    case "not_approved":
      return {
        tab: "publication",
        section: "review",
        hint: "Submit the product master for review; another reviewer approves it. An administrator with approval and publishing rights can publish directly.",
      };
    case "not_reviewed":
      return {
        tab: "publication",
        section: "review",
        hint: "Optional: ask a second person to review it first.",
      };
    case "listing_shown_on_publish":
      return {
        tab: "content",
        section: "listing",
        hint: "Nothing to do: publishing shows it. A hidden listing later takes it off the site again.",
        perSite: true,
      };
    case "company_review_pending":
      return {
        tab: "content",
        section: "listing",
        hint: "Optional: the company can review the proposal under Company Review.",
        perSite: true,
      };
    case "sensitive_claim":
      return {
        tab: "content",
        section: "listing",
        hint: "Keep this wording only with a certificate or source document; otherwise remove it from the site texts.",
        perSite: true,
      };
    case "archived":
      return {
        tab: "content",
        section: "master",
        hint: "Restore the product with the button at the top of the page.",
      };
    case "listing_missing":
      return {
        tab: "content",
        section: "listing",
        hint: "List the product on this site (site listing).",
        perSite: true,
      };
    case "listing_hidden":
      return {
        tab: "content",
        section: "listing",
        hint: "Set the site listing to Visible and save it.",
        perSite: true,
      };
    case "cover_missing":
      return {
        tab: "media",
        section: "images",
        hint: "Upload an image and make it the cover.",
      };
    case "alt_text_missing":
      return { tab: "media", section: "images", hint: "Add alt text to every image." };
    case "summary_missing":
      return {
        tab: "content",
        section: "master",
        hint: "Add a summary to this site's listing (or copy the research proposal) or to the product master.",
      };
    case "description_missing":
      return {
        tab: "content",
        section: "master",
        hint: "Add a description to this site's listing (or copy the research proposal) or to the product master.",
      };
    case "required_missing":
      return {
        tab: "technical",
        section: "specs",
        hint: "Fill in this required specification and save.",
      };
    case "specs_missing":
    case "optional_missing":
    case "test_method_missing":
      return { tab: "technical", section: "specs", hint: "Complete the technical data." };
    case "invalid_type":
    case "invalid_unit":
    case "invalid_range":
    case "out_of_bounds":
    case "too_precise":
    case "too_long":
    case "unknown_definition":
      return { tab: "technical", section: "specs", hint: "Correct this value and save." };
    default:
      return null;
  }
}

/** Fields of one form that differ from what the page loaded (uncontrolled inputs only). */
export function formHasChanges(form: HTMLFormElement): boolean {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLTextAreaElement) {
      if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLSelectElement) {
      if (Array.from(el.options).some((o) => o.selected !== o.defaultSelected)) return true;
    } else if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== el.defaultChecked) return true;
      } else if (el.type !== "file" && el.type !== "hidden" && el.value !== el.defaultValue) {
        return true;
      }
    }
  }
  return false;
}
