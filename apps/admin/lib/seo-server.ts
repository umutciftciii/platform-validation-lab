/**
 * DP-209: server-side helpers of the admin's SEO previews (server components only).
 */
import {
  ADMIN_SEO_API,
  CORPORATE_LOCAL_ORIGIN,
  SeoOverviewResponseSchema,
  seoPolicy,
} from "@dream/contracts";
import { siteSeoDefaultsOf, type SiteSeoDefaults } from "./seo-view";
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

/**
 * COM-1: the public origin of the corporate site, with the same variables as web-corporate
 * (`DP_DEPLOY_ENV`, `DP_PUBLIC_ORIGIN_CORPORATE`); locally its DEV address.
 */
export function corporatePublicOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return seoPolicy({
    deployEnv: env["DP_DEPLOY_ENV"],
    origin: env["DP_PUBLIC_ORIGIN_CORPORATE"],
    indexing: env["DP_SEO_INDEXING"],
    localOrigin: CORPORATE_LOCAL_ORIGIN,
  }).origin;
}

/** COM-1: the public origin of a site by its key. */
export function sitePublicOrigin(key: "BV" | "CORPORATE"): string | null {
  return key === "BV" ? bvPublicOrigin() : corporatePublicOrigin();
}

/** The published SEO defaults of a site (the code defaults while unpublished or unreadable). */
export async function siteSeoDefaults(siteId: string): Promise<SiteSeoDefaults> {
  const res = await serverRead(
    `${ADMIN_SEO_API}/sites/${siteId}/overview?part=settings`,
    SeoOverviewResponseSchema,
  );
  return siteSeoDefaultsOf(res.ok ? res.data.liveSettings : null);
}
