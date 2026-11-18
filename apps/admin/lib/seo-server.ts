/**
 * DP-209: server-side helpers of the admin's SEO previews (server components only).
 */
import { ADMIN_SEO_API, SeoOverviewResponseSchema, seoPolicy } from "@dream/contracts";
import { CODE_SITE_SEO, type SiteSeoDefaults } from "./seo-view";
import { serverRead } from "./server-api";

/**
 * The public origin of the BV site as the admin knows it: the same variables as web-bv
 * (`DP_DEPLOY_ENV`, `DP_PUBLIC_ORIGIN_BV`). Locally the DEV address; null when production has
 * no valid origin (the preview then shows the path only).
 */
export function bvPublicOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return seoPolicy({
    deployEnv: env["DP_DEPLOY_ENV"],
    origin: env["DP_PUBLIC_ORIGIN_BV"],
    indexing: env["DP_SEO_INDEXING"],
  }).origin;
}

/** The published SEO defaults of a site (the code defaults while unpublished or unreadable). */
export async function siteSeoDefaults(siteId: string): Promise<SiteSeoDefaults> {
  const res = await serverRead(
    `${ADMIN_SEO_API}/sites/${siteId}/overview?part=settings`,
    SeoOverviewResponseSchema,
  );
  return (res.ok ? res.data.liveSettings : null) ?? CODE_SITE_SEO;
}
