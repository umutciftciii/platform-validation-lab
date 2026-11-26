/**
 * DP-095 (D-T5): where the privacy policy lives on this site, and whether it may be shown here.
 * Drafts (missing controller details, see `privacyBlockers()` in @dream/contracts) are visible
 * locally and on staging only; in production the page is a 404, the links render as plain text
 * and the lead form is not offered.
 *
 * DP-298 (ADR-031 D1): the blockers and the policy's languages come from the API's legal texts
 * snapshot (lib/legal-texts-api.ts); these functions take them as arguments and stay pure.
 */
import { privacyDeployEnv, privacyPublication, type PrivacyPublication } from "@dream/contracts";

import { DEFAULT_LOCALE, localizeHref, type RouteLocale } from "./locale-routing.ts";

export const PRIVACY_PATH = "/privacy";

/**
 * ML-3: the policy's address for a page in `locale`. The policy exists only in `locales` (the
 * languages whose texts are published, `privacyLocalesOf`), so a Dutch page without a Dutch
 * policy links the English policy instead of a 404. ML-10: a form is offered only with its own
 * language's texts, so a form's link always names its own language's policy.
 */
export function privacyPolicyHref(locale: RouteLocale, locales: readonly RouteLocale[]): string {
  return localizeHref(locales.includes(locale) ? locale : DEFAULT_LOCALE, PRIVACY_PATH);
}

/** The publication gate in this environment, for the blockers of the current snapshot. */
export function sitePrivacy(
  blockers: string[],
  env: Record<string, string | undefined> = process.env,
): PrivacyPublication {
  return privacyPublication(privacyDeployEnv(env["DP_DEPLOY_ENV"]), blockers);
}

/** The policy link, or null where the page is not published. */
export function privacyHref(
  blockers: string[],
  env: Record<string, string | undefined> = process.env,
): string | null {
  return sitePrivacy(blockers, env).publish ? PRIVACY_PATH : null;
}
