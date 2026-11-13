/**
 * Clickjacking protection for the admin console (DP-014). No admin page, sign-in form or proxy
 * response may be framed, not even by the console's own origin: `frame-ancestors 'none'` for
 * current browsers, `X-Frame-Options: DENY` for older ones. Applied to every path through
 * `headers()` in next.config.ts, which also covers redirects from proxy.ts and Route Handlers.
 *
 * Only `frame-ancestors` is set here: a full Content-Security-Policy (scripts, styles, nonces)
 * is a separate piece of work and must not ride along with this fix.
 */
export const FRAME_PROTECTION_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

/** Every path of the app, including `/`, `/_next/*` and `/api/*`. */
export const ALL_PATHS = "/:path*";

/**
 * Credential link pages `/enrol` and `/reset` (DP-114). The token is only in the fragment, which
 * browsers never send; these headers add depth: no Referer leaves the page, and no copy of the
 * page or its state is kept in a cache.
 */
export const CREDENTIAL_LINK_PATHS: readonly string[] = ["/enrol", "/reset"];
export const CREDENTIAL_LINK_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store, max-age=0" },
];
