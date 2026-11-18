import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { sitePolicy } from "@/lib/seo";

/**
 * DP-207: robots.txt from the site policy at request time. Not indexable (local/DEV, staging, or
 * production without `DP_SEO_INDEXING=on` and a public origin): everything disallowed. Indexable:
 * the site, without previews, form endpoints, document downloads and the API health route.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const policy = sitePolicy();
  if (!policy.indexable || !policy.origin) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/preview/", "/lead-form/", "/product-documents/", "/api/"],
    },
    sitemap: `${policy.origin}/sitemap.xml`,
  };
}
