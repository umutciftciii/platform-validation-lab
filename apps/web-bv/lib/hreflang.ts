/**
 * ML-5 (DP-019, ADR-028 D3/D7): the hreflang set of a page — `en`, `nl` and `x-default` — as
 * public addresses (`/en/about-us`, `/nl/over-ons`). Used for the `<link rel="alternate">` tags of
 * a page and for the `xhtml:link` entries of sitemap.xml, so both always say the same thing.
 *
 * Rules:
 *  - only the page's own language plus published counterparts in PUBLIC languages (the API sends
 *    nothing else: `alternates` of the CMS read, `alternates` of the sitemap), of the same
 *    translation group, each indexable (no noindex, its own canonical address);
 *  - only languages the site has routes for, one address per language, the page's own language
 *    always at the page's own address;
 *  - fewer than two languages: no hreflang at all (an untranslated page names no counterpart, and
 *    never a guessed `/nl/...` address);
 *  - `x-default` is the English address (ADR-028: English is the site's default language).
 *
 * Pure (no Next.js, no fetch, no `@/` imports) so `node --test` runs it as is.
 */
import { DEFAULT_LOCALE, ROUTE_LOCALES, isRouteLocale, localePath, type RouteLocale } from "./locale-routing.ts";

export interface HreflangAlternate {
  locale: string;
  /** The path inside that language ("/over-ons"), as the API stores it. */
  path: string;
  /** Absent or false: the counterpart is not named in hreflang (noindex, another canonical). */
  indexable?: boolean;
}

export type HreflangMap = Partial<Record<RouteLocale | "x-default", string>>;

const SITE_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2})?$/;

/**
 * The hreflang addresses of a page in `locale` at `path` (inside its language), or null when the
 * page has no counterpart that may be named. `requireIndexable`: the CMS read marks each
 * counterpart (`indexable`); the sitemap lists only listed counterparts and passes false.
 */
export function hreflangMap(
  locale: RouteLocale,
  path: string,
  alternates: readonly HreflangAlternate[],
  { requireIndexable = true }: { requireIndexable?: boolean } = {},
): HreflangMap | null {
  if (!SITE_PATH.test(path)) return null;
  const byLocale = new Map<RouteLocale, string>([[locale, localePath(locale, path)]]);
  for (const a of alternates) {
    if (!isRouteLocale(a.locale) || byLocale.has(a.locale)) continue;
    if (requireIndexable && a.indexable !== true) continue;
    if (!SITE_PATH.test(a.path)) continue;
    byLocale.set(a.locale, localePath(a.locale, a.path));
  }
  if (byLocale.size < 2) return null;
  const out: HreflangMap = {};
  // Route order (en, nl), so the tags and the sitemap are stable.
  for (const l of ROUTE_LOCALES) {
    const href = byLocale.get(l);
    if (href) out[l] = href;
  }
  const fallback = byLocale.get(DEFAULT_LOCALE);
  if (fallback) out["x-default"] = fallback;
  return out;
}
