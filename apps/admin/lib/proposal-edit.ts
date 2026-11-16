/**
 * DP-191: the rules of the proposal text editor (Company Review › Content Review), as pure
 * functions shared by the editor and its unit tests. They only help the editor: the API checks
 * the same limits again and decides.
 */
import { PROPOSAL_DESCRIPTION_MAX, PROPOSAL_SUMMARY_MAX } from "@dream/contracts";

export const EDIT_FIELDS = ["summary", "description"] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

export type ProposalText = Readonly<Record<EditField, string | null>>;
export type ProposalDraft = Readonly<Record<EditField, string>>;

export const EDIT_LIMITS: Readonly<Record<EditField, number>> = {
  summary: PROPOSAL_SUMMARY_MAX,
  description: PROPOSAL_DESCRIPTION_MAX,
};

export const EDIT_LABELS: Readonly<Record<EditField, string>> = {
  summary: "Short description",
  description: "Description",
};

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

/** Why a field cannot be saved as it is, or null. */
export function textProblem(field: EditField, value: string): string | null {
  const t = value.trim();
  if (t.length > EDIT_LIMITS[field]) {
    return `Keep it to ${EDIT_LIMITS[field].toLocaleString("en")} characters (now ${t.length.toLocaleString("en")}).`;
  }
  if (REVIEW_MARKER.test(t)) {
    return "Review notes ([CONFIRM …]) belong in Missing & Verification, not in customer text.";
  }
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
): string {
  if (issues.some((i) => i.path === "version" && i.rule === "stale")) {
    return "Someone saved a newer version of this proposal meanwhile. It is loaded now and your edits are kept: Save adds them to the newer version, Cancel discards them.";
  }
  if (status === 413) {
    return "This text is too long to send in one request. Shorten the description and save again.";
  }
  if (status === 403) {
    return "You are not allowed to edit proposals on this site.";
  }
  return fallback;
}
