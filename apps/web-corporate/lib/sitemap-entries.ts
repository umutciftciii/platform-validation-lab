/**
 * COM-1: the addresses of the corporate sitemap.xml from the API's sitemap entries — each at its
 * public address in its language, only in languages the site has routes for AND that are public
 * now (fail closed to the default language), with `xhtml:link` alternates towards counterparts
 * listed in the same sitemap (reciprocal by construction). The corporate site has no catalogue
 * routes, so product entries are never listed (the API sends none for it either).
 *
 * Pure (no Next.js, no fetch, no `@/` imports) so `node --test` runs it as is.
 */
import type { PublicSitemapEntry } from "@dream/contracts";

import { hreflangMap, type HreflangMap } from "./hreflang.ts";
import { DEFAULT_LOCALE, isRouteLocale, localePath, type RouteLocale } from "./locale-routing.ts";

export interface SitemapUrl {
  href: string;
  locale: RouteLocale;
  lastModified: string | null;
  languages: HreflangMap | null;
}

/** Entry kinds the corporate site has routes for (COM-1: the home and content pages). */
const ROUTED_KINDS: readonly PublicSitemapEntry["kind"][] = ["home", "page"];

export function sitemapUrls(
  entries: readonly PublicSitemapEntry[],
  publicLocales: readonly string[] | null,
): SitemapUrl[] {
  const visible = new Set<string>(publicLocales ?? [DEFAULT_LOCALE]);
  const shown = (e: PublicSitemapEntry): boolean =>
    isRouteLocale(e.locale) && visible.has(e.locale) && ROUTED_KINDS.includes(e.kind);
  const listed = entries.filter(shown);
  const keys = new Set(listed.map((e) => `${e.locale} ${e.path}`));
  const seen = new Set<string>();
  const out: SitemapUrl[] = [];
  for (const e of listed) {
    const locale = e.locale as RouteLocale;
    const href = localePath(locale, e.path);
    if (seen.has(href)) continue;
    seen.add(href);
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
