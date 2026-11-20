/**
 * ML-3 (DP-236, ADR-028 D3): the language prefix of the BV site's public addresses.
 *
 * Two kinds of address meet here:
 *  - the PUBLIC address a visitor sees: `/en/about-us`, `/nl/over-ons`, `/en/products/x`;
 *  - the STORED address the platform API speaks (ML-2, `cmsLocaleAddress` with
 *    `CMS_LOCALE_PREFIX_DEFAULT = false`): the default language without a prefix (`/about-us`),
 *    every other language under its prefix (`/nl/over-ons`). Redirect rows (DP-210/211/212) and
 *    menu targets (DP-219) are stored the same way.
 *
 * The site translates between the two in one place (this module, used by `proxy.ts`, the pages
 * and the link helpers); the API, its data and the redirect rows are unchanged by ML-3.
 *
 * Pure functions only (no Next.js, no fetch, no `@/` imports) so `node --test` runs them as is.
 */

/** The languages the BV site has routes for (code); which of them a visitor sees is data (`public`). */
export const ROUTE_LOCALES = ["en", "nl"] as const;
export type RouteLocale = (typeof ROUTE_LOCALES)[number];

/** The site's default language: its home is the answer to `/` (ADR-028 D3). */
export const DEFAULT_LOCALE: RouteLocale = "en";

/** Open Graph locale per language (ML-5 completes the metadata per language). */
const OG_LOCALES: Record<RouteLocale, string> = { en: "en_GB", nl: "nl_NL" };

/**
 * First segments that are never a page address in a language: framework, API, previews, forms,
 * document and image downloads, static media (as `SEO_INTERNAL_SEGMENTS` in @dream/contracts).
 * A link to them is never given a language prefix.
 */
export const TECHNICAL_SEGMENTS: readonly string[] = [
  "_next",
  "__dp",
  "api",
  "lead-form",
  "media",
  "preview",
  "product-documents",
  "product-images",
];

/** Files the site answers at its root; never prefixed. */
const SITE_FILES: readonly string[] = ["favicon.ico", "robots.txt", "sitemap.xml"];

export function isRouteLocale(value: unknown): value is RouteLocale {
  return typeof value === "string" && (ROUTE_LOCALES as readonly string[]).includes(value);
}

/** The `og:locale` of a language. */
export function ogLocale(locale: RouteLocale): string {
  return OG_LOCALES[locale];
}

/** Splits `/nl/over-ons` into the language and the path inside it (`/over-ons`); null without a prefix. */
export function splitLocale(pathname: string): { locale: RouteLocale; rest: string } | null {
  const first = pathname.split("/")[1] ?? "";
  if (!isRouteLocale(first)) return null;
  const rest = pathname.slice(first.length + 1);
  if (rest !== "" && !rest.startsWith("/")) return null;
  return { locale: first, rest: rest === "" ? "/" : rest };
}

/** The public address of a site path in a language: `("en", "/") → "/en"`, `("nl", "/x") → "/nl/x"`. */
export function localePath(locale: RouteLocale, path: string): string {
  if (!path.startsWith("/")) throw new Error(`localePath: not a site path: ${path}`);
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Splits an href into its path and the rest (`?query` and/or `#hash`). */
function splitHref(href: string): { path: string; tail: string } {
  const cut = href.search(/[?#]/);
  return cut === -1 ? { path: href, tail: "" } : { path: href.slice(0, cut), tail: href.slice(cut) };
}

/**
 * The href a page in `locale` links with. Only addresses of the site's pages get the prefix:
 * external links, `mailto:`/`tel:`, same-page anchors, technical endpoints, site files and
 * addresses that already carry a language prefix stay as written. Used for hard-coded links and
 * for the links inside CMS content and menus (which are stored without the default prefix).
 */
export function localizeHref(locale: RouteLocale, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return href;
  const { path, tail } = splitHref(href);
  const first = path.split("/")[1] ?? "";
  if (TECHNICAL_SEGMENTS.includes(first) || SITE_FILES.includes(first)) return href;
  if (isRouteLocale(first)) return href;
  return `${localePath(locale, path === "" ? "/" : path)}${tail}`;
}

/**
 * The stored address of a page in a language (what the API's `seo/resolve` and redirect rows
 * use): the default language without a prefix, any other under it (`cmsLocaleAddress`).
 */
export function storedAddress(locale: RouteLocale, rest: string): string {
  return locale === DEFAULT_LOCALE ? rest : localePath(locale, rest);
}

/**
 * The public address of a redirect target stored by the API (DP-210/211/212 rows: `/about-us`,
 * `/products?category=x`, `/nl/over-ons`, or an https URL). A site path without a language prefix
 * is an address of the default language and gets its prefix, so the visitor reaches the final
 * address in ONE hop instead of `/en/old → /new → /en/new`. Absolute URLs stay as they are.
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
 * Deep copy of a view (CMS page, menu, footer, home sections) with every internal link prefixed
 * for `locale`: every string property whose name ends with `href`/`Href` is passed through
 * `localizeHref`. Text, images and other fields are untouched.
 */
export function localizeLinks<T>(value: T, locale: RouteLocale): T {
  return walk(value, locale) as T;
}

function walk(value: unknown, locale: RouteLocale): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, locale));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = typeof v === "string" && /href$/i.test(key) ? localizeHref(locale, v) : walk(v, locale);
  }
  return out;
}

// --- language switcher (ADR-028 D3/D7) ----------------------------------------------------------

export interface LanguageOption {
  locale: RouteLocale;
  /** The language's own name, as a visitor of that language reads it. */
  label: string;
  href: string;
  current: boolean;
}

const LANGUAGE_NAMES: Record<RouteLocale, string> = { en: "English", nl: "Nederlands" };

/**
 * The options of the language switcher: only languages that are public on the site (data), in
 * route order. A language goes to the counterpart of the current page when one is published in it
 * (`alternates`, public addresses), otherwise to that language's home; never to a guessed address.
 * With fewer than two public languages there is nothing to switch (empty list: the switcher is
 * hidden). Never used for automatic redirects.
 */
export function languageOptions(
  current: RouteLocale,
  publicLocales: readonly string[],
  alternates: Partial<Record<RouteLocale, string>> = {},
): LanguageOption[] {
  const visible = ROUTE_LOCALES.filter((l) => publicLocales.includes(l));
  if (visible.length < 2 || !visible.includes(current)) return [];
  return visible.map((locale) => ({
    locale,
    label: LANGUAGE_NAMES[locale],
    href: alternates[locale] ?? localePath(locale, "/"),
    current: locale === current,
  }));
}
