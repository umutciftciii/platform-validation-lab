/**
 * DP-209: filters and notes of the admin SEO overview. Pure functions, unit-tested.
 */
import {
  SEO_TEXT_LIMITS,
  seoCanonicalPathIsValid,
  seoLocalePath,
  type SeoOverviewItem,
} from "@dream/contracts";

/**
 * ML-5: the overview lists the BV site's default language (English); its rows show the public
 * address the site renders (`/en/about-us`), stored paths stay unprefixed.
 */
export function seoPublicPath(path: string): string {
  return seoLocalePath("en", path);
}

export const SEO_FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "noindex", label: "Noindex" },
  { id: "pending", label: "Not published" },
  { id: "products", label: "Products" },
  { id: "pages", label: "Pages & articles" },
] as const;
export type SeoFilter = (typeof SEO_FILTERS)[number]["id"];

export function parseSeoFilter(value: string | string[] | undefined): SeoFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return SEO_FILTERS.some((f) => f.id === v) ? (v as SeoFilter) : "all";
}

/** Short, readable notes of one row (warnings, never errors). */
export function seoNotes(item: SeoOverviewItem): string[] {
  const notes: string[] = [];
  if (!item.description) notes.push("No meta description (fallback used)");
  else if (item.description.length > SEO_TEXT_LIMITS.description.recommended)
    notes.push("Description may be cut off");
  if (item.title && item.title.length > SEO_TEXT_LIMITS.title.recommended)
    notes.push("Title may be cut off");
  if (item.canonicalPath && !seoCanonicalPathIsValid(item.canonicalPath))
    notes.push("Canonical path not valid");
  else if (item.canonicalPath && item.canonicalPath !== item.path)
    notes.push(`Canonical → ${seoPublicPath(item.canonicalPath)}`);
  return notes;
}

export function needsAttention(item: SeoOverviewItem): boolean {
  return seoNotes(item).some((n) => !n.startsWith("Canonical →"));
}

export function filterSeoItems(
  items: readonly SeoOverviewItem[],
  filter: SeoFilter,
): SeoOverviewItem[] {
  switch (filter) {
    case "attention":
      return items.filter(needsAttention);
    case "noindex":
      return items.filter((i) => i.noindex);
    case "pending":
      return items.filter((i) => i.pendingChanges || !i.live);
    case "products":
      return items.filter((i) => i.source === "product");
    case "pages":
      return items.filter((i) => i.source === "cms");
    default:
      return [...items];
  }
}

/** Where a row is edited: the existing editors (no second SEO editor). */
export function seoEditHref(item: SeoOverviewItem, siteParam: string): string {
  return item.source === "cms"
    ? `/content/${item.id}#seo`
    : `/products/${item.id}?site=${siteParam}&tab=seo`;
}

export const SEO_KIND_LABEL: Record<SeoOverviewItem["kind"], string> = {
  home: "Home",
  page: "Page",
  article: "Article",
  product: "Product",
  products: "Product list",
  news: "News list",
};
