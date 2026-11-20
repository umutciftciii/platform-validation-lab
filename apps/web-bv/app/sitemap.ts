import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { canonicalUrl } from "@dream/contracts";

import { DEFAULT_LOCALE, localePath } from "@/lib/locale-routing";
import { sitemapEntries, sitePolicy } from "@/lib/seo";

/**
 * DP-207: sitemap.xml of the live, indexable addresses (`GET /api/v1/public/seo/sitemap`):
 * published CMS pages and articles without noindex, live products, the product and news lists.
 * Drafts, unpublished, hidden and archived content never appear. Without a public origin the
 * sitemap is empty rather than pointing at a wrong host; while the API cannot answer it is an
 * error (5xx: crawlers retry later instead of reading an empty site).
 * ML-3: the API lists the default language (English) at its stored addresses; each one is listed
 * at its public `/en/...` address. Dutch is never listed here (not public; per-language sitemap
 * and hreflang are ML-5).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const { origin } = sitePolicy();
  if (!origin) return [];
  const entries = await sitemapEntries();
  if (!entries) throw new Error("sitemap: the platform API did not answer");
  return entries.map((e) => ({
    url: canonicalUrl(origin, localePath(DEFAULT_LOCALE, e.path)),
    ...(e.lastModified ? { lastModified: e.lastModified } : {}),
  }));
}
