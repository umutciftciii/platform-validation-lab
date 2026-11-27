/**
 * COM-1: technical SEO of dreampetroleum.com, with the rules of the BV site (apps/web-bv/lib/seo.ts,
 * DP-207/DP-209/ML-5; contract and policy: @dream/contracts `seo.ts`):
 *
 *  - Policy from the server environment at request time: `DP_DEPLOY_ENV`,
 *    `DP_PUBLIC_ORIGIN_CORPORATE` (e.g. https://dreampetroleum.com) and `DP_SEO_INDEXING=on`.
 *    Indexable only in production with the switch on and a valid https origin; locally and on
 *    staging every page is noindex and robots.txt disallows everything (fail closed).
 *  - Page metadata: canonical URL inside the page's language (`/en/about-us`), hreflang towards
 *    published, indexable counterparts in public languages, Open Graph and robots from the page's
 *    own SEO fields; the root layout's static default is noindex.
 *  - The site defaults are the published `corporate.site-seo` fragment of the page's language,
 *    with the code defaults below while it is not published or the API cannot answer.
 */
import type { Metadata } from "next";
import { cache } from "react";
import {
  CORPORATE_LOCAL_ORIGIN,
  PUBLIC_SEO_API,
  PublicSeoResolveResponseSchema,
  PublicSiteSeoResponseSchema,
  PublicSitemapResponseSchema,
  canonicalUrl,
  seoCanonicalPathIsValid,
  seoPolicy,
  type PublicSitemapEntry,
  type SeoPolicy,
} from "@dream/contracts";

import { apiGet } from "@/lib/api";
import { hreflangMap, type HreflangAlternate } from "@/lib/hreflang";
import {
  DEFAULT_LOCALE,
  isRouteLocale,
  localePath,
  localizeHref,
  ogLocale,
  type RouteLocale,
} from "@/lib/locale-routing";

export const SITE_NAME = "Dream Petroleum";

export interface SiteSeo {
  siteName: string;
  defaultTitle: string;
  defaultDescription: string | null;
  /** null: the site has no default Open Graph image (no media of its own yet). */
  defaultOgImage: string | null;
}

/** The defaults while `corporate.site-seo` is not published. */
export const CODE_SITE_SEO: SiteSeo = {
  siteName: SITE_NAME,
  defaultTitle: SITE_NAME,
  defaultDescription: null,
  defaultOgImage: null,
};

const NOINDEX = { index: false, follow: false } as const;

export function sitePolicy(env: Record<string, string | undefined> = process.env): SeoPolicy {
  return seoPolicy({
    deployEnv: env["DP_DEPLOY_ENV"],
    origin: env["DP_PUBLIC_ORIGIN_CORPORATE"],
    indexing: env["DP_SEO_INDEXING"],
    localOrigin: CORPORATE_LOCAL_ORIGIN,
  });
}

export interface PageSeo {
  /** The site path inside its language ("/about-us", "/"). */
  path: string;
  locale: RouteLocale;
  title: string;
  description?: string | null;
  noindex?: boolean;
  /** The page's canonical override (a stored site path); anything invalid is ignored. */
  canonicalPath?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  /** Published counterparts in the other public languages (CMS read `alternates`). */
  alternates?: readonly HreflangAlternate[];
}

/** Metadata of a page: canonical, hreflang, Open Graph, Twitter card and robots. */
export function pageMetadata(
  page: PageSeo,
  site: SiteSeo = CODE_SITE_SEO,
  policy: SeoPolicy = sitePolicy(),
): Metadata {
  const index = policy.indexable && !page.noindex;
  const description = page.description?.trim() || site.defaultDescription?.trim() || undefined;
  const ogTitle = page.ogTitle?.trim() || page.title;
  const ogDescription = page.ogDescription?.trim() || description;
  const origin = policy.origin;
  const override = seoCanonicalPathIsValid(page.canonicalPath) ? page.canonicalPath : null;
  const url = origin
    ? canonicalUrl(
        origin,
        override ? localizeHref(page.locale, override) : localePath(page.locale, page.path),
      )
    : undefined;
  const selfCanonical = !override || override === page.path;
  const languages =
    origin && selfCanonical && !page.noindex
      ? hreflangMap(page.locale, page.path, page.alternates ?? [])
      : null;
  const hreflang =
    languages && origin
      ? Object.fromEntries(
          Object.entries(languages).map(([l, href]) => [l, canonicalUrl(origin, href)]),
        )
      : null;
  const alternateLocale = languages
    ? Object.keys(languages)
        .filter((l): l is RouteLocale => isRouteLocale(l) && l !== page.locale)
        .map(ogLocale)
    : [];
  const image =
    origin && site.defaultOgImage
      ? [
          {
            url: site.defaultOgImage.startsWith("/")
              ? canonicalUrl(origin, site.defaultOgImage)
              : site.defaultOgImage,
          },
        ]
      : null;
  return {
    title: page.title,
    ...(description ? { description } : {}),
    ...(url
      ? { alternates: { canonical: url, ...(hreflang ? { languages: hreflang } : {}) } }
      : {}),
    openGraph: {
      type: "website",
      siteName: site.siteName,
      locale: ogLocale(page.locale),
      ...(alternateLocale.length ? { alternateLocale } : {}),
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      ...(url ? { url } : {}),
      ...(image ? { images: image } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      ...(image ? { images: image.map((i) => i.url) } : {}),
    },
    robots: index ? { index: true, follow: true } : NOINDEX,
  };
}

/** Metadata of a page that must never be indexed (unavailable states, the placeholder home). */
export function noindexMetadata(title: string): Metadata {
  return { title, robots: NOINDEX };
}

// --- API reads ----------------------------------------------------------------------------------

export type Resolve =
  | { status: "found" }
  | { status: "redirect"; target: string; statusCode: 301 | 302; keepQuery?: boolean }
  | { status: "not_found" }
  | { status: "unpublished" }
  | { status: "unknown" };

function unpublishedDetail(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return (
    Array.isArray(details) &&
    details.some(
      (d) =>
        typeof d === "object" && d !== null && (d as { rule?: unknown }).rule === "unpublished",
    )
  );
}

/** The fast existence check of an address (stored form), asked before rendering. */
export async function resolvePath(path: string, search = "", locale?: string): Promise<Resolve> {
  const query = search.replace(/^\?/, "");
  const res = await apiGet(
    `${PUBLIC_SEO_API}/resolve?path=${encodeURIComponent(path)}${
      query ? `&query=${encodeURIComponent(query.slice(0, 2000))}` : ""
    }${locale ? `&locale=${encodeURIComponent(locale)}` : ""}`,
  );
  if (!res) return { status: "unknown" };
  if (res.ok) {
    const parsed = PublicSeoResolveResponseSchema.safeParse(await res.json().catch(() => null));
    if (parsed.success && "redirect" in parsed.data) {
      return { status: "redirect", ...parsed.data.redirect };
    }
    return { status: "found" };
  }
  if (res.status === 404) {
    const body: unknown = await res.json().catch(() => null);
    return { status: unpublishedDetail(body) ? "unpublished" : "not_found" };
  }
  return { status: "unknown" };
}

/** The published SEO defaults of a language (code defaults while unpublished or unreadable). */
export const siteSeo = cache(async (locale: RouteLocale = DEFAULT_LOCALE): Promise<SiteSeo> => {
  const q = locale === DEFAULT_LOCALE ? "" : `?locale=${encodeURIComponent(locale)}`;
  const res = await apiGet(`${PUBLIC_SEO_API}/settings${q}`);
  if (!res?.ok) return CODE_SITE_SEO;
  const parsed = PublicSiteSeoResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("public seo: the settings response does not match the contract");
    return CODE_SITE_SEO;
  }
  return parsed.data.settings ?? CODE_SITE_SEO;
});

/** The indexable live addresses of the site; null when the API cannot answer. */
export async function sitemapEntries(): Promise<PublicSitemapEntry[] | null> {
  const res = await apiGet(`${PUBLIC_SEO_API}/sitemap`);
  if (!res?.ok) return null;
  const parsed = PublicSitemapResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("public seo: the sitemap response does not match the contract");
    return null;
  }
  return parsed.data.entries;
}
