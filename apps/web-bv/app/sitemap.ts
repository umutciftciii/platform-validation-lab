import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { canonicalUrl } from "@dream/contracts";

import { publicLocales } from "@/lib/public-locales";
import { sitemapEntries, sitePolicy } from "@/lib/seo";
import { sitemapUrls } from "@/lib/sitemap-entries";

/**
 * DP-207: sitemap.xml of the live, indexable addresses (`GET /api/v1/public/seo/sitemap`):
 * published CMS pages and articles without noindex, live products, the product and news lists.
 * Drafts, unpublished, hidden and archived content never appear. Without a public origin the
 * sitemap is empty rather than pointing at a wrong host; while the API cannot answer it is an
 * error (5xx: crawlers retry later instead of reading an empty site).
 * ML-5 (DP-019): every public language at its own prefixed address (`/en/...`, `/nl/...` once
 * public), each entry with its `xhtml:link` alternates (`en`, `nl`, `x-default`) when it has a
 * listed counterpart; nothing of a language that is not public (lib/sitemap-entries.ts).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const { origin } = sitePolicy();
  if (!origin) return [];
  const [entries, locales] = await Promise.all([sitemapEntries(), publicLocales()]);
  if (!entries) throw new Error("sitemap: the platform API did not answer");
  return sitemapUrls(entries, locales).map((u) => ({
    url: canonicalUrl(origin, u.href),
    ...(u.lastModified ? { lastModified: u.lastModified } : {}),
    ...(u.languages
      ? {
          alternates: {
            languages: Object.fromEntries(
              Object.entries(u.languages).map(([l, href]) => [l, canonicalUrl(origin, href)]),
            ),
          },
        }
      : {}),
  }));
}
