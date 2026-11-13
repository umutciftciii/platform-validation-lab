// Next.js request proxy (formerly "middleware"). Optimistic gate only: without the admin session
// cookie, protected pages redirect to /login before any HTML is rendered. The API decides whether
// a cookie is valid (lib/server-session.ts); this file never reads or forwards its value.
import { ADMIN_SESSION_COOKIE } from "@dream/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, needsLoginRedirect } from "./lib/route-guard";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (needsLoginRedirect(pathname, request.cookies.has(ADMIN_SESSION_COOKIE))) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
