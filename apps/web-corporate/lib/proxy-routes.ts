/**
 * COM-1: the address forms `proxy.ts` tells apart before a corporate page renders, and the
 * redirect decision. The rules of the BV site (apps/web-bv/lib/proxy-routes.ts: DP-207, DP-210,
 * DP-211, DP-212, ML-3, ML-4), without the catalogue, news and document forms the corporate site
 * does not have yet (its news list comes with COM-3):
 *
 *  - `root`: `/` answers ONE 301 to the default language's home (`/en`); never Accept-Language.
 *  - `home`: `/en`, `/tr`.
 *  - `content`: `/<l>/<slug>`, asked to the SEO resolve API with the STORED address (`/about-us`
 *    in the default language, `/hakkimizda` + `locale=tr` otherwise): live, a redirect (DP-210
 *    slug change, DP-211 manual or imported row), unpublished or nothing.
 *  - `privacy`: `/<l>/privacy` where the policy is published in that language.
 *  - `unprefixed`: one of the forms above without a prefix (`/about-us`, `/privacy`): one 301 to
 *    the same address in the default language (query kept).
 *  - `legacy` (DP-212): any other address the old site may have used (`/ru/…`, `/index.html`,
 *    upper case, deeper paths): an imported or manual redirect only, otherwise 404. The old
 *    site's own mapping is COM-6.
 *  - `next`: the app's internals and root files; `not-found`.
 *
 * A language that is not public is a 404 under its whole prefix (ADR-028 D14). Every redirect is
 * followed to its final address and answered in one hop; a cycle or an over-long chain is refused
 * with the 404 the address would have without it (ADR-028 D5, R-37). Live content always wins
 * over a redirect row (the API answers it first).
 *
 * Pure functions (no Next.js, no fetch, no `@/` imports): the API reads come in as `ProxyDeps`.
 */
import { seoLegacyPath, seoRedirectLocation } from "@dream/contracts";

import {
  DEFAULT_LOCALE,
  TECHNICAL_SEGMENTS,
  isRouteLocale,
  localePath,
  publicRedirectTarget,
  storedAddress,
  type RouteLocale,
} from "./locale-routing.ts";

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** File names an old page address may end with (other extensions are files, not pages). */
const LEGACY_PAGE_FILE = /\.(?:html?|php|aspx?|pdf)$/i;
/** Two-letter first segments are reserved for languages (the CMS refuses them as slugs). */
const LANGUAGE_LIKE = /^[a-z]{2}$/;

/** At most this many redirects are followed to find the final address of a chain. */
export const MAX_HOPS = 4;

export type ProxyRoute =
  | { kind: "next" }
  | { kind: "root" }
  | { kind: "home"; locale: RouteLocale }
  | { kind: "privacy"; locale: RouteLocale }
  | { kind: "content"; locale: RouteLocale; rest: string }
  | { kind: "unprefixed"; rest: string }
  | { kind: "legacy"; locale: RouteLocale }
  | { kind: "not-found"; locale: RouteLocale };

type OwnForm = { kind: "home" } | { kind: "privacy" } | { kind: "content" } | null;

function ownForm(rest: string): OwnForm {
  if (rest === "/") return { kind: "home" };
  const parts = rest.split("/").slice(1);
  if (parts.length !== 1) return null;
  const [slug = ""] = parts;
  if (slug === "privacy") return { kind: "privacy" };
  if (SEGMENT.test(slug) && !LANGUAGE_LIKE.test(slug)) return { kind: "content" };
  return null;
}

export function classifyPath(pathname: string): ProxyRoute {
  if (pathname === "/") return { kind: "root" };
  const parts = pathname.split("/").slice(1);
  const first = parts[0] ?? "";
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
    if (form.kind === "home") return { kind: "home", locale };
    if (form.kind === "privacy") return { kind: "privacy", locale };
    return { kind: "content", locale, rest };
  }
  const form = ownForm(pathname);
  if (form !== null) return { kind: "unprefixed", rest: pathname };
  return seoLegacyPath(pathname)
    ? { kind: "legacy", locale: DEFAULT_LOCALE }
    : { kind: "not-found", locale: DEFAULT_LOCALE };
}

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
  /** DP-095: whether the privacy policy is published in this environment. */
  privacyPublished: boolean;
  /** DP-298: the languages whose legal texts are published. */
  privacyLocales: readonly RouteLocale[];
  /** Called when a redirect cycle or an over-long chain was refused (logged by the caller). */
  onLoop?(trail: readonly string[]): void;
}

export type ProxyDecision =
  | { action: "next" }
  | { action: "redirect"; location: string; status: 301 | 302 }
  | { action: "not-found"; locale: RouteLocale };

async function localeIsPublic(locale: RouteLocale, deps: ProxyDeps): Promise<boolean> {
  if (locale === DEFAULT_LOCALE) return true;
  const visible = await deps.publicLocales();
  return visible !== null && visible.includes(locale);
}

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
  if (!(await localeIsPublic(locale, deps))) return { action: "not-found", locale };
  switch (route.kind) {
    case "home":
      return { action: "next" };
    case "privacy":
      return deps.privacyPublished && deps.privacyLocales.includes(locale)
        ? { action: "next" }
        : { action: "not-found", locale };
    case "legacy": {
      const res = await deps.resolve(pathname, search);
      return res.status === "redirect"
        ? redirectStep(res, search)
        : { action: "not-found", locale };
    }
    case "content": {
      const res =
        locale === DEFAULT_LOCALE
          ? await deps.resolve(storedAddress(locale, route.rest), search)
          : await deps.resolve(route.rest, search, locale);
      if (res.status === "redirect") return redirectStep(res, search);
      // Fail open while the API cannot answer: the page renders and does its own checks (DP-207).
      if (res.status === "found" || res.status === "unknown") return { action: "next" };
      if (locale === DEFAULT_LOCALE) {
        // An old address in this form (`/en/contact-us`) may have a row of its own.
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
 * The page, the site's 404 or ONE redirect to the final address (followed through `step`, at most
 * `MAX_HOPS`; 302 when any hop is temporary). A cycle back to the request is refused (404 +
 * `onLoop`); a cycle further on ends the chain at its first address.
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
    if (!next) break;
    const key = `${next.pathname}${next.search}`;
    trail.push(key);
    if (key === start) {
      deps.onLoop?.(trail);
      return { action: "not-found", locale: ownLocale };
    }
    if (seen.has(key)) break;
    seen.add(key);
    const answer = await step(next.pathname, next.search, deps);
    if (answer.action !== "redirect") break;
    if (hop >= MAX_HOPS) {
      deps.onLoop?.([...trail, answer.location]);
      return { action: "not-found", locale: ownLocale };
    }
    location = answer.location;
    permanent = permanent && answer.status === 301;
  }
  return { action: "redirect", location, status: permanent ? 301 : 302 };
}

const TRAILING_SLASH = /^((?:\/[^/]+)+)\/$/;

/** Addresses the proxy never decides (kept equal to the matcher in proxy.ts, tested there). */
export const TECHNICAL_PREFIXES: readonly string[] = ["/_next/", "/__dp/", "/api/", "/media/"];

export type RequestDecision = ProxyDecision | { action: "redirect"; location: string; status: 308 };

/**
 * The whole answer to a request (ML-4 rule): without a trailing slash `decide` (GET/HEAD; other
 * methods pass); with one the 308 Next would answer, unless the address without the slash
 * redirects itself (then that redirect at once, one hop).
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
