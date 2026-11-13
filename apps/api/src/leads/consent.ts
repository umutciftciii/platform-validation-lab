/**
 * Consent evidence of a lead request (DP-042; ADR-016 D2, D3): the notice and marketing texts the
 * visitor saw are identified by version and the SHA-256 of their exact text.
 */
import { createHash, randomInt } from "node:crypto";
import { LEAD_CONTACT_NOTICE, LEAD_MARKETING_CONSENT, LEAD_PRIVACY_NOTICE } from "@dream/contracts";

export function textSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const PRIVACY_NOTICE_SHA256 = textSha256(LEAD_PRIVACY_NOTICE.text);
export const MARKETING_CONSENT_SHA256 = textSha256(LEAD_MARKETING_CONSENT.text);
/** DP-151: the contact form's notice. */
export const CONTACT_NOTICE_SHA256 = textSha256(LEAD_CONTACT_NOTICE.text);

/** Crockford base32 without I, L, O, U (same alphabet as the recovery codes). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short request reference printed on the watermark: 8 characters, 40 bits. */
export function newRequestReference(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += CROCKFORD[randomInt(CROCKFORD.length)];
  return out;
}

export type ConsentProblem = "privacyNoticeVersion" | "marketingConsentVersion";

/** Which submitted version does not match the current text (null: both current). */
export function consentVersionProblem(input: {
  privacyNoticeVersion: string;
  marketingConsent: boolean;
  marketingConsentVersion: string | null;
}): ConsentProblem | null {
  if (input.privacyNoticeVersion !== LEAD_PRIVACY_NOTICE.version) return "privacyNoticeVersion";
  if (input.marketingConsent && input.marketingConsentVersion !== LEAD_MARKETING_CONSENT.version) {
    return "marketingConsentVersion";
  }
  return null;
}

/** DP-151: the contact form names the notice it showed; it must be the current one. */
export function contactNoticeVersionProblem(input: {
  privacyNoticeVersion: string;
}): ConsentProblem | null {
  return input.privacyNoticeVersion === LEAD_CONTACT_NOTICE.version ? null : "privacyNoticeVersion";
}
