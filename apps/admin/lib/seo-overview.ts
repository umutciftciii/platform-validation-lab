/**
 * DP-209: filters and notes of the admin SEO overview. Pure functions, unit-tested.
 * ML-12d (DP-243): labels and notes in the UI language (`t`); filter ids, kinds and the rules
 * behind each note are unchanged.
 */
import {
  SEO_TEXT_LIMITS,
  seoCanonicalPathIsValid,
  seoLocalePath,
  type SeoOverviewItem,
} from "@dream/contracts";
import type { Translate } from "./i18n/types";

/**
 * ML-5: the overview lists the BV site's default language (English); its rows show the public
 * address the site renders (`/en/about-us`), stored paths stay unprefixed.
 */
export function seoPublicPath(path: string): string {
  return seoLocalePath("en", path);
}

/** The overview's filters (`?filter=`); their labels are `seo.overview.filters.<id>`. */
export const SEO_FILTERS = [
  { id: "all" },
  { id: "attention" },
  { id: "noindex" },
  { id: "pending" },
  { id: "products" },
  { id: "pages" },
] as const;
export type SeoFilter = (typeof SEO_FILTERS)[number]["id"];

export function seoFilterLabel(filter: SeoFilter, t: Translate): string {
  return t(`seo.overview.filters.${filter}`);
}

export function parseSeoFilter(value: string | string[] | undefined): SeoFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return SEO_FILTERS.some((f) => f.id === v) ? (v as SeoFilter) : "all";
}

type SeoNote = "noDescription" | "descriptionLong" | "titleLong" | "canonicalInvalid" | "canonical";

/** The notes of one row as codes (`seo.overview.notes.<code>`). */
function seoNoteCodes(item: SeoOverviewItem): SeoNote[] {
  const notes: SeoNote[] = [];
  if (!item.description) notes.push("noDescription");
  else if (item.description.length > SEO_TEXT_LIMITS.description.recommended)
    notes.push("descriptionLong");
  if (item.title && item.title.length > SEO_TEXT_LIMITS.title.recommended) notes.push("titleLong");
  if (item.canonicalPath && !seoCanonicalPathIsValid(item.canonicalPath))
    notes.push("canonicalInvalid");
  else if (item.canonicalPath && item.canonicalPath !== item.path) notes.push("canonical");
  return notes;
}

/** Short, readable notes of one row (warnings, never errors). */
export function seoNotes(item: SeoOverviewItem, t: Translate): string[] {
  return seoNoteCodes(item).map((n) =>
    n === "canonical"
      ? t("seo.overview.notes.canonical", { path: seoPublicPath(item.canonicalPath ?? "") })
      : t(`seo.overview.notes.${n}`),
  );
}

/** A row needs attention for every note except a (valid) canonical pointing elsewhere. */
export function needsAttention(item: SeoOverviewItem): boolean {
  return seoNoteCodes(item).some((n) => n !== "canonical");
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

export function seoKindLabel(kind: SeoOverviewItem["kind"], t: Translate): string {
  return t(`seo.overview.kind.${kind}`);
}
