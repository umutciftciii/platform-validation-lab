import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { canonicalUrl } from "@dream/contracts";

import { sitemapEntries, sitePolicy } from "@/lib/seo";

/**
 * DP-207: sitemap.xml of the live, indexable addresses (`GET /api/v1/public/seo/sitemap`):
 * published CMS pages and articles without noindex, live products, the product and news lists.
 * Drafts, unpublished, hidden and archived content never appear. Without a public origin the
 * sitemap is empty rather than pointing at a wrong host; while the API cannot answer it is an
 * error (5xx: crawlers retry later instead of reading an empty site).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const { origin } = sitePolicy();
  if (!origin) return [];
  const entries = await sitemapEntries();
  if (!entries) throw new Error("sitemap: the platform API did not answer");
  return entries.map((e) => ({
    url: canonicalUrl(origin, e.path),
    ...(e.lastModified ? { lastModified: e.lastModified } : {}),
  }));
}
