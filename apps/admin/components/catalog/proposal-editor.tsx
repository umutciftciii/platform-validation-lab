"use client";

/**
 * DP-191: the proposed customer text, editable in Company Review › Content Review for users who
 * may revise proposals on the site (`product:edit`). The current site text stays next to each
 * field as the reference; it is never changed here.
 *
 * - Save sends only the changed text and the version the editor started from (the API keeps
 *   every other field). Each save is a new proposal version; its text is kept in the history.
 * - Cancel restores the saved text. Unsaved changes mark the tab and are confirmed before the
 *   page is left (review tabs).
 * - After a save the saved text is shown at once; the page then reloads its server data.
 * - A newer version saved meanwhile (409) is loaded: the fields the user edited keep the typed
 *   text, the others show the newer text, and the message says what Save and Cancel do.
 *
 * The company's decision is unchanged and separate: an author of a version cannot approve it.
 */
import { type ProposalResponse, type ProposalStatus } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { callCatalog } from "../../lib/catalog-client";
import {
  draftOf,
  EDIT_FIELDS,
  EDIT_LIMITS,
  editLabel,
  hasTextChanges,
  normalizeText,
  rebaseDraft,
  reviseBody,
  saveErrorText,
  textProblem,
  type EditField,
  type ProposalDraft,
  type ProposalText,
} from "../../lib/proposal-edit";
import { formatNumber } from "../../lib/i18n/format";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { FormMessage, TEXTAREA } from "./parts";
import { useReviewUnsaved } from "./review-tabs";

export function ProposalTextEditor({
  proposalId,
  version,
  status,
  text,
  current,
  placeholder,
  tags,
}: {
  proposalId: string;
  version: number;
  status: ProposalStatus;
  /** The saved proposed text. */
  text: ProposalText;
  /** The current site text (listing text, else the master's), shown as the reference. */
  current: ProposalText;
  /** The research proposes no text (placeholder product, e.g. SAF, LUB-GENERIC). */
  placeholder: boolean;
  /** Provenance tags, rendered on the server. */
  tags: ReactNode;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useAdminLocale();
  const ids = { summary: useId(), description: useId() };
  const [saved, setSaved] = useState<ProposalText>(text);
  const [base, setBase] = useState({ version, status });
  const [draft, setDraft] = useState<ProposalDraft>(() => draftOf(text));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New server data (after a save here, a decision or a save elsewhere): take its version and
  // text. Fields the user has edited keep the typed text; every other field shows the new text.
  const [lastProps, setLastProps] = useState({ version, text });
  if (lastProps.version !== version) {
    setLastProps({ version, text });
    setDraft(rebaseDraft(saved, draft, text));
    setSaved(text);
    setBase({ version, status });
  }

  const dirty = hasTextChanges(saved, draft);
  useReviewUnsaved(dirty);

  const problems = Object.fromEntries(
    EDIT_FIELDS.map((f) => [f, textProblem(f, draft[f], t, locale)]),
  ) as Record<EditField, string | null>;
  const blocked = EDIT_FIELDS.some((f) => problems[f] !== null);

  function change(field: EditField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setNotice(null);
  }

  function cancel() {
    setDraft(draftOf(saved));
    setError(null);
    setNotice(null);
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty || blocked || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await callCatalog<ProposalResponse>(
      "POST",
      `/proposals/${proposalId}/revise`,
      reviseBody(base.version, saved, draft),
    );
    setPending(false);
    if (!result.ok) {
      setError(saveErrorText(result.status, result.issues, result.message, t));
      // A newer version exists: load it, keeping the typed text (see above).
      if (result.status === 409) router.refresh();
      return;
    }
    const p = result.data.proposal;
    const next = { summary: p.summary, description: p.description };
    setSaved(next);
    setDraft(draftOf(next));
    setBase({ version: p.version, status: p.status });
    setLastProps({ version: p.version, text: next });
    setNotice(t("companyReview.editor.savedAs", { version: p.version }));
    router.refresh();
  }

  return (
    <section
      id="proposal"
      aria-labelledby="proposal-title"
      data-proposal-editor=""
      className="scroll-mt-32 rounded-2xl border border-line bg-surface shadow-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2
            id="proposal-title"
            className="type-display text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink"
          >
            {t("companyReview.editor.title")}
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">{t("companyReview.editor.description")}</p>
        </div>
        <span className="flex flex-wrap gap-2">{tags}</span>
      </header>
      <form onSubmit={save} noValidate className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
        {placeholder ? (
          <div
            data-placeholder-note=""
            className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-2"
          >
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>{t("companyReview.editor.placeholderNote")}</span>
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className="hidden gap-4 text-xs font-semibold text-ink-3 lg:grid lg:grid-cols-[9rem_1fr_1fr]"
        >
          <span />
          <span>{t("companyReview.currentSite")}</span>
          <span>{t("companyReview.editor.title")}</span>
        </div>
        {EDIT_FIELDS.map((f) => {
          const length = draft[f].trim().length;
          const problem = problems[f];
          const changed = normalizeText(draft[f]) !== saved[f];
          return (
            <div key={f} className="grid gap-2 lg:grid-cols-[9rem_1fr_1fr] lg:gap-4">
              <label htmlFor={ids[f]} className="text-sm font-medium text-ink-2 lg:pt-2.5">
                {editLabel(f, t)}
                {changed ? (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-normal text-amber-ink">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-amber" />
                    {t("companyReview.editor.edited")}
                  </span>
                ) : null}
              </label>
              <div
                data-compare="site"
                className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5 text-sm ring-1 ring-line"
              >
                <p className="mb-1 text-xs font-semibold text-ink-3 lg:hidden">
                  {t("companyReview.currentSite")}
                </p>
                <div className="whitespace-pre-line break-words text-ink">
                  {current[f] ?? (
                    <span className="text-ink-3">{t("companyReview.notProvided")}</span>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold text-ink-3 lg:hidden" aria-hidden="true">
                  {t("companyReview.editor.title")}
                </p>
                <textarea
                  id={ids[f]}
                  name={f}
                  value={draft[f]}
                  onChange={(e) => change(f, e.currentTarget.value)}
                  rows={f === "summary" ? 3 : 8}
                  disabled={pending}
                  placeholder={
                    placeholder
                      ? t("companyReview.editor.noTextYet")
                      : t("companyReview.notProvided")
                  }
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={`${ids[f]}-count`}
                  className={cx(TEXTAREA, f === "summary" ? "min-h-20" : "min-h-44")}
                />
                <p
                  id={`${ids[f]}-count`}
                  className={cx(
                    "mt-1 flex flex-wrap justify-between gap-x-3 text-xs",
                    problem ? "text-danger" : "text-ink-3",
                  )}
                >
                  <span>
                    {problem ?? (length === 0 ? t("companyReview.editor.emptySaved") : "")}
                  </span>
                  <span className="tabular">
                    {formatNumber(length, locale)} / {formatNumber(EDIT_LIMITS[f], locale)}
                  </span>
                </p>
              </div>
            </div>
          );
        })}

        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {notice && !dirty ? <FormMessage kind="success">{notice}</FormMessage> : null}

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3" data-editor-state={dirty ? "unsaved" : "saved"}>
            {dirty ? (
              <>
                <span className="font-medium text-amber-ink">
                  {t("companyReview.editor.unsaved")}
                </span>{" "}
                {base.status === "APPROVED"
                  ? t("companyReview.editor.savingApproved")
                  : t("companyReview.editor.savingCreates", { version: base.version + 1 })}
              </>
            ) : (
              t("companyReview.editor.saved", { version: base.version })
            )}
          </p>
          <div className="flex gap-2 sm:shrink-0">
            <button
              type="button"
              onClick={cancel}
              disabled={!dirty || pending}
              className={cx(buttonStyles.secondary, "flex-1 sm:flex-none")}
            >
              {t("companyReview.editor.cancel")}
            </button>
            <button
              type="submit"
              disabled={!dirty || blocked || pending}
              className={cx(buttonStyles.primary, "flex-1 sm:flex-none")}
            >
              {pending ? <Spinner /> : <Icon name="check" size={17} />}
              <span>
                {pending ? t("companyReview.editor.saving") : t("companyReview.editor.save")}
              </span>
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
