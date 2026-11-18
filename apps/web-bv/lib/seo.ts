/**
 * DP-207: technical SEO of dreampetroleumbv.com (contract and policy: @dream/contracts `seo.ts`).
 *
 *  - Policy from the server environment at request time: `DP_DEPLOY_ENV`, `DP_PUBLIC_ORIGIN_BV`
 *    (the public origin, e.g. https://dreampetroleumbv.com) and `DP_SEO_INDEXING=on`. Indexable
 *    only in production with the switch on and a valid https origin; locally (DEV) and on staging
 *    every page stays noindex and robots.txt disallows everything (fail closed).
 *  - Page metadata: canonical URL (absolute, without query), Open Graph and robots from the page's
 *    own SEO fields (CMS) or the published product snapshot. The root layout's static default is
 *    noindex, so a page that forgets this helper is never indexed.
 *  - Reads `GET /api/v1/public/seo/*` with this site's proxy key, server-side only.
 *  - DP-209: the site defaults (site name, default title, description and Open Graph image) are
 *    the published `bv.site-seo` CMS fragment (`siteSeo()`), with the DP-207 values below as the
 *    fallback while it is not published or the API cannot answer. A page's own canonical override
 *    and Open Graph fields come with its published revision or product snapshot; a draft never
 *    reaches this file.
 */
import type { Metadata } from "next";
import { cache } from "react";
import {
  PUBLIC_SEO_API,
  PRIVACY_CONTROLLER,
  PublicSiteSeoResponseSchema,
  PublicSitemapResponseSchema,
  canonicalUrl,
  cmsAsset,
  seoCanonicalPathIsValid,
  seoPolicy,
  type PublicSitemapEntry,
  type SeoPolicy,
} from "@dream/contracts";

import { catalogConfig } from "@/lib/catalog-api";

export const SITE_NAME = "Dream Petroleum BV";
export const ORGANIZATION_NAME = PRIVACY_CONTROLLER.legalName;
export const LOGO_PATH = "/media/brand/dream-petroleum-logo.svg";
/** Shared image for pages without their own (an existing site visual; DP-209 makes it editable). */
export const DEFAULT_OG_IMAGE = "/media/ctl-technology/clear-base-oil.webp";

/** DP-209: the site-wide SEO defaults a page falls back to. */
export interface SiteSeo {
  siteName: string;
  defaultTitle: string;
  /** null: pages without a description of their own have none (the DP-207 behaviour). */
  defaultDescription: string | null;
  defaultOgImage: string;
}

/** The defaults while `bv.site-seo` is not published (exactly the DP-207 values). */
export const CODE_SITE_SEO: SiteSeo = {
  siteName: SITE_NAME,
  defaultTitle: SITE_NAME,
  defaultDescription: null,
  defaultOgImage: DEFAULT_OG_IMAGE,
};

const TIMEOUT_MS = 5_000;
const NOINDEX = { index: false, follow: false } as const;

export function sitePolicy(env: Record<string, string | undefined> = process.env): SeoPolicy {
  return seoPolicy({
    deployEnv: env["DP_DEPLOY_ENV"],
    origin: env["DP_PUBLIC_ORIGIN_BV"],
    indexing: env["DP_SEO_INDEXING"],
  });
}

export interface PageSeo {
  /** The site path of the page ("/about-us", "/products/x"); the canonical URL is built from it. */
  path: string;
  /** Query parameters that are part of the canonical address (e.g. the product category). */
  query?: Readonly<Record<string, string | undefined>>;
  title: string;
  description?: string | null;
  /** The page's own noindex (CMS field); the site policy can only add noindex, never remove it. */
  noindex?: boolean;
  /** Site paths or absolute URLs; the first is the main image. */
  images?: readonly { url: string; alt?: string | null; width?: number; height?: number }[];
  type?: "website" | "article";
  publishedTime?: string | null;
  /**
   * DP-209: the page's canonical override, a path of this site. Checked again here: anything
   * that is not a valid site path is ignored (the page's own address is used).
   */
  canonicalPath?: string | null;
  /** DP-209: Open Graph title and description (default: the title and description). */
  ogTitle?: string | null;
  ogDescription?: string | null;
  /** DP-209: the Open Graph image chosen for the page; before `images`, then the site default. */
  ogImage?: { url: string; alt?: string | null; width?: number; height?: number } | null;
}

function withQuery(url: string, query: PageSeo["query"]): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query ?? {})) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Metadata of an indexable page: canonical, Open Graph, Twitter card and robots. DP-209: missing
 * values fall back to the site defaults (description, Open Graph image, site name).
 */
export function pageMetadata(
  page: PageSeo,
  site: SiteSeo = CODE_SITE_SEO,
  policy: SeoPolicy = sitePolicy(),
): Metadata {
  const index = policy.indexable && !page.noindex;
  const description = page.description?.trim() || site.defaultDescription?.trim() || undefined;
  const ogTitle = page.ogTitle?.trim() || page.title;
  const ogDescription = page.ogDescription?.trim() || description;
  const chosen = page.ogImage ? [page.ogImage] : page.images?.length ? page.images : null;
  const images = (chosen ?? [{ url: site.defaultOgImage }]).map((i) => ({
    url: policy.origin && i.url.startsWith("/") ? canonicalUrl(policy.origin, i.url) : i.url,
    ...(i.alt ? { alt: i.alt } : {}),
    ...(i.width ? { width: i.width } : {}),
    ...(i.height ? { height: i.height } : {}),
  }));
  // A valid override replaces the address and its query; anything else is ignored.
  const override = seoCanonicalPathIsValid(page.canonicalPath) ? page.canonicalPath : null;
  const url = policy.origin
    ? override
      ? canonicalUrl(policy.origin, override)
      : withQuery(canonicalUrl(policy.origin, page.path), page.query)
    : undefined;
  return {
    title: page.title,
    ...(description ? { description } : {}),
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: page.type ?? "website",
      siteName: site.siteName,
      locale: "en_GB",
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      ...(url ? { url } : {}),
      ...(policy.origin ? { images } : {}),
      ...(page.type === "article" && page.publishedTime ? { publishedTime: page.publishedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      ...(policy.origin ? { images: images.map((i) => i.url) } : {}),
    },
    robots: index ? { index: true, follow: true } : NOINDEX,
  };
}

/** DP-209: the PageSeo fields of a published CMS page or article's SEO. */
export function cmsPageSeo(seo: {
  canonicalPath: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}): Pick<PageSeo, "canonicalPath" | "ogTitle" | "ogDescription" | "ogImage"> {
  const asset = seo.ogImage ? cmsAsset(seo.ogImage) : undefined;
  return {
    canonicalPath: seo.canonicalPath,
    ogTitle: seo.ogTitle,
    ogDescription: seo.ogDescription,
    ogImage: asset && asset.kind === "image" ? { url: asset.src, width: asset.width, height: asset.height } : null,
  };
}

/** Metadata of a page that must never be indexed (unavailable states, forms, previews). */
export function noindexMetadata(title: string): Metadata {
  return { title, robots: NOINDEX };
}

// --- API reads ----------------------------------------------------------------------------------

export type Resolve =
  | { status: "found" }
  | { status: "not_found" }
  | { status: "unpublished" }
  /** The API could not answer: the page renders as before (its own not-found handling). */
  | { status: "unknown" };

function unpublishedDetail(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return (
    Array.isArray(details) &&
    details.some(
      (d) => typeof d === "object" && d !== null && (d as { rule?: unknown }).rule === "unpublished",
    )
  );
}

/** The fast existence check of an address (DP-207), asked before rendering. */
export async function resolvePath(path: string, config = catalogConfig()): Promise<Resolve> {
  if (!config) return { status: "unknown" };
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${PUBLIC_SEO_API}/resolve?path=${encodeURIComponent(path)}`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error("public seo: resolve failed (network)");
    return { status: "unknown" };
  }
  if (res.ok) return { status: "found" };
  if (res.status === 404) {
    const body: unknown = await res.json().catch(() => null);
    return { status: unpublishedDetail(body) ? "unpublished" : "not_found" };
  }
  return { status: "unknown" };
}

/**
 * DP-209: the published SEO defaults of the site (`bv.site-seo`), once per request; the code
 * defaults while it is not published or the API cannot answer (never blocks a page).
 */
export const siteSeo = cache(async (): Promise<SiteSeo> => {
  const config = catalogConfig();
  if (!config) return CODE_SITE_SEO;
  try {
    const res = await fetch(`${config.apiUrl}${PUBLIC_SEO_API}/settings`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return CODE_SITE_SEO;
    const parsed = PublicSiteSeoResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error("public seo: the settings response does not match the contract");
      return CODE_SITE_SEO;
    }
    return parsed.data.settings ?? CODE_SITE_SEO;
  } catch {
    console.error("public seo: settings failed (network)");
    return CODE_SITE_SEO;
  }
});

/** The indexable live addresses of the site; null when the API cannot answer. */
export async function sitemapEntries(config = catalogConfig()): Promise<PublicSitemapEntry[] | null> {
  if (!config) return null;
  try {
    const res = await fetch(`${config.apiUrl}${PUBLIC_SEO_API}/sitemap`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = PublicSitemapResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error("public seo: the sitemap response does not match the contract");
      return null;
    }
    return parsed.data.entries;
  } catch {
    console.error("public seo: sitemap failed (network)");
    return null;
  }
}
