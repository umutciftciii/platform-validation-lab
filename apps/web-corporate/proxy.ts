/**
 * COM-1: the address rules of dreampetroleum.com, decided before a page renders (the rules of the
 * BV site's proxy: DP-207 real 404, DP-210/211 redirects, DP-212 old addresses, ML-3 language
 * prefix, ML-4 trailing slash; see lib/proxy-routes.ts):
 *
 *  - `/` answers one 301 to the default language's home (`/en`); an address of the site without a
 *    prefix (`/about-us`) one 301 to `/en/about-us`.
 *  - A language that is not public (`/tr` until the owner opens it) is a 404 under its whole prefix.
 *  - `/<l>/<slug>`: one small API read (`GET /seo/resolve`): live content renders, a redirect
 *    (slug change, manual or imported row of Admin > SEO > Redirects) answers its status in ONE
 *    hop on the site's public origin, anything else is the site's 404 (HTTP 404, noindex).
 *  - Fail open: while the API cannot answer, the page renders and does its own checks.
 */
import { NextResponse, type NextRequest } from "next/server";

import type { RouteLocale } from "@/lib/locale-routing";
import { NOT_FOUND_LOCALE_HEADER, NOT_FOUND_TARGET } from "@/lib/not-found";
import { sitePrivacy } from "@/lib/privacy";
import { decideRequest, type ProxyDeps } from "@/lib/proxy-routes";
import { publicLocales } from "@/lib/public-locales";
import { resolvePath, sitePolicy } from "@/lib/seo";

function notFound(request: NextRequest, locale: RouteLocale): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(NOT_FOUND_LOCALE_HEADER, locale);
  return NextResponse.rewrite(new URL(NOT_FOUND_TARGET, request.url), { request: { headers } });
}

export const config = {
  // Every address except the framework, the API routes and static media; the proxy decides which
  // ones need an API call (most need none). Technical prefixes: TECHNICAL_PREFIXES (tested).
  matcher: ["/", "/((?!_next/|__dp/|api/|media/).+)", "/:path+/"],
};

async function deps(): Promise<ProxyDeps> {
  const privacy = await sitePrivacy();
  return {
    resolve: (path, search, locale) => resolvePath(path, search, locale),
    publicLocales,
    // The gate of this environment (DP-095), read with the default language's texts; each
    // language's page exists where its own texts are published (`privacyLocales`).
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
      const base = decision.status === 308 ? request.url : (sitePolicy().origin ?? request.url);
      return NextResponse.redirect(new URL(decision.location, base), decision.status);
    }
  }
}
