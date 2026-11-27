/**
 * COM-1: how `proxy.ts` hands an unknown address to the site's 404 (`app/global-not-found.tsx`):
 * a rewrite to an address no route matches, with the requested address's language in a request
 * header the proxy always overwrites (as web-bv, ML-3).
 */
export const NOT_FOUND_TARGET = "/__dp/not-found/page";
export const NOT_FOUND_LOCALE_HEADER = "x-dp-not-found-locale";
