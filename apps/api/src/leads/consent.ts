/**
 * Consent evidence of a lead request (DP-042; ADR-016 D2, D3): the notice and marketing texts the
 * visitor saw are identified by version and the SHA-256 of their exact text.
 *
 * ML-10 (DP-241; ADR-028 D12): a form names its language. The texts are those of that language
 * (`legalTextsFor`: English, or a translation approved by the DP-095 review); a draft translation
 * is never accepted. The versions must be that language's current ones: a version of another
 * language is refused as `locale_mismatch` (a text in one language is never evidence for a form in
 * another), an older version of the same language stays `outdated` (D-T7).
 */
import { createHash, randomInt } from "node:crypto";
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LEAD_TEXT_LOCALE_MISMATCH,
  LEGAL_TEXTS,
  legalTextVersionLocale,
  type LegalTextSet,
} from "@dream/contracts";

export function textSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const PRIVACY_NOTICE_SHA256 = textSha256(LEAD_PRIVACY_NOTICE.text);
export const MARKETING_CONSENT_SHA256 = textSha256(LEAD_MARKETING_CONSENT.text);
/** DP-151: the contact form's notice. */
export const CONTACT_NOTICE_SHA256 = textSha256(LEAD_CONTACT_NOTICE.text);

/** The English source texts (the default of an older site that sends no language). */
const ENGLISH = LEGAL_TEXTS["en"] as LegalTextSet;

/** Crockford base32 without I, L, O, U (same alphabet as the recovery codes). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short request reference printed on the watermark: 8 characters, 40 bits. */
export function newRequestReference(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += CROCKFORD[randomInt(CROCKFORD.length)];
  return out;
}

export type ConsentProblem = "privacyNoticeVersion" | "marketingConsentVersion";
export type ConsentRule = "outdated" | typeof LEAD_TEXT_LOCALE_MISMATCH;
export interface ConsentIssue {
  path: ConsentProblem;
  rule: ConsentRule;
}

/** Why `version` is not the current text of the form's language (null: it is). */
function versionIssue(
  path: ConsentProblem,
  version: string | null,
  current: { version: string },
  locale: string,
): ConsentIssue | null {
  if (version === current.version) return null;
  // A version of another language: the form and its texts disagree (fail closed, not D-T7).
  if (version !== null && legalTextVersionLocale(version) !== locale) {
    return { path, rule: LEAD_TEXT_LOCALE_MISMATCH };
  }
  return { path, rule: "outdated" };
}

/**
 * The first problem with the versions of a document request in the texts' language (null: both
 * current). The marketing version counts only when the box is ticked (it stays optional).
 */
export function consentIssue(
  input: {
    privacyNoticeVersion: string;
    marketingConsent: boolean;
    marketingConsentVersion: string | null;
  },
  texts: LegalTextSet = ENGLISH,
): ConsentIssue | null {
  return (
    versionIssue(
      "privacyNoticeVersion",
      input.privacyNoticeVersion,
      texts.privacyNotice,
      texts.locale,
    ) ??
    (input.marketingConsent
      ? versionIssue(
          "marketingConsentVersion",
          input.marketingConsentVersion,
          texts.marketingConsent,
          texts.locale,
        )
      : null)
  );
}

/** Which submitted version does not match the current English text (null: both current). */
export function consentVersionProblem(input: {
  privacyNoticeVersion: string;
  marketingConsent: boolean;
  marketingConsentVersion: string | null;
}): ConsentProblem | null {
  return consentIssue(input)?.path ?? null;
}

/** DP-151 / ML-10: the contact form names the notice it showed: the current one of its language. */
export function contactNoticeIssue(
  input: { privacyNoticeVersion: string },
  texts: LegalTextSet = ENGLISH,
): ConsentIssue | null {
  return versionIssue(
    "privacyNoticeVersion",
    input.privacyNoticeVersion,
    texts.contactNotice,
    texts.locale,
  );
}

/** DP-151: the contact form names the notice it showed; it must be the current English one. */
export function contactNoticeVersionProblem(input: {
  privacyNoticeVersion: string;
}): ConsentProblem | null {
  return contactNoticeIssue(input)?.path ?? null;
}

/** SHA-256 of an offered text (the evidence stored with a form), computed once per text. */
const digests = new Map<string, string>();
export function evidenceSha256(text: string): string {
  let d = digests.get(text);
  if (d === undefined) {
    d = textSha256(text);
    digests.set(text, d);
  }
  return d;
}
