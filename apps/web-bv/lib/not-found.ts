/**
 * ML-3 (DP-236): how `proxy.ts` hands an unknown address to the site's 404 page
 * (`app/global-not-found.tsx`): a rewrite to an address no route matches, with the language of
 * the requested address in a request header (set by the proxy only; never read from a visitor:
 * the proxy overwrites it on every rewrite, and an invalid value falls back to the default).
 */
export const NOT_FOUND_TARGET = "/__dp/not-found/page";
export const NOT_FOUND_LOCALE_HEADER = "x-dp-not-found-locale";
