/**
 * DP-298 (ADR-031): pure helpers of the data-processing screens — Content > Legal texts, the
 * Consents panel of a lead and the AI providers' data-processing terms. No React, no fetch: the
 * page, the client components and the tests share them. What a user may do is shown from the
 * API's own answer (`permissions`, `canWithdraw`, `canManage`); the API decides every call again.
 */
import {
  CONSENT_WITHDRAWAL_CHANNELS,
  LEGAL_DOCUMENTS,
  type ConsentRecord,
  type ConsentState,
  type LegalDocumentKey,
  type LegalTextsOverview,
  type LegalTextVersionSummary,
} from "@dream/contracts";
import type { PillTone } from "../components/ui";
import type { Translate } from "./i18n/types";

/** The markup of a privacy policy section heading and list item, shown in the help line. */
// i18n-ignore: editor syntax, not UI text
export const MARKUP_HEADING = "## Title {#id}";
// i18n-ignore: editor syntax, not UI text
export const MARKUP_ITEM = "- ";

/** Only the privacy policy uses the section markup; every other text is plain text. */
export const usesPolicyMarkup = (key: LegalDocumentKey): boolean => key === "PRIVACY_POLICY";

/** `usedBy: null`: prepared for a future process, shown nowhere yet. */
export const isFutureUse = (key: LegalDocumentKey): boolean => LEGAL_DOCUMENTS[key].usedBy === null;

const PLACES = [
  "PRIVACY_POLICY",
  "DOCUMENT_REQUEST_NOTICE",
  "CONTACT_NOTICE",
  "MARKETING_CONSENT",
] as const;
type PlaceKey = (typeof PLACES)[number];
const isPlace = (key: LegalDocumentKey): key is PlaceKey =>
  (PLACES as readonly string[]).includes(key);

/**
 * Where a text is used, in the UI language: "Prepared for future use — shown nowhere" for a text
 * no process uses yet; the contract's English description for a use without its own message.
 */
export function usedByLabel(key: LegalDocumentKey, t: Translate): string {
  const usedBy = LEGAL_DOCUMENTS[key].usedBy;
  if (usedBy === null) return t("legal.texts.futureUse");
  return isPlace(key)
    ? t(`legal.texts.places.${key}`)
    : `${t("legal.texts.usedByOther")} ${usedBy}`;
}

export const documentTitle = (key: LegalDocumentKey, t: Translate): string =>
  t(`legal.texts.documents.${key}`);

export const kindLabel = (key: LegalDocumentKey, t: Translate): string =>
  t(`legal.texts.kinds.${LEGAL_DOCUMENTS[key].kind}`);

const LANGUAGES = ["en", "nl", "tr", "de", "fr"] as const;

/** The name of a text's language; the tag itself (upper case) for a language without a name. */
export function languageLabel(locale: string, t: Translate): string {
  return (LANGUAGES as readonly string[]).includes(locale)
    ? t(`legal.texts.languages.${locale as (typeof LANGUAGES)[number]}`)
    : locale.toUpperCase();
}

/** The first 12 hex characters of a SHA-256, for display (the full value goes in a title). */
export const shortHash = (sha256: string): string => `${sha256.slice(0, 12)}…`;

export const REVIEW_TONE: Readonly<Record<LegalTextVersionSummary["legalReview"], PillTone>> = {
  REQUIRED: "amber",
  APPROVED: "success",
};

/** "Legal review required" / "Legal review approved". */
export const reviewLabel = (state: LegalTextVersionSummary["legalReview"], t: Translate): string =>
  t(`legal.texts.review.${state}`);

export type LegalTextAction = "newDraft" | "edit" | "delete" | "publish" | "review";

type Permissions = LegalTextsOverview["permissions"];

/**
 * What the screen offers on one document and language. The current published version is never
 * edited: a change starts a new draft from it ("newDraft", only while there is no draft — one
 * draft per text and language). A draft is edited and deleted with `edit`, published with
 * `publish`. The legal review is recorded with `publish`, on the current version or the draft,
 * while it is still REQUIRED.
 */
export function legalTextActions(
  row: { current: LegalTextVersionSummary | null; draft: LegalTextVersionSummary | null },
  can: Permissions,
): { current: LegalTextAction[]; draft: LegalTextAction[] } {
  const current: LegalTextAction[] = [];
  const draft: LegalTextAction[] = [];
  if (can.edit && row.draft === null) current.push("newDraft");
  if (can.publish && row.current && row.current.legalReview === "REQUIRED") current.push("review");
  if (row.draft) {
    if (can.edit) draft.push("edit");
    if (can.publish) draft.push("publish");
    if (can.publish && row.draft.legalReview === "REQUIRED") draft.push("review");
    if (can.edit) draft.push("delete");
  }
  return { current, draft };
}

/**
 * A rule of a refused legal-text call, split from its line number (`duplicate_id:12`) or, DP-306,
 * from the placeholder it names (`unknown_placeholder:aiProviders`).
 */
export interface LegalTextRule {
  rule: string;
  line: number | null;
  name: string | null;
}

export function parseLegalTextRule(raw: string): LegalTextRule {
  const m = /^([a-z_]+):(\d+)$/.exec(raw);
  if (m) return { rule: m[1]!, line: Number(m[2]), name: null };
  const n = /^([a-z_]+):([A-Za-z][A-Za-z0-9]*)$/.exec(raw);
  return n ? { rule: n[1]!, line: null, name: n[2]! } : { rule: raw, line: null, name: null };
}

export const LEGAL_TEXT_RULES = [
  "stale",
  "draft_exists",
  "published",
  "already_approved",
  "db_guard",
  "required",
  "too_long",
  "text_before_section",
  "duplicate_id",
  "empty",
  "published_source_of_same_document",
  // DP-306: placeholders.
  "unknown_placeholder",
  "missing_value",
] as const;
type LegalTextRuleKey = (typeof LEGAL_TEXT_RULES)[number];

/** The message of a legal-text API rule in the UI language; undefined for an unknown rule. */
export function legalTextRuleMessage(raw: string, t: Translate): string | undefined {
  const { rule, line, name } = parseLegalTextRule(raw);
  if (!(LEGAL_TEXT_RULES as readonly string[]).includes(rule)) return undefined;
  const key = `legal.texts.rules.${rule as LegalTextRuleKey}` as const;
  const params = { line: line ?? 1, heading: MARKUP_HEADING, name: `{${name ?? ""}}` };
  return (t as unknown as (k: string, p: Record<string, string | number>) => string)(key, params);
}

/** Characters of a draft, as the API counts them (line endings normalised, trimmed). */
export const textLength = (text: string): number => text.replace(/\r\n?/g, "\n").trim().length;

// --- consents ---------------------------------------------------------------------------------

export const CONSENT_TONE: Readonly<Record<"GRANTED" | "WITHDRAWN" | "none", PillTone>> = {
  GRANTED: "success",
  WITHDRAWN: "neutral",
  none: "neutral",
};

/** "Granted" / "Withdrawn" / "Never given" (null: no record, never asked or never given). */
export const consentStateLabel = (state: ConsentState["state"], t: Translate): string =>
  t(`legal.consents.state.${state ?? "none"}`);

/** A withdrawal can be recorded only for a purpose that is GRANTED, with lead:manage. */
export const canWithdrawPurpose = (state: ConsentState, canWithdraw: boolean): boolean =>
  canWithdraw && state.state === "GRANTED";

/** One history line: how it was granted (source, text version) or withdrawn (channel), by whom. */
export function consentRecordLines(record: ConsentRecord, t: Translate): string[] {
  const lines: string[] = [];
  if (record.action === "GRANTED") {
    lines.push(
      t("legal.consents.granted", { source: t(`legal.consents.sources.${record.source}`) }),
    );
    if (record.textVersion) {
      lines.push(t("legal.consents.textVersion", { version: record.textVersion }));
    }
  } else {
    lines.push(
      t("legal.consents.withdrawn", {
        channel: record.channel
          ? t(`legal.consents.channels.${record.channel}`)
          : t("legal.consents.channels.OTHER"),
      }),
    );
  }
  if (record.actor) lines.push(t("legal.consents.by", { name: record.actor.displayName }));
  return lines;
}

/** The withdrawal channels in the order the dialog offers them. */
export const WITHDRAWAL_CHANNELS = CONSENT_WITHDRAWAL_CHANNELS;

// --- AI provider data-processing terms ---------------------------------------------------------

export interface DataTermsDraft {
  dpaReference: string;
  dpaSignedOn: string;
  transferMechanism: string;
  kvkkTransferMechanism: string;
  dataRegion: string;
  retentionSetting: string;
  noTraining: boolean;
}

/** The form is complete when every text is filled, the date is a day and no-training is ticked. */
export function dataTermsComplete(d: DataTermsDraft): boolean {
  return (
    d.dpaReference.trim() !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.dpaSignedOn) &&
    d.transferMechanism !== "" &&
    d.kvkkTransferMechanism !== "" &&
    d.dataRegion.trim() !== "" &&
    d.retentionSetting.trim() !== "" &&
    d.noTraining
  );
}
