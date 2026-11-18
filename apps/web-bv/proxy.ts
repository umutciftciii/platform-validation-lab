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
 *  - `/privacy` where the policy is not published (production while it is a draft, DP-095).
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
 */
import { NextResponse, type NextRequest } from "next/server";

import { SEO_INTERNAL_SEGMENTS, seoLegacyPath, seoRedirectLocation } from "@dream/contracts";

import { sitePrivacy } from "@/lib/privacy";
import { resolvePath, sitePolicy } from "@/lib/seo";

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** First segments the app serves itself; never a CMS page (the CMS refuses these slugs). */
const APP_ROUTES = new Set([
  "api",
  "lead-form",
  "news",
  "preview",
  "privacy",
  "product-documents",
  "product-images",
  "products",
]);
/** No route serves this address, so Next answers with the not-found page and status 404. */
const NOT_FOUND_TARGET = "/__dp/not-found";
/** DP-212: file names an old page address may end with (other extensions are files, not pages). */
const LEGACY_PAGE_FILE = /\.(?:html?|php|aspx?|pdf)$/i;

export const config = {
  // DP-212: every address except the framework, the API, previews, forms, documents, images and
  // static media; the proxy itself decides which ones need an API call (most need none).
  matcher: [
    "/((?!_next/|__dp/|api/|media/|preview/|lead-form/|product-documents/|product-images/).+)",
  ],
};

function notFound(request: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const pathname = request.nextUrl.pathname;
  const parts = pathname.split("/").slice(1);

  if (parts.length === 1) {
    const [slug = ""] = parts;
    if (slug === "privacy") return sitePrivacy().publish ? NextResponse.next() : notFound(request);
    // The app's own pages, and files (favicon.ico, robots.txt, sitemap.xml) unless they look like
    // an old page address (`/index.html`).
    if (APP_ROUTES.has(slug)) return NextResponse.next();
    if (slug.includes(".") && !LEGACY_PAGE_FILE.test(slug)) return NextResponse.next();
    if (SEGMENT.test(slug)) return answer(request, pathname, parts);
  } else if (parts.length === 2) {
    const [section = "", slug = ""] = parts;
    if ((section === "news" || section === "products") && SEGMENT.test(slug)) {
      return answer(request, pathname, parts);
    }
  }
  // DP-212: not one of the site's own address forms. An old-site address is looked up (redirect
  // only); anything else, and internals the matcher let through, is left alone or a 404.
  if (SEO_INTERNAL_SEGMENTS.includes(parts[0] ?? "")) return NextResponse.next();
  const legacy = seoLegacyPath(pathname);
  if (!legacy) return notFound(request);
  return answer(request, pathname, parts, true);
}

/** Asks the API about the address and answers the redirect, the 404 or the page. */
async function answer(
  request: NextRequest,
  pathname: string,
  parts: string[],
  legacy = false,
): Promise<NextResponse> {
  const res = await resolvePath(pathname, undefined, request.nextUrl.search);
  if (res.status === "redirect") {
    // The public origin (as in canonical URLs) when configured, otherwise the request's own.
    const base = sitePolicy().origin ?? request.url;
    const location = new URL(
      seoRedirectLocation(res.target, request.nextUrl.search, res.keepQuery ?? true),
      base,
    );
    return NextResponse.redirect(location, res.statusCode);
  }
  if (res.status === "not_found") return notFound(request);
  // An old-site address never renders a page of its own: without a redirect (or while the API
  // cannot answer) it is the site's 404, as before DP-212.
  if (legacy) return notFound(request);
  // Only an article has a "no longer available" page; a page or product taken off is a 404.
  if (res.status === "unpublished" && parts[0] !== "news") return notFound(request);
  return NextResponse.next();
}
