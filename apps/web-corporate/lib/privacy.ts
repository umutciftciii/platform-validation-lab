/**
 * DP-095 (D-T5): the privacy policy of dreampetroleum.com. Same text and gate as web-bv (from
 * @dream/contracts): drafts are visible locally and on staging, never in production.
 */
import { privacyDeployEnv, privacyPublication, type PrivacyPublication } from "@dream/contracts";

export const PRIVACY_PATH = "/privacy";

export function sitePrivacy(
  env: Record<string, string | undefined> = process.env,
): PrivacyPublication {
  return privacyPublication(privacyDeployEnv(env["DP_DEPLOY_ENV"]));
}
