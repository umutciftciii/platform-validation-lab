/**
 * DP-119: the admin console signs in with `__Host-` cookies, which browsers keep only on a
 * secure origin. Chrome and Firefox treat http://localhost as secure; Safari does not, so over
 * plain http (local development) it silently drops the sign-in cookies and the second step looks
 * "expired". This probe sets and removes a throwaway cookie with the same attributes to tell the
 * person before they try. It carries no value of any account.
 */
import { en } from "./i18n/messages/en";

const PROBE = "__Host-dp_cookie_probe";

export interface CookieJar {
  cookie: string;
}

/** True when this browser refuses the Secure, `__Host-` cookies the sign-in needs. */
export function secureCookiesBlocked(doc: CookieJar): boolean {
  try {
    doc.cookie = `${PROBE}=1; Path=/; Secure; SameSite=Strict`;
    const kept = doc.cookie.split(/;\s*/).includes(`${PROBE}=1`);
    if (kept) doc.cookie = `${PROBE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`;
    return !kept;
  } catch {
    return true;
  }
}

/** English text; the sign-in form shows `auth.cookiesBlocked` in the console's language. */
export const COOKIES_BLOCKED_MESSAGE: string = en.auth.cookiesBlocked;
