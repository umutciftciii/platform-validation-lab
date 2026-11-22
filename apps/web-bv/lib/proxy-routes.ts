/**
 * The address forms `proxy.ts` tells apart before a page renders (DP-207, DP-212, DP-220) and,
 * since ML-3 (DP-236, ADR-028 D3/D5), the language prefix and the redirect decision itself.
 *
 * Pure functions (no Next.js, no fetch) so the routing decision is unit-tested on its own; the API
 * reads come in as `ProxyDeps`.
 *
 * Address forms (the language prefix is `/en` or `/nl`, see lib/locale-routing.ts):
 *  - `root`: `/` answers ONE 301 to `/en` (the old site's own behaviour; no Accept-Language).
 *  - `home`: `/en`, `/nl`.
 *  - `content`: `/<l>/<slug>`, `/<l>/news/<slug>`, `/<l>/products/<slug>`: asked to the SEO
 *    resolve API with the STORED address (`/about-us` for English, `/over-ons` + `locale=nl`).
 *  - `list`: `/<l>/news`, `/<l>/products` (app pages).
 *  - `privacy`: `/<l>/privacy`.
 *  - `document-request` (DP-220): `/<l>/products/<slug>/documents/<uuid>`.
 *  - `unprefixed`: one of the forms above without a prefix (`/about-us`, `/products/x`,
 *    `/privacy`): one 301 to the same address under `/en` (query kept). Never a database row.
 *  - `legacy` (DP-212): any other address the old site may have used (`/tr/…`, `/index.html`,
 *    `/en/blog_detail/…`, upper case): redirect only, otherwise 404.
 *  - `next`: the app's internals and root files; `not-found`.
 *
 * Redirect safety (ADR-028 D5, R-37): every redirect the proxy answers is computed by `decide`,
 * which (1) gives a stored target its public address (`/about-us` → `/en/about-us`) so the
 * visitor gets one hop, (2) follows the target through the same rules up to `MAX_HOPS` and answers
 * the final address in one hop (a chain is never served), and (3) refuses a cycle: a redirect that
 * comes back to an address it already passed (the DP-212 row `/en/about-us → /about-us` meets the
 * ML-3 rule `/about-us → /en/about-us`) is answered with the 404 the address would have without
 * the row, and logged. Live content always wins over a row (the API answers it first).
 */
import { seoLegacyPath, seoRedirectLocation, type PublicDocument } from "@dream/contracts";

import {
  DEFAULT_LOCALE,
  ROUTE_LOCALES,
  TECHNICAL_SEGMENTS,
  isRouteLocale,
  localePath,
  publicRedirectTarget,
  storedAddress,
  type RouteLocale,
} from "./locale-routing.ts";

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A document id as the API writes it (lower-case UUID); anything else is no document. */
const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** As the catalogue API (`getProductDocuments`) accepts a product slug. */
const PRODUCT_SLUG_MAX = 120;
/** DP-212: file names an old page address may end with (other extensions are files, not pages). */
const LEGACY_PAGE_FILE = /\.(?:html?|php|aspx?|pdf)$/i;
/** Two-letter first segments are reserved for languages (the CMS refuses them as slugs). */
const LANGUAGE_LIKE = /^[a-z]{2}$/;

/**
 * Languages whose catalogue and privacy policy exist on the site. ML-8c (DP-239): the catalogue
 * has routes in every language; what a language shows is data (the products published in it,
 * answered by the API only while the language is public), so a Dutch product without its own
 * text is a 404, never English content under a Dutch address (D7). The Dutch policy comes with
 * its own approval (ADR-028 D12); until then `/nl/privacy` is a 404.
 */
export const CATALOGUE_LOCALES: readonly RouteLocale[] = ROUTE_LOCALES;
export const PRIVACY_LOCALES: readonly RouteLocale[] = ["en"];

/** At most this many redirects are followed to find the final address of a chain. */
export const MAX_HOPS = 4;

export type ProxyRoute =
  | { kind: "next" }
  | { kind: "root" }
  | { kind: "home"; locale: RouteLocale }
  | { kind: "list"; locale: RouteLocale; section: "news" | "products" }
  | { kind: "privacy"; locale: RouteLocale }
  | { kind: "content"; locale: RouteLocale; rest: string }
  | { kind: "document-request"; locale: RouteLocale; slug: string; id: string }
  | { kind: "unprefixed"; rest: string }
  | { kind: "legacy"; locale: RouteLocale }
  | { kind: "not-found"; locale: RouteLocale };

/** The site's own address forms inside a language (`rest` starts with "/"). */
type OwnForm =
  | { kind: "home" }
  | { kind: "list"; section: "news" | "products" }
  | { kind: "privacy" }
  | { kind: "content" }
  | { kind: "document-request"; slug: string; id: string }
  | { kind: "malformed" }
  | null;

function ownForm(rest: string): OwnForm {
  if (rest === "/") return { kind: "home" };
  const parts = rest.split("/").slice(1);
  if (parts.length === 1) {
    const [slug = ""] = parts;
    if (slug === "privacy") return { kind: "privacy" };
    if (slug === "news" || slug === "products") return { kind: "list", section: slug };
    if (SEGMENT.test(slug) && !LANGUAGE_LIKE.test(slug)) return { kind: "content" };
  } else if (parts.length === 2) {
    const [section = "", slug = ""] = parts;
    if ((section === "news" || section === "products") && SEGMENT.test(slug)) {
      return { kind: "content" };
    }
  } else if (parts.length === 4 && parts[0] === "products" && parts[2] === "documents") {
    // DP-220: only the exact form; a malformed slug or id is no document of this site (a 404,
    // never an old-site lookup).
    const [, slug = "", , id = ""] = parts;
    if (SEGMENT.test(slug) && slug.length <= PRODUCT_SLUG_MAX && DOCUMENT_ID.test(id)) {
      return { kind: "document-request", slug, id };
    }
    return { kind: "malformed" };
  }
  return null;
}

export function classifyPath(pathname: string): ProxyRoute {
  if (pathname === "/") return { kind: "root" };
  const parts = pathname.split("/").slice(1);
  const first = parts[0] ?? "";

  // Internals the matcher let through and root files (favicon.ico, robots.txt, sitemap.xml)
  // unless they look like an old page address (`/index.html`).
  if (TECHNICAL_SEGMENTS.includes(first)) return { kind: "next" };
  if (parts.length === 1 && first.includes(".") && !LEGACY_PAGE_FILE.test(first)) {
    return { kind: "next" };
  }

  if (isRouteLocale(first)) {
    const locale = first;
    const rest = pathname.slice(first.length + 1) || "/";
    const form = ownForm(rest);
    if (form === null) {
      return seoLegacyPath(pathname) ? { kind: "legacy", locale } : { kind: "not-found", locale };
    }
    switch (form.kind) {
      case "home":
        return { kind: "home", locale };
      case "list":
        return { kind: "list", locale, section: form.section };
      case "privacy":
        return { kind: "privacy", locale };
      case "content":
        return { kind: "content", locale, rest };
      case "document-request":
        return { kind: "document-request", locale, slug: form.slug, id: form.id };
      case "malformed":
        return { kind: "not-found", locale };
    }
  }

  // No language prefix: the site's own forms move to English in one hop; anything else is an
  // old-site address (DP-212) or nothing.
  const form = ownForm(pathname);
  if (form?.kind === "malformed") return { kind: "not-found", locale: DEFAULT_LOCALE };
  if (form !== null) return { kind: "unprefixed", rest: pathname };
  return seoLegacyPath(pathname)
    ? { kind: "legacy", locale: DEFAULT_LOCALE }
    : { kind: "not-found", locale: DEFAULT_LOCALE };
}

/** The catalogue read of a product's documents, as `getProductDocuments` returns it. */
export type DocumentsRead =
  | { ok: true; data: Pick<PublicDocument, "id" | "requestable">[] }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * DP-220: the request form exists only for a document the product page lists as `requestable`
 * (the same rule the page applies, so the status matches what it renders). An unknown or
 * unpublished product, an unknown document and one without a form (public, members-only) are a
 * real 404. While the API cannot answer, the page renders and does its own checks (fail open, as
 * DP-207). No document access changes here: the form, the grant and the file stay as DP-042.
 */
export function documentRequestStatus(docs: DocumentsRead, id: string): "page" | "not_found" {
  if (!docs.ok) return docs.reason === "not_found" ? "not_found" : "page";
  return docs.data.some((d) => d.id === id && d.requestable) ? "page" : "not_found";
}

// --- the decision -------------------------------------------------------------------------------

/** The SEO resolve answer (lib/seo.ts `Resolve`). */
export type ResolveAnswer =
  | { status: "found" }
  | { status: "redirect"; target: string; statusCode: 301 | 302; keepQuery?: boolean }
  | { status: "not_found" }
  | { status: "unpublished" }
  | { status: "unknown" };

export interface ProxyDeps {
  /** `GET /seo/resolve` with a stored address (and the language when it is not the default). */
  resolve(path: string, search: string, locale?: RouteLocale): Promise<ResolveAnswer>;
  /** The public languages of the site; null while the API cannot answer. */
  publicLocales(): Promise<readonly string[] | null>;
  /** ML-8c: the documents of a product published in `locale` (404 when it is not). */
  documents(slug: string, locale: RouteLocale): Promise<DocumentsRead>;
  /**
   * ML-8c: whether the catalogue of a language other than the default one has a product now
   * ("unknown" while the API cannot answer: the page renders and shows its own notice).
   */
  catalogue(locale: RouteLocale): Promise<"products" | "empty" | "unknown">;
  /** DP-095: whether the privacy policy is published in this environment. */
  privacyPublished: boolean;
  /** Called when a redirect cycle or an over-long chain was refused (logged by the caller). */
  onLoop?(trail: readonly string[]): void;
}

export type ProxyDecision =
  | { action: "next" }
  | { action: "redirect"; location: string; status: 301 | 302 }
  | { action: "not-found"; locale: RouteLocale };

async function localeIsPublic(locale: RouteLocale, deps: ProxyDeps): Promise<boolean> {
  if (locale === DEFAULT_LOCALE) return true;
  // Fail closed for a language other than the default: unknown visibility is not public.
  const visible = await deps.publicLocales();
  return visible !== null && visible.includes(locale);
}

/** A redirect answer of the API as the visitor's next address (public form, query handled). */
function redirectStep(
  res: Extract<ResolveAnswer, { status: "redirect" }>,
  search: string,
): ProxyDecision {
  const location = publicRedirectTarget(
    seoRedirectLocation(res.target, search, res.keepQuery ?? true),
  );
  return { action: "redirect", location, status: res.statusCode };
}

/** One address, one answer: the rules of the site without following redirects. */
export async function step(
  pathname: string,
  search: string,
  deps: ProxyDeps,
): Promise<ProxyDecision> {
  const route = classifyPath(pathname);
  switch (route.kind) {
    case "next":
      return { action: "next" };
    case "root":
      return {
        action: "redirect",
        location: `${localePath(DEFAULT_LOCALE, "/")}${search}`,
        status: 301,
      };
    case "unprefixed":
      return {
        action: "redirect",
        location: `${localePath(DEFAULT_LOCALE, route.rest)}${search}`,
        status: 301,
      };
    case "not-found":
      return { action: "not-found", locale: route.locale };
    default:
      break;
  }

  const locale = route.locale;
  // ADR-028 D3/D14: nothing under the prefix of a language that is not public (404, noindex),
  // whatever exists there; signed previews (`/preview/…`) never pass here.
  if (!(await localeIsPublic(locale, deps))) return { action: "not-found", locale };

  switch (route.kind) {
    case "home":
      return { action: "next" };
    case "list": {
      if (route.section === "products" && !CATALOGUE_LOCALES.includes(locale)) {
        return { action: "not-found", locale };
      }
      // ML-8c: the product list of another language exists only while it has a product; an
      // empty Dutch list is a 404 (never an indexable empty page, never the English list).
      if (route.section === "products" && locale !== DEFAULT_LOCALE) {
        if ((await deps.catalogue(locale)) === "empty") return { action: "not-found", locale };
        return { action: "next" };
      }
      // ML-4 (DP-237): a list view with a query may be an old address of the same form with a
      // row bound to that exact query (`/en/products?category=grease`, DP-037 K5). Only such a
      // bound row counts (never a plain row of the list address, never the request itself), and
      // the list renders whenever the API has nothing or cannot answer.
      if (locale === DEFAULT_LOCALE && search !== "" && search !== "?") {
        const res = await deps.resolve(pathname, search);
        if (res.status === "redirect" && res.keepQuery === false) {
          const moved = redirectStep(res, search);
          if (moved.action === "redirect" && moved.location !== `${pathname}${search}`)
            return moved;
        }
      }
      return { action: "next" };
    }
    case "privacy":
      return deps.privacyPublished && PRIVACY_LOCALES.includes(locale)
        ? { action: "next" }
        : { action: "not-found", locale };
    case "document-request": {
      if (!CATALOGUE_LOCALES.includes(locale)) return { action: "not-found", locale };
      // DP-220: the lead form of a requestable document (metadata read only, no file access).
      const docs = await deps.documents(route.slug, locale);
      return documentRequestStatus(docs, route.id) === "page"
        ? { action: "next" }
        : { action: "not-found", locale };
    }
    case "legacy": {
      const res = await deps.resolve(pathname, search);
      if (res.status === "redirect") return redirectStep(res, search);
      // An old-site address never renders a page of its own: without a redirect (or while the
      // API cannot answer) it is the site's 404, as before DP-212.
      return { action: "not-found", locale };
    }
    case "content": {
      const isProduct = route.rest.startsWith("/products/");
      if (isProduct && !CATALOGUE_LOCALES.includes(locale)) return { action: "not-found", locale };
      const res =
        locale === DEFAULT_LOCALE
          ? await deps.resolve(storedAddress(locale, route.rest), search)
          : await deps.resolve(route.rest, search, locale);
      if (res.status === "redirect") return redirectStep(res, search);
      // Fail open while the API cannot answer: the page renders and does its own checks (DP-207).
      if (res.status === "found" || res.status === "unknown") return { action: "next" };
      // Only an article has a "no longer available" page; a page or product taken off is a 404.
      if (res.status === "unpublished" && route.rest.startsWith("/news/"))
        return { action: "next" };
      if (locale === DEFAULT_LOCALE) {
        // DP-212/ML-4: an indexed address of the old site in this form (`/en/contact-us`) may
        // still have a row of its own; asked only when the address has nothing live.
        const old = await deps.resolve(pathname, search);
        if (old.status === "redirect") return redirectStep(old, search);
      }
      return { action: "not-found", locale };
    }
  }
}

function addressOf(location: string): { pathname: string; search: string } | null {
  if (!location.startsWith("/") || location.startsWith("//")) return null;
  const hash = location.indexOf("#");
  const noHash = hash === -1 ? location : location.slice(0, hash);
  const q = noHash.indexOf("?");
  return q === -1
    ? { pathname: noHash, search: "" }
    : { pathname: noHash.slice(0, q), search: noHash.slice(q) };
}

/**
 * The proxy's answer for a request: the page, the site's 404 (with the language of its frame) or
 * ONE redirect to the final address. A redirect target is followed through `step` until it is
 * not a redirect (at most `MAX_HOPS`); the chain is answered in one hop (302 when any hop is
 * temporary). A cycle that comes back to the request is refused: the request gets the 404 it
 * would have without the redirect, and `onLoop` reports the trail. A cycle further on ends the
 * chain at its first address (that address refuses it when it is requested).
 */
export async function decide(
  pathname: string,
  search: string,
  deps: ProxyDeps,
): Promise<ProxyDecision> {
  const first = await step(pathname, search, deps);
  if (first.action !== "redirect") return first;
  const route = classifyPath(pathname);
  const ownLocale = "locale" in route ? route.locale : DEFAULT_LOCALE;

  const start = `${pathname}${search}`;
  const seen = new Set<string>([start]);
  const trail = [start];
  let location = first.location;
  let permanent = first.status === 301;
  for (let hop = 1; ; hop++) {
    const next = addressOf(location);
    // An absolute URL (another host) is the end of the chain.
    if (!next) break;
    const key = `${next.pathname}${next.search}`;
    trail.push(key);
    if (key === start) {
      // The redirect comes back to the request itself: a cycle, refused.
      deps.onLoop?.(trail);
      return { action: "not-found", locale: ownLocale };
    }
    // A cycle further on (the target redirects to itself or back to another target): the visitor
    // gets one hop to the first address of it, which refuses the cycle when it is asked itself.
    if (seen.has(key)) break;
    seen.add(key);
    const answer = await step(next.pathname, next.search, deps);
    if (answer.action !== "redirect") break;
    if (hop >= MAX_HOPS) {
      // Too long to be a real mapping: refused like a cycle (never served as a chain).
      deps.onLoop?.([...trail, answer.location]);
      return { action: "not-found", locale: ownLocale };
    }
    location = answer.location;
    permanent = permanent && answer.status === 301;
  }
  return { action: "redirect", location, status: permanent ? 301 : 302 };
}

/**
 * Next's own trailing-slash rule (`/:path+/` → `/:path+`, 308, query kept; every address, the
 * technical ones too), which `skipTrailingSlashRedirect` (next.config.ts) hands to the proxy.
 */
const TRAILING_SLASH = /^((?:\/[^/]+)+)\/$/;

/** Addresses the proxy never decides (kept equal to the matcher in proxy.ts, tested there). */
export const TECHNICAL_PREFIXES: readonly string[] = [
  "/_next/",
  "/__dp/",
  "/api/",
  "/media/",
  "/preview/",
  "/lead-form/",
  "/product-documents/",
  "/product-images/",
];

export type RequestDecision =
  | ProxyDecision
  /** The trailing-slash normalisation (Next's 308), answered relative to the request. */
  | { action: "redirect"; location: string; status: 308 };

/**
 * ML-4 (DP-237): the whole answer to a request, trailing slash included. Without a trailing slash
 * it is `decide` (GET/HEAD; other methods pass). With one (`/tr/`) the address is normalised as
 * Next did (308 to `/tr`), except when the address without the slash answers a redirect itself:
 * then the visitor gets that redirect at once (`/tr/` → one 301 `/en`, not 308 + 301). Technical
 * addresses and other methods always get the plain 308.
 */
export async function decideRequest(
  pathname: string,
  search: string,
  method: string,
  deps: ProxyDeps,
): Promise<RequestDecision> {
  const read = method === "GET" || method === "HEAD";
  const slash = TRAILING_SLASH.exec(pathname);
  if (!slash) return read ? decide(pathname, search, deps) : { action: "next" };
  const bare = slash[1] as string;
  const normalise = { action: "redirect", location: `${bare}${search}`, status: 308 } as const;
  if (!read || TECHNICAL_PREFIXES.some((p) => `${bare}/`.startsWith(p))) return normalise;
  const answer = await decide(bare, search, deps);
  if (answer.action === "redirect" && answer.location !== `${pathname}${search}`) return answer;
  return normalise;
}
