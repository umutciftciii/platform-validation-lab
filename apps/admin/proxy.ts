// Next.js request proxy (formerly "middleware"). Optimistic gate only: without the admin session
// cookie, protected pages redirect to /login before any HTML is rendered. The API decides whether
// a cookie is valid (lib/server-session.ts); this file never reads or forwards its value.
import { ADMIN_SESSION_COOKIE } from "@dream/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, needsLoginRedirect, PATHNAME_HEADER } from "./lib/route-guard";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (needsLoginRedirect(pathname, request.cookies.has(ADMIN_SESSION_COOKIE))) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }
  // DP-172: the console layout needs the path (review-only users); always our own value.
  const forwarded = new Headers(request.headers);
  forwarded.set(PATHNAME_HEADER, pathname);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
