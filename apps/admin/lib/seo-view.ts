/**
 * DP-209: what the admin's SEO previews show, computed the way the BV site does it
 * (apps/web-bv/lib/seo.ts pageMetadata): the same fallbacks, the same canonical rule. Pure
 * functions, unit-tested; the site remains the authority for what is rendered.
 */
import {
  canonicalUrl,
  seoCanonicalPathIsValid,
  seoLengthWarning,
  seoLocalePath,
  type SeoTextField,
} from "@dream/contracts";

/** ML-5: the BV site's default language; its addresses carry the `/en` prefix (ADR-028 D3). */
export const BV_DEFAULT_LOCALE = "en";

/** The site defaults while `bv.site-seo` is not published (the site's code defaults). */
export const CODE_SITE_SEO = {
  // i18n-ignore: the site's name (data, the code default of the bv.site-seo fragment)
  siteName: "Dream Petroleum BV",
  // i18n-ignore: the site's name (data, the code default of the bv.site-seo fragment)
  defaultTitle: "Dream Petroleum BV",
  defaultDescription: null as string | null,
  defaultOgImage: "/media/ctl-technology/clear-base-oil.webp",
};
export type SiteSeoDefaults = typeof CODE_SITE_SEO;

/**
 * The defaults of a site from its published settings (the code defaults while none). COM-1: a site
 * without a default image (the corporate site) previews without one ("").
 */
export function siteSeoDefaultsOf(
  live: {
    siteName: string;
    defaultTitle: string;
    defaultDescription: string;
    defaultOgImage: string | null;
  } | null,
): SiteSeoDefaults {
  return live ? { ...live, defaultOgImage: live.defaultOgImage ?? "" } : CODE_SITE_SEO;
}

/** An image of a preview: a site path is loaded from the site's origin, other URLs as they are. */
export function previewImageSrc(url: string, origin: string | null): string | null {
  if (url === "") return null;
  if (!url.startsWith("/")) return url;
  return origin ? `${origin}${url}` : null;
}

export interface SeoDraft {
  /** The page's own address on the site, inside its language ("/about-us"). */
  path: string;
  /**
   * ML-5: the page's language; the preview shows the public address with its prefix
   * (`/en/about-us`, `/nl/over-ons`, COM-1 `/tr/...` on the corporate site) as the site renders
   * it. Default: English. null: an address without a language prefix.
   */
  locale?: string | null;
  /** The page's name: the title when no SEO title is set (CMS pages) or the product name. */
  fallbackTitle: string;
  /** The description when no meta description is set (article summary, product summary). */
  fallbackDescription?: string | null;
  title: string;
  description: string;
  canonicalPath: string;
  noindex: boolean;
  ogTitle: string;
  ogDescription: string;
  /** Site path or absolute URL of the chosen OG image, or null. */
  ogImageUrl: string | null;
  /** The page's own image (product cover, article cover) before the site default. */
  pageImageUrl?: string | null;
}

export interface SeoView {
  title: string;
  description: string | null;
  canonical: { url: string | null; path: string; override: boolean; invalid: boolean };
  ogTitle: string;
  ogDescription: string | null;
  ogImageUrl: string;
  /** Where each value comes from, for the hints. */
  sources: { title: "own" | "fallback"; description: "own" | "fallback" | "site" | "none" };
  warnings: { field: SeoTextField; text: string }[];
}

export function seoView(d: SeoDraft, site: SiteSeoDefaults, origin: string | null): SeoView {
  const title = d.title.trim() || d.fallbackTitle;
  const ownDescription = d.description.trim();
  const description =
    ownDescription || d.fallbackDescription?.trim() || site.defaultDescription?.trim() || null;
  const override = d.canonicalPath.trim();
  const valid = override === "" || seoCanonicalPathIsValid(override);
  const inLocale = override && valid ? override : d.path;
  const locale = d.locale === undefined ? BV_DEFAULT_LOCALE : d.locale;
  const path = locale ? seoLocalePath(locale, inLocale) : inLocale;
  const warnings: SeoView["warnings"] = [];
  const add = (field: SeoTextField, value: string) => {
    const text = seoLengthWarning(field, value);
    if (text) warnings.push({ field, text });
  };
  add("title", title);
  add("description", description ?? "");
  add("ogTitle", d.ogTitle);
  add("ogDescription", d.ogDescription);
  return {
    title,
    description,
    canonical: {
      url: origin ? canonicalUrl(origin, path) : null,
      path,
      override: override !== "" && valid,
      invalid: !valid,
    },
    ogTitle: d.ogTitle.trim() || title,
    ogDescription: d.ogDescription.trim() || description,
    ogImageUrl: d.ogImageUrl ?? d.pageImageUrl ?? site.defaultOgImage,
    sources: {
      title: d.title.trim() ? "own" : "fallback",
      description: ownDescription
        ? "own"
        : d.fallbackDescription?.trim()
          ? "fallback"
          : site.defaultDescription?.trim()
            ? "site"
            : "none",
    },
    warnings,
  };
}

/**
 * The address shown in previews: host ("dreampetroleumbv.com"), the origin with its real scheme
 * ("https://dreampetroleumbv.com"; DP-210: "http://localhost:3110" locally, where DP-209 always
 * printed https) and the path as a breadcrumb.
 */
export function displayUrl(
  url: string | null,
  path: string,
): { host: string; origin: string; crumbs: string } {
  let host = "dreampetroleumbv.com";
  let origin = `https://${host}`;
  if (url) {
    try {
      const parsed = new URL(url);
      host = parsed.host;
      origin = `${parsed.protocol}//${parsed.host}`;
    } catch {
      /* keep the default */
    }
  }
  const crumbs = path.split("/").filter(Boolean).join(" › ");
  return { host, origin, crumbs };
}
