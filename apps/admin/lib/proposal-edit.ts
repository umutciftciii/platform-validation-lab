/**
 * DP-191: the rules of the proposal text editor (Company Review › Content Review), as pure
 * functions shared by the editor and its unit tests. They only help the editor: the API checks
 * the same limits again and decides.
 */
import { PROPOSAL_DESCRIPTION_MAX, PROPOSAL_SUMMARY_MAX } from "@dream/contracts";
import type { AdminLocale } from "./i18n/config";
import { formatNumber } from "./i18n/format";
import type { Translate } from "./i18n/types";

export const EDIT_FIELDS = ["summary", "description"] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

export type ProposalText = Readonly<Record<EditField, string | null>>;
export type ProposalDraft = Readonly<Record<EditField, string>>;

export const EDIT_LIMITS: Readonly<Record<EditField, number>> = {
  summary: PROPOSAL_SUMMARY_MAX,
  description: PROPOSAL_DESCRIPTION_MAX,
};

/** The label of a field (ML-12b: `companyReview.fields.<field>`). */
export function editLabel(field: EditField, t: Translate): string {
  return t(`companyReview.fields.${field}`);
}

/** Internal review notes never go into customer text (same rule as contracts and database). */
const REVIEW_MARKER = /\[confirm/i;

/** What a field saves as: trimmed, and empty means "no text" (null). */
export function normalizeText(value: string): string | null {
  const t = value.trim();
  return t === "" ? null : t;
}

/** The editor's starting value for a saved text. */
export function draftOf(text: ProposalText): ProposalDraft {
  return { summary: text.summary ?? "", description: text.description ?? "" };
}

/** The fields whose saved value would change, with that value (only these are sent). */
export function changedText(
  saved: ProposalText,
  draft: ProposalDraft,
): Partial<Record<EditField, string | null>> {
  const out: Partial<Record<EditField, string | null>> = {};
  for (const f of EDIT_FIELDS) {
    const next = normalizeText(draft[f]);
    if (next !== saved[f]) out[f] = next;
  }
  return out;
}

/**
 * The draft after a newer version arrived: a field the user has edited keeps the typed text;
 * every other field takes the newer saved text, so a save never reverts someone else's change
 * to a field the user did not touch.
 */
export function rebaseDraft(
  oldSaved: ProposalText,
  draft: ProposalDraft,
  newSaved: ProposalText,
): ProposalDraft {
  const next = draftOf(newSaved);
  return {
    summary: normalizeText(draft.summary) !== oldSaved.summary ? draft.summary : next.summary,
    description:
      normalizeText(draft.description) !== oldSaved.description
        ? draft.description
        : next.description,
  };
}

/** True when the draft differs from the saved text in what it would save. */
export function hasTextChanges(saved: ProposalText, draft: ProposalDraft): boolean {
  return Object.keys(changedText(saved, draft)).length > 0;
}

/** Why a field cannot be saved as it is, or null (numbers in the console language). */
export function textProblem(
  field: EditField,
  value: string,
  t: Translate,
  locale: AdminLocale,
): string | null {
  const text = value.trim();
  if (text.length > EDIT_LIMITS[field]) {
    return t("companyReview.editor.tooLong", {
      max: formatNumber(EDIT_LIMITS[field], locale),
      now: formatNumber(text.length, locale),
    });
  }
  if (REVIEW_MARKER.test(text)) return t("companyReview.editor.reviewNotes");
  return null;
}

/** The request body of one save: the version the editor started from and the changed text. */
export function reviseBody(
  version: number,
  saved: ProposalText,
  draft: ProposalDraft,
): { version: number } & Partial<Record<EditField, string | null>> {
  return { version, ...changedText(saved, draft) };
}

/** A readable message for a failed save (the catalogue client's message otherwise). */
export function saveErrorText(
  status: number,
  issues: readonly { path: string; rule: string }[],
  fallback: string,
  t: Translate,
): string {
  if (issues.some((i) => i.path === "version" && i.rule === "stale")) {
    return t("companyReview.editor.stale");
  }
  if (status === 413) return t("companyReview.editor.tooLarge");
  if (status === 403) return t("companyReview.editor.forbidden");
  return fallback;
}
