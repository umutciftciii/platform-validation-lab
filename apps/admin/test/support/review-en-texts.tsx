// ML-12b (DP-243): the Company Review view-model texts a screen shows only after an action or for
// a value the fixtures do not reach (validation, save errors, every label of every code), in one
// list, and the product page's research notes. company-review-en.test.tsx records them on
// 7b543f6 (before ML-12b) and compares them after it.
//
// ML-12b: after the change the same list is built from the dictionary in any console language
// (`reviewTexts(locale)`); English must equal the recording, word for word.
import type { ProposalResponse } from "@dream/contracts";
import { ResearchNotes } from "../../components/catalog/proposal-review";
import { changeRequestProblem } from "../../components/catalog/proposal-decision";
import type { AdminLocale } from "../../lib/i18n/config";
import { createTranslator } from "../../lib/i18n/translate";
import { editLabel, saveErrorText, textProblem } from "../../lib/proposal-edit";
import {
  decisionBlockedText,
  fieldLabel,
  formatSpecValue,
  KIND_TONE,
  kindLabel,
  REVIEW_SECTIONS,
  sectionText,
  sourceLevelText,
  statusHint,
  statusLabel,
} from "../../lib/proposals-view";
import { REVIEW_TABS, reviewTabLabel } from "../../lib/review-tabs";

export function renderResearchNotes(
  proposal: ProposalResponse["proposal"],
  locale: AdminLocale = "en",
) {
  return (
    <ResearchNotes
      proposal={proposal}
      reviewHref="/company-review/x?site=bv"
      t={createTranslator(locale)}
    />
  );
}

export function reviewEnTexts(): string[] {
  return reviewTexts("en");
}

const PLURAL_KEYS = {
  conflict: "conflicts",
  "held value": "heldValues",
  product: "products",
  "review item": "reviewItems",
  source: "sources",
  question: "questions",
  "missing document": "missingDocuments",
  "technical value": "technicalValues",
} as const;

export function reviewTexts(locale: AdminLocale): string[] {
  const t = createTranslator(locale);
  const out: string[] = [];
  for (const s of ["REVIEW_PENDING", "CHANGES_REQUESTED", "APPROVED"] as const)
    out.push(statusLabel(s, t), statusHint(s, t));
  for (const r of ["no_permission", "not_in_review", "own_change", null] as const) {
    const b = decisionBlockedText(r, t);
    out.push(b.title, b.body);
  }
  for (const k of Object.keys(KIND_TONE) as (keyof typeof KIND_TONE)[]) out.push(kindLabel(k, t));
  for (const s of REVIEW_SECTIONS) {
    const x = sectionText(s.id, t);
    out.push(x.title, x.description);
  }
  for (const l of ["A", "B", "C", "D", "E"]) out.push(sourceLevelText(l, t) ?? "");
  out.push(String(sourceLevelText("Z", t)));
  out.push(
    fieldLabel("spec:viscosity_index") ?? "",
    fieldLabel("summary") ?? "",
    String(fieldLabel(null)),
  );
  for (const v of [
    { type: "NUMBER", number: 1234.5 },
    { type: "RANGE", min: 3.8, max: 4.5, minExclusive: false, maxExclusive: true },
    { type: "RANGE", min: 3.8, max: 4.5, minExclusive: true, maxExclusive: false },
    { type: "RANGE", min: 5, max: 5, minExclusive: false, maxExclusive: false },
    { type: "RANGE", min: 200, max: null, minExclusive: false, maxExclusive: false },
    { type: "RANGE", min: 200, max: null, minExclusive: true, maxExclusive: false },
    { type: "RANGE", min: null, max: 0.5, minExclusive: false, maxExclusive: false },
    { type: "RANGE", min: null, max: 0.5, minExclusive: false, maxExclusive: true },
    { type: "TEXT", text: "Clear and bright" },
    { type: "BOOLEAN", boolean: true },
    { type: "BOOLEAN", boolean: false },
  ] as const)
    out.push(
      formatSpecValue(v as never, "mm²/s", t, locale),
      formatSpecValue(v as never, null, t, locale),
    );
  // the baseline listed each tab label twice (the table and the lookup)
  for (const tab of REVIEW_TABS) out.push(reviewTabLabel(tab.id, t), reviewTabLabel(tab.id, t));
  out.push(editLabel("summary", t), editLabel("description", t));
  out.push(
    String(textProblem("summary", "x".repeat(501), t, locale)),
    String(textProblem("description", "x".repeat(12345), t, locale)),
    String(textProblem("summary", "Base oil [CONFIRM: grade]", t, locale)),
    String(textProblem("summary", "fine", t, locale)),
  );
  out.push(
    saveErrorText(409, [{ path: "version", rule: "stale" }], "fallback", t),
    saveErrorText(413, [], "fallback", t),
    saveErrorText(403, [], "fallback", t),
    saveErrorText(400, [], "The change could not be saved. Try again in a moment.", t),
  );
  out.push(
    String(changeRequestProblem("", t)),
    String(changeRequestProblem("x".repeat(5000), t)),
    String(changeRequestProblem("Please shorten.", t)),
  );
  for (const [n, w] of [
    [1, "conflict"],
    [2, "conflict"],
    [1, "held value"],
    [3, "held value"],
    [1, "product"],
    [4, "product"],
    [1, "review item"],
    [2, "review item"],
    [1, "source"],
    [2, "source"],
    [1, "technical value"],
    [2, "technical value"],
    [1, "question"],
    [2, "question"],
    [1, "missing document"],
    [2, "missing document"],
  ] as const)
    out.push(t(`companyReview.count.${PLURAL_KEYS[w]}`, { count: n }));
  return out;
}
