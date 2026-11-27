import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { canonicalUrl } from "@dream/contracts";

import { publicLocales } from "@/lib/public-locales";
import { sitemapEntries, sitePolicy } from "@/lib/seo";
import { sitemapUrls } from "@/lib/sitemap-entries";

/**
 * COM-1: sitemap.xml of the corporate site's live, indexable addresses (`GET /seo/sitemap`): the
 * published CMS pages without noindex in every public language, each at its prefixed address with
 * its `xhtml:link` alternates. Without a public origin the sitemap is empty rather than pointing at
 * a wrong host; while the API cannot answer it is an error (crawlers retry later).
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
