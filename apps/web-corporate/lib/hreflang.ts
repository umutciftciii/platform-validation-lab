/**
 * COM-1: the hreflang set of a corporate page — `en`, `tr` and `x-default` — as public addresses,
 * for the page's `<link rel="alternate">` tags and the sitemap's `xhtml:link` entries (one rule
 * for both). The rules of the BV site (apps/web-bv/lib/hreflang.ts, ML-5): only published,
 * indexable counterparts in public languages of the same translation group (the API sends nothing
 * else), one address per language, none with fewer than two languages, `x-default` the address in
 * the site's default language.
 *
 * Pure (no Next.js, no fetch, no `@/` imports) so `node --test` runs it as is.
 */
import {
  DEFAULT_LOCALE,
  ROUTE_LOCALES,
  isRouteLocale,
  localePath,
  type RouteLocale,
} from "./locale-routing.ts";

export interface HreflangAlternate {
  locale: string;
  /** The path inside that language, as the API stores it. */
  path: string;
  /** Absent or false: not named in hreflang (noindex, another canonical). */
  indexable?: boolean;
}

export type HreflangMap = Partial<Record<RouteLocale | "x-default", string>>;

const SITE_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2})?$/;

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
  for (const l of ROUTE_LOCALES) {
    const href = byLocale.get(l);
    if (href) out[l] = href;
  }
  const fallback = byLocale.get(DEFAULT_LOCALE);
  if (fallback) out["x-default"] = fallback;
  return out;
}
