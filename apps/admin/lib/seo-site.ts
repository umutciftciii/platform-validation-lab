/**
 * COM-1: the site of Admin > SEO (overview and redirects). Both sites have their SEO defaults,
 * page SEO and redirects now; the screens show one site at a time, chosen with `?site=bv|corporate`
 * like Content and Products. BV stays the default, so the existing addresses (`/seo`,
 * `/seo/redirects?…`) keep showing the BV site exactly as before. Pure functions, unit-tested.
 */
import type { CatalogSite } from "@dream/contracts";

/** The readable sites of the CMS and the catalogue contexts, each once, BV first. */
export function seoSites(...lists: readonly (readonly CatalogSite[] | null)[]): CatalogSite[] {
  const out: CatalogSite[] = [];
  for (const list of lists) {
    for (const s of list ?? []) if (!out.some((o) => o.id === s.id)) out.push(s);
  }
  return out.sort((a, b) => (a.key === b.key ? 0 : a.key === "BV" ? -1 : 1));
}

/** The site named by `?site=` (bv, corporate), else BV, else the first readable site. */
export function pickSeoSite(
  sites: readonly CatalogSite[],
  param: string | string[] | undefined,
): CatalogSite | undefined {
  const wanted = (Array.isArray(param) ? param[0] : param)?.toUpperCase();
  return (
    sites.find((s) => s.key === wanted) ??
    sites.find((s) => s.key === "BV") ??
    sites[0] ??
    undefined
  );
}

/**
 * An SEO screen address for a site: BV without a parameter (the addresses before COM-1), any
 * other site with `site=<key>` added to the query.
 */
export function withSeoSite(href: string, key: CatalogSite["key"]): string {
  if (key === "BV") return href;
  const hash = href.indexOf("#");
  const base = hash === -1 ? href : href.slice(0, hash);
  const tail = hash === -1 ? "" : href.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}site=${key.toLowerCase()}${tail}`;
}
