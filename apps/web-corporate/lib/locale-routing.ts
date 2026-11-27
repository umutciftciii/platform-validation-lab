/**
 * COM-1: the language prefix of dreampetroleum.com's public addresses (contract 3.2 b: Turkish and
 * English). The same rules as the BV site (apps/web-bv/lib/locale-routing.ts, ML-3, ADR-028 D3):
 *
 *  - the PUBLIC address a visitor sees always carries its language: `/en/about-us`, `/tr/hakkimizda`;
 *  - the STORED address the platform API speaks (ML-2 `cmsLocaleAddress`) has no prefix in the
 *    site's default language (`/about-us`) and the prefix in every other one (`/tr/hakkimizda`).
 *    Redirect rows and menu targets are stored the same way.
 *
 * Which language is the default is data (`Site.defaultLocale`, today English); which languages a
 * visitor may see is data too (`SiteLocale.public`, lib/public-locales.ts). Turkish has routes from
 * COM-1 on and stays a 404 until the owner makes it public (ADR-028 D14).
 *
 * Pure functions only (no Next.js, no fetch, no `@/` imports) so `node --test` runs them as is.
 */

/** The languages the corporate site has routes for, in the order of the language selector. */
export const ROUTE_LOCALES = ["en", "tr"] as const;
export type RouteLocale = (typeof ROUTE_LOCALES)[number];

/** The site's default language (`Site.defaultLocale`): its home answers `/`. */
export const DEFAULT_LOCALE: RouteLocale = "en";

const OG_LOCALES: Record<RouteLocale, string> = { en: "en_GB", tr: "tr_TR" };
const LANGUAGE_NAMES: Record<RouteLocale, string> = { en: "English", tr: "Türkçe" };

/** First segments that are never a page address (framework, API, internal 404 target, media). */
export const TECHNICAL_SEGMENTS: readonly string[] = ["_next", "__dp", "api", "media", "preview"];

/** Files the site answers at its root; never prefixed. */
const SITE_FILES: readonly string[] = ["favicon.ico", "robots.txt", "sitemap.xml"];

export function isRouteLocale(value: unknown): value is RouteLocale {
  return typeof value === "string" && (ROUTE_LOCALES as readonly string[]).includes(value);
}

export function ogLocale(locale: RouteLocale): string {
  return OG_LOCALES[locale];
}

export function languageName(locale: RouteLocale): string {
  return LANGUAGE_NAMES[locale];
}

/** Splits `/tr/hakkimizda` into the language and the path inside it; null without a prefix. */
export function splitLocale(pathname: string): { locale: RouteLocale; rest: string } | null {
  const first = pathname.split("/")[1] ?? "";
  if (!isRouteLocale(first)) return null;
  const rest = pathname.slice(first.length + 1);
  if (rest !== "" && !rest.startsWith("/")) return null;
  return { locale: first, rest: rest === "" ? "/" : rest };
}

/** The public address of a site path in a language: `("en", "/") → "/en"`, `("tr", "/x") → "/tr/x"`. */
export function localePath(locale: RouteLocale, path: string): string {
  if (!path.startsWith("/")) throw new Error(`localePath: not a site path: ${path}`);
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

function splitHref(href: string): { path: string; tail: string } {
  const cut = href.search(/[?#]/);
  return cut === -1
    ? { path: href, tail: "" }
    : { path: href.slice(0, cut), tail: href.slice(cut) };
}

/**
 * The href a page in `locale` links with: only addresses of the site's pages get the prefix;
 * external links, `mailto:`/`tel:`, anchors, technical endpoints, site files and addresses that
 * already carry a language stay as written.
 */
export function localizeHref(locale: RouteLocale, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return href;
  const { path, tail } = splitHref(href);
  const first = path.split("/")[1] ?? "";
  if (TECHNICAL_SEGMENTS.includes(first) || SITE_FILES.includes(first)) return href;
  if (isRouteLocale(first)) return href;
  return `${localePath(locale, path === "" ? "/" : path)}${tail}`;
}

/** The stored address of a page in a language (what `seo/resolve` and redirect rows use). */
export function storedAddress(locale: RouteLocale, rest: string): string {
  return locale === DEFAULT_LOCALE ? rest : localePath(locale, rest);
}

/**
 * The public address of a redirect target stored by the API: a site path without a language is an
 * address of the default language and gets its prefix (one hop for the visitor). Absolute URLs
 * stay as they are.
 */
export function publicRedirectTarget(target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  if (!target.startsWith("/") || target.startsWith("//")) return target;
  const { path } = splitHref(target);
  const first = path.split("/")[1] ?? "";
  if (TECHNICAL_SEGMENTS.includes(first) || SITE_FILES.includes(first)) return target;
  return localizeHref(DEFAULT_LOCALE, target);
}

/**
 * Deep copy of a view with every internal link prefixed for `locale`: every string property whose
 * name ends with `href`/`Href` goes through `localizeHref`; other fields are untouched.
 */
export function localizeLinks<T>(value: T, locale: RouteLocale): T {
  return walk(value, locale) as T;
}

function walk(value: unknown, locale: RouteLocale): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, locale));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      typeof v === "string" && /href$/i.test(key) ? localizeHref(locale, v) : walk(v, locale);
  }
  return out;
}

export interface LanguageOption {
  locale: RouteLocale;
  label: string;
  /** null while the language is not open to visitors. */
  href: string | null;
  current: boolean;
  available: boolean;
}

/**
 * The language selector: every language the site has routes for. A public one goes to the page's
 * published counterpart (`alternates`, public addresses) or to that language's home; one that is
 * not public is listed without a link. Never used for automatic redirects.
 */
export function languageOptions(
  current: RouteLocale,
  publicLocales: readonly string[],
  alternates: Partial<Record<RouteLocale, string>> = {},
): LanguageOption[] {
  return ROUTE_LOCALES.map((locale) => {
    const available = publicLocales.includes(locale);
    return {
      locale,
      label: LANGUAGE_NAMES[locale],
      href: available ? (alternates[locale] ?? localePath(locale, "/")) : null,
      current: locale === current,
      available,
    };
  });
}
