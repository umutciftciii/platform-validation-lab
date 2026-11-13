/**
 * DP-095 (D-T5): where the privacy policy lives on this site, and whether it may be shown here.
 * Drafts (missing controller details, see `privacyBlockers()` in @dream/contracts) are visible
 * locally and on staging only; in production the page is a 404, the links render as plain text
 * and the lead form is not offered.
 */
import { privacyDeployEnv, privacyPublication, type PrivacyPublication } from "@dream/contracts";

export const PRIVACY_PATH = "/privacy";

export function sitePrivacy(env: Record<string, string | undefined> = process.env): PrivacyPublication {
  return privacyPublication(privacyDeployEnv(env["DP_DEPLOY_ENV"]));
}

/** The policy link, or null where the page is not published. */
export function privacyHref(env: Record<string, string | undefined> = process.env): string | null {
  return sitePrivacy(env).publish ? PRIVACY_PATH : null;
}
