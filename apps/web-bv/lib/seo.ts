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
 */
import type { Metadata } from "next";
import {
  PUBLIC_SEO_API,
  PRIVACY_CONTROLLER,
  PublicSitemapResponseSchema,
  canonicalUrl,
  seoPolicy,
  type PublicSitemapEntry,
  type SeoPolicy,
} from "@dream/contracts";

import { catalogConfig } from "@/lib/catalog-api";

export const SITE_NAME = "Dream Petroleum BV";
export const ORGANIZATION_NAME = PRIVACY_CONTROLLER.legalName;
export const LOGO_PATH = "/media/brand/dream-petroleum-logo.svg";
/** Shared image for pages without their own (an existing site visual; DP-208 makes it editable). */
export const DEFAULT_OG_IMAGE = "/media/ctl-technology/clear-base-oil.webp";

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
}

function withQuery(url: string, query: PageSeo["query"]): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query ?? {})) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/** Metadata of an indexable page: canonical, Open Graph, Twitter card and robots. */
export function pageMetadata(page: PageSeo, policy: SeoPolicy = sitePolicy()): Metadata {
  const index = policy.indexable && !page.noindex;
  const description = page.description?.trim() || undefined;
  const images = (page.images?.length ? page.images : [{ url: DEFAULT_OG_IMAGE }]).map((i) => ({
    url: policy.origin && i.url.startsWith("/") ? canonicalUrl(policy.origin, i.url) : i.url,
    ...(i.alt ? { alt: i.alt } : {}),
    ...(i.width ? { width: i.width } : {}),
    ...(i.height ? { height: i.height } : {}),
  }));
  const url = policy.origin ? withQuery(canonicalUrl(policy.origin, page.path), page.query) : undefined;
  return {
    title: page.title,
    ...(description ? { description } : {}),
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: page.type ?? "website",
      siteName: SITE_NAME,
      locale: "en_GB",
      title: page.title,
      ...(description ? { description } : {}),
      ...(url ? { url } : {}),
      ...(policy.origin ? { images } : {}),
      ...(page.type === "article" && page.publishedTime ? { publishedTime: page.publishedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      ...(description ? { description } : {}),
      ...(policy.origin ? { images: images.map((i) => i.url) } : {}),
    },
    robots: index ? { index: true, follow: true } : NOINDEX,
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
