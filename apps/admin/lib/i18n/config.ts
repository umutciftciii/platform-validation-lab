/**
 * Admin console UI language (ML-11, ADR-028 D15). English is the default and the source of every
 * message; Turkish is the second language. This is the language of the console's own text only:
 * it never changes the content language being edited (EN/NL on the BV site), the API's messages
 * or anything a person is allowed to do.
 *
 * The choice lives in the `dp-admin-locale` cookie, a display preference like the theme. The
 * admin's API proxy forwards only the two session cookies (lib/api-proxy.ts), so the API never
 * sees it, and a forged value can only ever select English or Turkish.
 */
export const ADMIN_LOCALES = ["en", "tr"] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const DEFAULT_ADMIN_LOCALE: AdminLocale = "en";
export const ADMIN_LOCALE_COOKIE = "dp-admin-locale";

/** One year: the preference outlives sessions, like the theme in localStorage. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** BCP 47 tag for Intl (dates, numbers, plural rules). */
export const INTL_LOCALE: Readonly<Record<AdminLocale, string>> = { en: "en-GB", tr: "tr-TR" };

/** Every date and time in the console is shown in the company's time zone. */
export const ADMIN_TIME_ZONE = "Europe/Amsterdam";

/** Names of the languages in their own language, for the switcher. */
export const LOCALE_NAMES: Readonly<Record<AdminLocale, string>> = {
  en: "English",
  tr: "Türkçe",
};

export function isAdminLocale(value: unknown): value is AdminLocale {
  return typeof value === "string" && (ADMIN_LOCALES as readonly string[]).includes(value);
}

/** The cookie's value as a locale; anything else (missing, unknown, tampered) is English. */
export function parseAdminLocale(value: unknown): AdminLocale {
  return isAdminLocale(value) ? value : DEFAULT_ADMIN_LOCALE;
}

/**
 * The `document.cookie` assignment that stores a choice. Not HttpOnly on purpose: it is a display
 * setting the page writes itself, never a credential. SameSite=Lax, path-wide, Secure on https.
 */
export function localeCookie(locale: AdminLocale, secure: boolean): string {
  return [
    `${ADMIN_LOCALE_COOKIE}=${locale}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Stores the choice and reloads the page (browser only). The full reload re-renders the server
 * and client texts together, so no mixed-language or mismatched hydration can occur.
 */
export function switchAdminLocale(locale: AdminLocale): void {
  document.cookie = localeCookie(locale, window.location.protocol === "https:");
  window.location.reload();
}
