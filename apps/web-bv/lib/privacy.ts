/**
 * DP-095 (D-T5): where the privacy policy lives on this site, and whether it may be shown here.
 * Drafts (missing controller details, see `privacyBlockers()` in @dream/contracts) are visible
 * locally and on staging only; in production the page is a 404, the links render as plain text
 * and the lead form is not offered.
 */
import { privacyDeployEnv, privacyPublication, type PrivacyPublication } from "@dream/contracts";

import { DEFAULT_LOCALE, localizeHref, type RouteLocale } from "./locale-routing.ts";
import { PRIVACY_LOCALES } from "./proxy-routes.ts";

export const PRIVACY_PATH = "/privacy";

/**
 * ML-3: the policy's address for a page in `locale`. The policy exists only in the languages of
 * `PRIVACY_LOCALES` (English until the Dutch text is approved, ADR-028 D12), so a Dutch page links
 * the English policy instead of a 404. ML-10: a form is offered only with its own language's texts,
 * so a form's link always names its own language's policy (`/nl/privacy` once Dutch is approved).
 */
export function privacyPolicyHref(
  locale: RouteLocale,
  locales: readonly RouteLocale[] = PRIVACY_LOCALES,
): string {
  return localizeHref(locales.includes(locale) ? locale : DEFAULT_LOCALE, PRIVACY_PATH);
}

export function sitePrivacy(env: Record<string, string | undefined> = process.env): PrivacyPublication {
  return privacyPublication(privacyDeployEnv(env["DP_DEPLOY_ENV"]));
}

/** The policy link, or null where the page is not published. */
export function privacyHref(env: Record<string, string | undefined> = process.env): string | null {
  return sitePrivacy(env).publish ? PRIVACY_PATH : null;
}
