/**
 * ML-5 (DP-019, ADR-028 D3/D14): the addresses of sitemap.xml from the API's sitemap entries.
 *
 *  - Each entry is listed at its public address in its language (`/en/about-us`, `/nl/over-ons`).
 *  - Only languages the site has routes for AND that are public now (`publicLocales`, data). The
 *    API lists public languages only; the site checks again, so a Dutch address can never reach
 *    the sitemap while `nl` is not public. While the language list cannot be read, only the
 *    default language is listed (fail closed).
 *  - The catalogue (product list, products) only in the languages that have one
 *    (`CATALOGUE_LOCALES`: English until ML-8c).
 *  - Alternates (`xhtml:link`, hreflang): only counterparts that are themselves listed here, so
 *    every hreflang pair is reciprocal; `x-default` is the English address (lib/hreflang.ts).
 *
 * Pure (no Next.js, no fetch, no `@/` imports) so `node --test` runs it as is.
 */
import type { PublicSitemapEntry } from "@dream/contracts";

import { hreflangMap, type HreflangMap } from "./hreflang.ts";
import { DEFAULT_LOCALE, isRouteLocale, localePath, type RouteLocale } from "./locale-routing.ts";
import { CATALOGUE_LOCALES } from "./proxy-routes.ts";

export interface SitemapUrl {
  /** The public address (`/en/about-us`). */
  href: string;
  locale: RouteLocale;
  lastModified: string | null;
  /** hreflang addresses incl. the entry itself and `x-default`; null without a counterpart. */
  languages: HreflangMap | null;
}

const CATALOGUE_KINDS: readonly PublicSitemapEntry["kind"][] = ["products", "product"];

export function sitemapUrls(
  entries: readonly PublicSitemapEntry[],
  publicLocales: readonly string[] | null,
): SitemapUrl[] {
  const visible = new Set<string>(publicLocales ?? [DEFAULT_LOCALE]);
  const shown = (locale: string, kind: PublicSitemapEntry["kind"]): locale is RouteLocale =>
    isRouteLocale(locale) &&
    visible.has(locale) &&
    (!CATALOGUE_KINDS.includes(kind) || CATALOGUE_LOCALES.includes(locale));
  const listed = entries.filter((e) => shown(e.locale, e.kind));
  const keys = new Set(listed.map((e) => `${e.locale} ${e.path}`));
  const seen = new Set<string>();
  const out: SitemapUrl[] = [];
  for (const e of listed) {
    const locale = e.locale as RouteLocale;
    const href = localePath(locale, e.path);
    if (seen.has(href)) continue;
    seen.add(href);
    // Only counterparts listed in this same sitemap (reciprocal by construction).
    const alternates = e.alternates
      .filter((a) => keys.has(`${a.locale} ${a.path}`))
      .map((a) => ({ locale: a.locale, path: a.path, indexable: true }));
    out.push({
      href,
      locale,
      lastModified: e.lastModified,
      languages: hreflangMap(locale, e.path, alternates),
    });
  }
  return out;
}
