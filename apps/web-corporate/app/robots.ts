import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { sitePolicy } from "@/lib/seo";

/**
 * COM-1: robots.txt from the site policy at request time. Not indexable (local, staging, or
 * production without `DP_SEO_INDEXING=on` and a public origin): everything disallowed.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const policy = sitePolicy();
  if (!policy.indexable || !policy.origin) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${policy.origin}/sitemap.xml`,
  };
}
