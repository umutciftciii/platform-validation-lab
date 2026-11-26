/**
 * DP-095 (D-T5): the privacy policy of dreampetroleum.com. Same gate as web-bv: drafts are visible
 * locally and on staging, never in production.
 *
 * DP-298 (ADR-031 D1): the text is the English version published in the admin and the blockers
 * include its legal review, both from the API (lib/legal-texts-api.ts). Without them there is no
 * policy: no page, no link (fail closed).
 */
import {
  legalTextsFor,
  privacyDeployEnv,
  privacyPublication,
  type LegalTextSet,
  type PrivacyPublication,
} from "@dream/contracts";

import { legalTextsSnapshot } from "@/lib/legal-texts-api";

export const PRIVACY_PATH = "/privacy";

/** The corporate site is English only (until its locales come from the CMS, DP-027…DP-030). */
const LOCALE = "en";

export interface SitePrivacy {
  gate: PrivacyPublication;
  /** The published English texts; null while none are published or the API cannot answer. */
  texts: LegalTextSet | null;
}

export async function sitePrivacy(
  env: Record<string, string | undefined> = process.env,
): Promise<SitePrivacy> {
  const snapshot = await legalTextsSnapshot();
  const texts = legalTextsFor(LOCALE, snapshot.registry);
  const gate = privacyPublication(privacyDeployEnv(env["DP_DEPLOY_ENV"]), snapshot.blockers);
  // No texts is no policy in any environment (the draft banner needs a text to sit on).
  return { gate: texts ? gate : { ...gate, publish: false }, texts };
}
