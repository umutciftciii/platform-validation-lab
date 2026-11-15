/**
 * Optimistic routing rule used by proxy.ts (Next.js request proxy). It only checks whether the
 * admin session cookie is present, so a signed-out visitor never receives a protected page's
 * HTML. The real check is the API session lookup in every protected layout and page.
 */
export const LOGIN_PATH = "/login";

/**
 * DP-172: request header with the page's path, set by proxy.ts for the console layout (which
 * sends a review-only user to the company review). Any value a client sends is overwritten.
 */
export const PATHNAME_HEADER = "x-dp-pathname";

/**
 * Paths that never need a session: sign-in, the single-use credential link pages (DP-114: the
 * link is the credential; a redirect to /login would carry its fragment along), API proxy and
 * health, framework and brand assets.
 */
const PUBLIC_PREFIXES = ["/login", "/enrol", "/reset", "/api/", "/_next/", "/brand/"] as const;
const PUBLIC_FILES = new Set(["/favicon.ico", "/robots.txt", "/icon.svg"]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_FILES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function needsLoginRedirect(pathname: string, hasSessionCookie: boolean): boolean {
  return !hasSessionCookie && !isPublicPath(pathname);
}
