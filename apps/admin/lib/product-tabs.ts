/**
 * The product page's tabs (DP-187): which tab a URL opens, where an old `#section` link lands,
 * and in which tab a publication issue is fixed. Pure functions, shared by the server page and
 * the client tab shell, and unit-tested without a browser.
 */

import type { Translate } from "./i18n/types";

/** ML-12a: the labels are in the dictionary (catalog.common.tabs.<id>). */
export const PRODUCT_TABS = [
  { id: "content" },
  { id: "technical" },
  { id: "media" },
  // DP-209: the product's SEO on the selected site.
  { id: "seo" },
  { id: "publication" },
] as const;

export type ProductTabId = (typeof PRODUCT_TABS)[number]["id"];

export const DEFAULT_PRODUCT_TAB: ProductTabId = "content";

const TAB_IDS: ReadonlySet<string> = new Set(PRODUCT_TABS.map((t) => t.id));

/** `?tab=` of the product page; anything unknown opens the default tab. */
export function parseProductTab(value: string | string[] | undefined): ProductTabId {
  const v = Array.isArray(value) ? value[0] : value;
  return v && TAB_IDS.has(v) ? (v as ProductTabId) : DEFAULT_PRODUCT_TAB;
}

export function productTabLabel(tab: ProductTabId, t: Translate): string {
  return t(`catalog.common.tabs.${tab}`);
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
  seo: "seo",
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
export function fixForIssue(code: string, t: Translate): IssueFix | null {
  switch (code) {
    case "not_approved":
      return {
        tab: "publication",
        section: "review",
        hint: t("catalog.common.fix.not_approved"),
      };
    case "not_reviewed":
      return {
        tab: "publication",
        section: "review",
        hint: t("catalog.common.fix.not_reviewed"),
      };
    case "company_review_pending":
      return {
        tab: "content",
        section: "listing",
        hint: t("catalog.common.fix.company_review_pending"),
        perSite: true,
      };
    case "sensitive_claim":
      return {
        tab: "content",
        section: "listing",
        hint: t("catalog.common.fix.sensitive_claim"),
        perSite: true,
      };
    case "archived":
      return {
        tab: "content",
        section: "master",
        hint: t("catalog.common.fix.archived"),
      };
    case "listing_missing":
      return {
        tab: "content",
        section: "listing",
        hint: t("catalog.common.fix.listing_missing"),
        perSite: true,
      };
    case "cover_missing":
      return {
        tab: "media",
        section: "images",
        hint: t("catalog.common.fix.cover_missing"),
      };
    case "alt_text_missing":
      return { tab: "media", section: "images", hint: t("catalog.common.fix.alt_text_missing") };
    // DP-202: the site's own text is the primary place; the shared content is the fallback.
    case "summary_missing":
      return {
        tab: "content",
        section: "listing",
        hint: t("catalog.common.fix.summary_missing"),
        perSite: true,
      };
    case "description_missing":
      return {
        tab: "content",
        section: "listing",
        hint: t("catalog.common.fix.description_missing"),
        perSite: true,
      };
    case "required_missing":
      return {
        tab: "technical",
        section: "specs",
        hint: t("catalog.common.fix.required_missing"),
      };
    case "specs_missing":
    case "optional_missing":
    case "test_method_missing":
      return { tab: "technical", section: "specs", hint: t("catalog.common.fix.complete") };
    case "invalid_type":
    case "invalid_unit":
    case "invalid_range":
    case "out_of_bounds":
    case "too_precise":
    case "too_long":
    case "unknown_definition":
      return { tab: "technical", section: "specs", hint: t("catalog.common.fix.correct") };
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
