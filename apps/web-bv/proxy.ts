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
 */
import { NextResponse, type NextRequest } from "next/server";

import { sitePrivacy } from "@/lib/privacy";
import { resolvePath } from "@/lib/seo";

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

export const config = {
  matcher: ["/:slug", "/news/:slug", "/products/:slug"],
};

function notFound(request: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const parts = request.nextUrl.pathname.split("/").slice(1);

  if (parts.length === 1) {
    const [slug = ""] = parts;
    if (slug === "privacy") return sitePrivacy().publish ? NextResponse.next() : notFound(request);
    // Files (favicon.ico, robots.txt, sitemap.xml, public/*) and the app's own pages.
    if (slug.includes(".") || APP_ROUTES.has(slug)) return NextResponse.next();
    if (!SEGMENT.test(slug)) return notFound(request);
  } else if (parts.length === 2) {
    const [section = "", slug = ""] = parts;
    if (section !== "news" && section !== "products") return NextResponse.next();
    if (!SEGMENT.test(slug)) return notFound(request);
  } else {
    return NextResponse.next();
  }

  const res = await resolvePath(request.nextUrl.pathname);
  if (res.status === "not_found") return notFound(request);
  // Only an article has a "no longer available" page; a page or product taken off is a 404.
  if (res.status === "unpublished" && parts[0] !== "news") return notFound(request);
  return NextResponse.next();
}
