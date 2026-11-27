/**
 * DP-095 (D-T5): the privacy policy of dreampetroleum.com. Same gate as web-bv: drafts are visible
 * locally and on staging, never in production.
 *
 * DP-298 (ADR-031 D1): the texts are the versions published in the admin and the blockers include
 * their legal review, both from the API (lib/legal-texts-api.ts). Without them there is no policy:
 * no page, no link (fail closed).
 *
 * COM-1: per language. The policy exists in a language once its legal texts are published there
 * (`legalTextsFor`); a page in a language without its own policy links the English one. Its
 * address carries the language like every page (`/en/privacy`, `/tr/privacy`).
 */
import {
  legalTextsFor,
  privacyDeployEnv,
  privacyPublication,
  type LegalTextSet,
  type PrivacyPublication,
} from "@dream/contracts";

import { legalTextsSnapshot } from "@/lib/legal-texts-api";
import { DEFAULT_LOCALE, ROUTE_LOCALES, localePath, type RouteLocale } from "@/lib/locale-routing";

export const PRIVACY_PATH = "/privacy";

export interface SitePrivacy {
  gate: PrivacyPublication;
  /** The published texts of the language; null while none are published or unreadable. */
  texts: LegalTextSet | null;
  /** The languages whose texts are published. */
  locales: readonly RouteLocale[];
}

export async function sitePrivacy(
  locale: RouteLocale = DEFAULT_LOCALE,
  env: Record<string, string | undefined> = process.env,
): Promise<SitePrivacy> {
  const snapshot = await legalTextsSnapshot();
  const locales = ROUTE_LOCALES.filter((l) => legalTextsFor(l, snapshot.registry) !== null);
  const texts = legalTextsFor(locale, snapshot.registry);
  const gate = privacyPublication(privacyDeployEnv(env["DP_DEPLOY_ENV"]), snapshot.blockers);
  // No texts is no policy in any environment (the draft banner needs a text to sit on).
  return { gate: texts ? gate : { ...gate, publish: false }, texts, locales };
}

/** The policy's address for a page in `locale` (the English policy where it has none). */
export function privacyPolicyHref(locale: RouteLocale, locales: readonly RouteLocale[]): string {
  return localePath(locales.includes(locale) ? locale : DEFAULT_LOCALE, PRIVACY_PATH);
}

/**
 * The Privacy Policy link of a page in `locale`: its own language's policy, else the English one,
 * and only where that policy is published in this environment (null: no link, DP-095).
 */
export async function privacyLink(locale: RouteLocale): Promise<string | null> {
  const own = await sitePrivacy(locale);
  const shown = own.locales.includes(locale) ? own : await sitePrivacy(DEFAULT_LOCALE);
  return shown.gate.publish ? privacyPolicyHref(locale, own.locales) : null;
}
