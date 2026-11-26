/**
 * DP-207: real HTTP 404 for content addresses (DP-050 finding).
 *
 * The content pages stream (cacheComponents + Suspense), and once streaming starts the status is
 * fixed at 200: a `notFound()` inside the page only renders the not-found UI with noindex (a "soft
 * 404"). So the existence check runs here, before rendering, with one small API read
 * (`GET /api/v1/public/seo/resolve`, no page content). An address without live content is
 * rewritten to an address no route serves, which Next answers with the site's not-found page and
 * status 404; the browser keeps the requested URL.
 *
 *  - `/<slug>` (CMS page), `/news/<slug>` (article), `/products/<slug>` (product).
 *  - `/privacy` where the policy is not published (production while it is a draft, DP-095), or in
 *    a language without published legal texts (DP-298: read from the API, fail closed).
 *  - Fail open: when the API cannot answer, the page renders as before (its own handling).
 *  - An article taken off the site keeps its "no longer available" page (noindex); a page taken
 *    off is a 404 like any unknown address.
 *  - DP-210: an old address of a page, article or product that moved answers 301 (one hop) with
 *    the new address on the site's public origin; the request's query string is kept. Live content always wins (the API
 *    switches a redirect off when content goes live at its source again).
 *  - DP-211: manual and imported redirects of the admin (Admin > SEO > Redirects) answer the same
 *    way with their own status (301 or 302). A redirect bound to a query (`/old?id=5`) matches
 *    only that query and sends its target as is.
 *  - DP-212: addresses of the old site (`/en`, `/en/…`, `/tr/…`, upper case, `.html`, deeper
 *    paths) are asked too (`seoLegacyPath`: lower-case lookup, redirect only, never live content):
 *    an imported redirect answers 301 in one hop, anything else is the site's 404. The site's own
 *    addresses, its internals (`/_next`, `/api`, `/media`, …) and its files are never redirected,
 *    and live content is never overridden (the resolve endpoint answers live content first).
 *  - DP-220: `/products/<slug>/documents/<id>` (the lead form of a lead-gated document) is one of
 *    the site's own addresses, not an old one: it renders where the product lists that document as
 *    requestable and is a 404 otherwise. The address forms are told apart in `lib/proxy-routes.ts`.
 *  - ML-3 (DP-236, ADR-028 D3/D5): every page address carries its language (`/en/…`, `/nl/…`).
 *    `/` answers one 301 to `/en`; an address of the site without a prefix (`/about-us`) one 301
 *    to `/en/about-us` (query kept; never Accept-Language). A language that is not public is a
 *    404 under its whole prefix. Redirect targets stored by the API (`/about-us`) are answered at
 *    their public address in one hop; chains are collapsed and cycles refused (404 + log), see
 *    `decide` in lib/proxy-routes.ts. Technical endpoints are outside the matcher.
 *  - ML-4 (DP-237): the trailing slash. Next's own 308 (`/tr/` → `/tr`) ran before the proxy, so an
 *    old address with a slash needed two hops (308 + 301). `skipTrailingSlashRedirect` hands it to
 *    the proxy (`decideRequest`): the same 308 for every address with a slash (the technical ones
 *    match only for it), except that an address whose slash-less form redirects answers that one
 *    redirect directly (`/tr/` → 301 `/en`).
 *  - ML-8c (DP-239): the catalogue in every public language. `/nl/products/<slug>` is asked to the
 *    resolve API with `locale=nl` (found only for a product published in Dutch), the Dutch list
 *    is a 404 while it has no product, and the document form checks the product in its language.
 *    A language that is not public stays a 404 under its whole prefix, as before.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getProductDocuments, listProducts } from "@/lib/catalog-api";
import type { RouteLocale } from "@/lib/locale-routing";
import { sitePrivacyNow } from "@/lib/legal-texts-api";
import { NOT_FOUND_LOCALE_HEADER, NOT_FOUND_TARGET } from "@/lib/not-found";
import { decideRequest, type ProxyDeps } from "@/lib/proxy-routes";
import { publicLocales } from "@/lib/public-locales";
import { resolvePath, sitePolicy } from "@/lib/seo";

/**
 * No route serves NOT_FOUND_TARGET, so Next answers with `app/global-not-found.tsx` and status
 * 404; the browser keeps the requested URL. The request header names the 404's language.
 */
function notFound(request: NextRequest, locale: RouteLocale): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(NOT_FOUND_LOCALE_HEADER, locale);
  return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url), { request: { headers } });
}

export const config = {
  // DP-212: every address except the framework, the API, previews, forms, documents, images and
  // static media; the proxy itself decides which ones need an API call (most need none).
  // ML-3: "/" too (one 301 to /en).
  // ML-4: every address ending in a slash too (the trailing-slash 308, see decideRequest); the
  // technical prefixes are TECHNICAL_PREFIXES in lib/proxy-routes.ts (tested to match).
  matcher: [
    "/",
    "/((?!_next/|__dp/|api/|media/|preview/|lead-form/|product-documents/|product-images/).+)",
    "/:path+/",
  ],
};

/**
 * DP-298 (ADR-031 D1): the policy's gate and languages come from the API's legal texts snapshot
 * (cached for 30 s, a failed read briefly too, so most requests make no API call for it).
 */
async function deps(): Promise<ProxyDeps> {
  const privacy = await sitePrivacyNow();
  return {
    resolve: (path, search, locale) => resolvePath(path, undefined, search, locale),
    publicLocales,
    documents: (slug, locale) => getProductDocuments(slug, locale),
    catalogue: async (locale) => {
      const list = await listProducts(locale);
      if (list.ok) return list.data.length > 0 ? "products" : "empty";
      return list.reason === "not_found" ? "empty" : "unknown";
    },
    privacyPublished: privacy.gate.publish,
    privacyLocales: privacy.locales,
    onLoop: (trail) =>
      console.error(`proxy: redirect cycle or chain refused (404): ${trail.join(" -> ")}`),
  };
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const decision = await decideRequest(pathname, search, request.method, await deps());
  switch (decision.action) {
    case "next":
      return NextResponse.next();
    case "not-found":
      return notFound(request, decision.locale);
    case "redirect": {
      // The public origin (as in canonical URLs) when configured, otherwise the request's own; the
      // trailing-slash 308 stays on the request's own origin, as Next answered it.
      const base = decision.status === 308 ? request.url : (sitePolicy().origin ?? request.url);
      return NextResponse.redirect(new URL(decision.location, base), decision.status);
    }
  }
}
