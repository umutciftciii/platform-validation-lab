"use client";
/**
 * DP-298 (ADR-031): the interactive parts of Content > Legal texts. One row per document and
 * language shows the current published version (immutable evidence: version, SHA-256, legal
 * review, who published it and when) and the draft, with the actions the overview's
 * `permissions` allow: a new draft from the current version, edit and delete a draft
 * (legal_text:edit), publish it and record the legal review (legal_text:publish, fresh step-up).
 *
 * A draft is saved with its revision (optimistic concurrency): a 409 `stale` loads the latest saved
 * text into the editor and says so. Publishing and the legal review name the SHA-256 of the exact
 * text the user read; the API refuses them when the text changed meanwhile.
 *
 * `useDataChange` is also used by the lead Consents panel and the AI providers' data-processing
 * terms (components/leads/lead-consents.tsx, components/ai/ai-data-terms.tsx).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import {
  ALLOWED_PLACEHOLDERS,
  LEGAL_DOCUMENTS,
  type LegalDocumentKey,
  type LegalTextsOverview,
  type LegalTextVersionDetail,
  type LegalTextVersionSummary,
} from "@dream/contracts";
import {
  approveLegalReview,
  createLegalTextDraft,
  deleteLegalTextDraft,
  getLegalTextVersion,
  publishLegalText,
  updateLegalTextDraft,
  type DataProcessingCall,
} from "../../lib/data-processing-client";
import { ADMIN_TIME_ZONE } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import {
  documentTitle,
  languageLabel,
  legalTextActions,
  MARKUP_HEADING,
  MARKUP_ITEM,
  REVIEW_TONE,
  reviewLabel,
  shortHash,
  textLength,
  usesPolicyMarkup,
  legalTextRuleMessage,
} from "../../lib/legal-texts-view";
import { Field, FormMessage, TEXTAREA } from "../catalog/parts";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { StepUpPrompt, useStepUp } from "../owner/owner-actions";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

export function useLegalDate() {
  const locale = useAdminLocale();
  return (iso: string | null) =>
    iso ? dateTimeFormat(locale, DATE_TIME).format(new Date(iso)) : "—";
}

type Failure = Extract<DataProcessingCall<unknown>, { ok: false }>;

/**
 * One change with the step-up: runs the call, asks for an authenticator code when the API wants a
 * fresh step-up and retries; refreshes the page on success. `onOk` returns the success notice;
 * `onFail` sees the refusal (its rule, e.g. `stale`).
 */
export function useDataChange() {
  const router = useRouter();
  const step = useStepUp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run<T>(
    call: () => Promise<DataProcessingCall<T>>,
    onOk?: (data: T) => string | null | void,
    onFail?: (failure: Failure) => void,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    await step.run(call, (res) => {
      if (res.ok) {
        const message = onOk?.(res.data);
        if (message) setNotice(message);
        router.refresh();
      } else {
        setError(res.message);
        onFail?.(res as Failure);
      }
    });
    setBusy(false);
  }
  return {
    busy,
    error,
    notice,
    run,
    setError,
    clear: () => {
      setError(null);
      setNotice(null);
      step.clear();
    },
    stepUp: step.pending
      ? (variant: "inline" | "dialog" = "inline") => (
          <StepUpPrompt
            variant={variant}
            retry={async () => {
              const retry = step.pending;
              step.clear();
              setBusy(true);
              await retry?.();
              setBusy(false);
            }}
            onCancel={() => step.clear()}
          />
        )
      : null,
  };
}

/**
 * Loads one version with its text (GET versions/:id); `reload` after a stale save. `onLoaded`
 * (stable: useCallback) receives every loaded version, e.g. to fill an editor. State is only set
 * in the request's callback, never synchronously in the effect.
 */
function useVersion(id: string | null, onLoaded?: (version: LegalTextVersionDetail) => void) {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    version: LegalTextVersionDetail | null;
    error: string | null;
  } | null>(null);
  const key = id === null ? null : `${id}#${nonce}`;
  useEffect(() => {
    if (id === null) return;
    let live = true;
    const requested = `${id}#${nonce}`;
    void getLegalTextVersion(id).then((res) => {
      if (!live) return;
      if (res.ok) {
        setResult({ key: requested, version: res.data.version, error: null });
        onLoaded?.(res.data.version);
      } else {
        setResult({ key: requested, version: null, error: res.message });
      }
    });
    return () => {
      live = false;
    };
  }, [id, nonce, onLoaded]);
  const loading = key !== null && result?.key !== key;
  return {
    // While reloading, the last loaded version stays (the editor keeps its text).
    version: result?.version ?? null,
    error: loading ? null : (result?.error ?? null),
    loading,
    reload: () => setNonce((n) => n + 1),
  };
}

/** Version facts: legal review, approval, publication, translation, SHA-256 and review note. */
export function VersionMeta({ version: v }: { version: LegalTextVersionSummary }) {
  const t = useT();
  const date = useLegalDate();
  return (
    <div className="space-y-1.5 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <StatusPill tone={REVIEW_TONE[v.legalReview]}>{reviewLabel(v.legalReview, t)}</StatusPill>
      </p>
      {v.legalReview === "APPROVED" && v.reviewApprovedAt ? (
        <p key="approved" className="text-ink-2">
          {v.reviewApprovedBy
            ? t("legal.texts.review.approvedBy", {
                name: v.reviewApprovedBy.displayName,
                date: date(v.reviewApprovedAt),
              })
            : t("legal.texts.review.approvedAt", { date: date(v.reviewApprovedAt) })}
        </p>
      ) : null}
      {v.publishedAt ? (
        <p key="published" className="text-ink-2">
          {v.publishedBy
            ? t("legal.texts.current.publishedBy", {
                name: v.publishedBy.displayName,
                date: date(v.publishedAt),
              })
            : t("legal.texts.current.publishedAt", { date: date(v.publishedAt) })}
        </p>
      ) : null}
      {v.translatesVersion ? (
        <p key="translates" className="text-ink-3">
          {t("legal.texts.current.translates", { version: v.translatesVersion })}
        </p>
      ) : null}
      <p className="flex flex-wrap items-baseline gap-x-2 text-ink-3">
        <span>{t("legal.texts.current.sha")}</span>
        <code className="font-mono text-xs" title={v.sha256}>
          {shortHash(v.sha256)}
        </code>
      </p>
      {v.reviewNote ? (
        <div key="note" className="rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t("legal.texts.current.reviewNote")}
          </p>
          <p className="mt-0.5 whitespace-pre-line">{v.reviewNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The text of one version, read only (a dialog). */
function TextDialog({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const t = useT();
  const { version, error, loading } = useVersion(id);
  return (
    <Dialog title={title} size="lg" closeLabel={t("legal.texts.common.close")} onClose={onClose}>
      <DialogBody>
        <VersionText version={version} error={error} loading={loading} />
        {version ? <VersionPreview key="preview" version={version} /> : null}
      </DialogBody>
      <DialogFooter>
        <button type="button" className={buttonStyles.secondary} onClick={onClose}>
          {t("legal.texts.common.close")}
        </button>
      </DialogFooter>
    </Dialog>
  );
}

function VersionText({
  version,
  error,
  loading,
}: {
  version: LegalTextVersionDetail | null;
  error: string | null;
  loading: boolean;
}) {
  const t = useT();
  if (loading) {
    return (
      <p key="loading" role="status" className="flex items-center gap-2 text-sm text-ink-3">
        <Spinner size={14} />
        <span>{t("legal.texts.draft.loading")}</span>
      </p>
    );
  }
  if (error || !version) {
    return (
      <FormMessage key="error" kind="error">
        {error ?? t("legal.texts.draft.loadFailed")}
      </FormMessage>
    );
  }
  return (
    <pre
      key="text"
      lang={version.locale}
      className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-3 font-sans text-sm leading-relaxed text-ink"
    >
      {version.text}
    </pre>
  );
}

/**
 * DP-306: the text as the API fills it (the same code as the website): the preview, the values
 * still missing and why publication would be refused now.
 */
export function VersionPreview({ version }: { version: LegalTextVersionDetail }) {
  const t = useT();
  const p = version.preview;
  const reason = p.publicationProblem ? legalTextRuleMessage(p.publicationProblem, t) : undefined;
  return (
    <section aria-labelledby={`preview-${version.id}`} className="mt-4 space-y-2">
      <h3 id={`preview-${version.id}`} className="text-sm font-semibold text-ink">
        {t("legal.texts.preview.title")}
      </h3>
      <p className="text-xs text-ink-3">{t("legal.texts.preview.hint")}</p>
      <pre
        lang={version.locale}
        className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-sans text-sm leading-relaxed text-ink"
      >
        {p.text}
      </pre>
      <div className="text-sm">
        <p className="font-medium text-ink">{t("legal.texts.preview.missingTitle")}</p>
        {p.missing.length === 0 ? (
          <p key="none" className="text-ink-3">
            {t("legal.texts.preview.none")}
          </p>
        ) : (
          <>
            <ul key="list" className="mt-1 flex flex-wrap gap-1.5">
              {p.missing.map((name) => (
                <li key={name}>
                  <code
                    lang="en"
                    className="rounded bg-amber-soft px-1.5 py-0.5 text-xs text-amber-ink"
                  >
                    {`{${name}}`}
                  </code>
                </li>
              ))}
            </ul>
            <p key="hint" className="mt-1 text-xs text-ink-3">
              {t("legal.texts.preview.missingHint")}
            </p>
          </>
        )}
      </div>
      {reason ? (
        <FormMessage key="blocked" kind="error">
          {t("legal.texts.preview.blocked", { reason })}
        </FormMessage>
      ) : null}
    </section>
  );
}

/** "View text" of one version (the history list renders it from the server). */
export function ViewTextButton({ id, title }: { id: string; title: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
        onClick={() => setOpen(true)}
        aria-label={`${t("legal.texts.current.viewText")}: ${title}`}
      >
        {t("legal.texts.current.viewText")}
      </button>
      {open ? <TextDialog id={id} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type RowDialog =
  | null
  | { kind: "view"; id: string }
  | { kind: "create"; sourceId: string | null }
  | { kind: "edit" }
  | { kind: "publish" }
  | { kind: "review"; target: "current" | "draft" }
  | { kind: "delete" };

/** One document in one language: its current version and its draft, with the allowed actions. */
export function LegalTextLocaleRow({
  docKey,
  locale,
  current,
  draft,
  can,
  englishCurrent,
}: {
  docKey: LegalDocumentKey;
  locale: string;
  current: LegalTextVersionSummary | null;
  draft: LegalTextVersionSummary | null;
  can: LegalTextsOverview["permissions"];
  /** The current English version, the source a translation names. */
  englishCurrent: LegalTextVersionSummary | null;
}) {
  const t = useT();
  const date = useLegalDate();
  const [dialog, setDialog] = useState<RowDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const actions = legalTextActions({ current, draft }, can);
  const doc = documentTitle(docKey, t);
  const language = languageLabel(locale, t);
  const names = { document: doc, language };
  const headingId = useId();
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
  };
  return (
    <section aria-labelledby={headingId} className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {language}
        </h3>
        <Link
          href={`/legal-texts?doc=${docKey}&locale=${encodeURIComponent(locale)}`}
          className="text-sm font-medium text-petrol-strong hover:underline"
          aria-label={t("legal.texts.history.showLabel", names)}
        >
          {t("legal.texts.history.show")}
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t("legal.texts.current.title")}
          </p>
          {current ? (
            <div key="current" className="space-y-2">
              <p className="font-mono text-sm font-medium text-ink">
                {t("legal.texts.current.version", { version: current.version ?? "—" })}
              </p>
              <VersionMeta version={current} />
            </div>
          ) : (
            <p key="none" className="text-sm text-ink-2">
              {t("legal.texts.current.none")}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {current ? (
              <button
                key="view"
                type="button"
                className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
                onClick={() => setDialog({ kind: "view", id: current.id })}
                aria-label={`${t("legal.texts.current.viewText")}: ${doc} (${language})`}
              >
                {t("legal.texts.current.viewText")}
              </button>
            ) : null}
            {actions.current.includes("newDraft") ? (
              <button
                key="new"
                type="button"
                className={cx(buttonStyles.secondary, "h-8 px-2.5 text-xs")}
                onClick={() => setDialog({ kind: "create", sourceId: current?.id ?? null })}
                aria-label={t("legal.texts.draft.newLabel", names)}
              >
                {current ? t("legal.texts.draft.newFromCurrent") : t("legal.texts.draft.newDraft")}
              </button>
            ) : null}
            {actions.current.includes("review") ? (
              <button
                key="review"
                type="button"
                className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
                onClick={() => setDialog({ kind: "review", target: "current" })}
                aria-label={t("legal.texts.review.recordLabel", {
                  ...names,
                  version: current?.version ?? "",
                })}
              >
                {t("legal.texts.review.record")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="space-y-3 rounded-xl border border-dashed border-line-strong p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t("legal.texts.draft.title")}
          </p>
          {draft ? (
            <div key="draft" className="space-y-2">
              <p className="text-sm font-medium text-ink">{t("legal.texts.draft.unnamed")}</p>
              <p className="text-xs text-ink-3">
                {t("legal.texts.draft.edited", {
                  date: date(draft.updatedAt),
                  revision: draft.revision,
                })}
              </p>
              {draft.createdBy ? (
                <p key="by" className="text-xs text-ink-3">
                  {t("legal.texts.draft.createdBy", { name: draft.createdBy.displayName })}
                </p>
              ) : null}
              <VersionMeta version={draft} />
            </div>
          ) : (
            <p key="none" className="text-sm text-ink-2">
              {t("legal.texts.draft.none")}
            </p>
          )}
          {draft && actions.draft.length ? (
            <div key="actions" className="flex flex-wrap gap-1.5">
              {actions.draft.includes("edit") ? (
                <button
                  key="edit"
                  type="button"
                  className={cx(buttonStyles.secondary, "h-8 px-2.5 text-xs")}
                  onClick={() => setDialog({ kind: "edit" })}
                  aria-label={t("legal.texts.draft.editLabel", names)}
                >
                  {t("legal.texts.draft.edit")}
                </button>
              ) : null}
              {actions.draft.includes("publish") ? (
                <button
                  key="publish"
                  type="button"
                  className={cx(buttonStyles.primary, "h-8 px-2.5 text-xs")}
                  onClick={() => setDialog({ kind: "publish" })}
                  aria-label={t("legal.texts.publish.label", names)}
                >
                  {t("legal.texts.publish.action")}
                </button>
              ) : null}
              {actions.draft.includes("review") ? (
                <button
                  key="review"
                  type="button"
                  className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
                  onClick={() => setDialog({ kind: "review", target: "draft" })}
                  aria-label={t("legal.texts.review.recordLabel", {
                    ...names,
                    version: t("legal.texts.draft.unnamed"),
                  })}
                >
                  {t("legal.texts.review.record")}
                </button>
              ) : null}
              {actions.draft.includes("delete") ? (
                <button
                  key="delete"
                  type="button"
                  className={cx(
                    buttonStyles.ghost,
                    "h-8 px-2.5 text-xs text-danger hover:text-danger",
                  )}
                  onClick={() => setDialog({ kind: "delete" })}
                  aria-label={t("legal.texts.draft.deleteLabel", names)}
                >
                  {t("legal.texts.draft.delete")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div aria-live="polite">
        {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}
      </div>
      {dialog?.kind === "view" ? (
        <TextDialog id={dialog.id} title={`${doc} (${language})`} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "create" ? (
        <DraftEditorDialog
          docKey={docKey}
          locale={locale}
          mode="create"
          sourceId={dialog.sourceId}
          sourceTranslates={current?.translatesVersion != null}
          englishCurrent={englishCurrent}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "edit" && draft ? (
        <DraftEditorDialog
          docKey={docKey}
          locale={locale}
          mode="edit"
          sourceId={draft.id}
          sourceTranslates={false}
          englishCurrent={englishCurrent}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "publish" && draft ? (
        <PublishDialog draft={draft} names={names} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === "review" ? (
        <ReviewDialog
          version={dialog.target === "current" ? current : draft}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "delete" && draft ? (
        <DeleteDialog draft={draft} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
    </section>
  );
}

function DraftEditorDialog({
  docKey,
  locale,
  mode,
  sourceId,
  sourceTranslates,
  englishCurrent,
  onClose,
  onDone,
}: {
  docKey: LegalDocumentKey;
  locale: string;
  mode: "create" | "edit";
  /** create: the version whose text prefills the draft (null: empty); edit: the draft itself. */
  sourceId: string | null;
  /** create from a current version that is itself a translation. */
  sourceTranslates: boolean;
  englishCurrent: LegalTextVersionSummary | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const ids = {
    text: useId(),
    note: useId(),
    translates: useId(),
    help: useId(),
    placeholders: useId(),
  };
  const change = useDataChange();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState(1);
  const [initial, setInitial] = useState("");
  const [translates, setTranslates] = useState(sourceTranslates);
  const [staleNotice, setStaleNotice] = useState(false);
  const fill = useCallback(
    (v: LegalTextVersionDetail) => {
      setText(v.text);
      setInitial(v.text);
      setRevision(v.revision);
      // A new draft starts without the earlier note: the note says what to check in THIS change.
      setNote(mode === "edit" ? (v.reviewNote ?? "") : "");
    },
    [mode],
  );
  const { version, error: loadError, loading, reload } = useVersion(sourceId, fill);
  const max = LEGAL_DOCUMENTS[docKey].maxChars;
  const length = textLength(text);
  const offerTranslates = mode === "create" && locale !== "en" && englishCurrent !== null;
  const names = { document: documentTitle(docKey, t), language: languageLabel(locale, t) };
  const title =
    mode === "create"
      ? t("legal.texts.draft.newTitle", names)
      : t("legal.texts.draft.editTitle", names);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setStaleNotice(false);
    const reviewNote = note.trim() === "" ? null : note.trim();
    if (mode === "create") {
      await change.run(
        () =>
          createLegalTextDraft({
            key: docKey,
            locale,
            text,
            reviewNote,
            translatesId: offerTranslates && translates ? (englishCurrent?.id ?? null) : null,
          }),
        () => onDone(t("legal.texts.draft.created")),
      );
      return;
    }
    if (!sourceId) return;
    await change.run(
      () => updateLegalTextDraft(sourceId, { text, reviewNote, revision }),
      () => onDone(t("legal.texts.draft.saved")),
      (failure) => {
        if (failure.rule === "stale") {
          // Someone saved meanwhile: load the latest text and revision, keep the dialog open.
          change.setError(null);
          setStaleNotice(true);
          reload();
        }
      },
    );
  }
  const waiting = sourceId !== null && (loading || (!version && !loadError));
  return (
    <Dialog
      title={title}
      description={<p>{t("legal.texts.draft.resetsReview")}</p>}
      size="lg"
      busy={change.busy}
      dirty={text !== initial}
      closeLabel={t("legal.texts.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            {waiting ? (
              <p key="loading" role="status" className="flex items-center gap-2 text-sm text-ink-3">
                <Spinner size={14} />
                <span>{t("legal.texts.draft.loading")}</span>
              </p>
            ) : null}
            {loadError ? (
              <FormMessage key="loadError" kind="error">
                {loadError}
              </FormMessage>
            ) : null}
            {staleNotice ? (
              <p
                key="stale"
                role="alert"
                className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30"
              >
                {t("legal.texts.draft.stale")}
              </p>
            ) : null}
            {usesPolicyMarkup(docKey) ? (
              <p
                key="help"
                id={ids.help}
                className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2"
              >
                {t("legal.texts.markupHelp", { heading: MARKUP_HEADING, item: MARKUP_ITEM })}
              </p>
            ) : null}
            <p key="placeholders" id={ids.placeholders} className="text-xs text-ink-2">
              {ALLOWED_PLACEHOLDERS[docKey].length === 0 ? (
                t("legal.texts.draft.noPlaceholders")
              ) : (
                <>
                  <span>{t("legal.texts.draft.placeholders")} </span>
                  <code lang="en" className="break-words text-ink-3">
                    {ALLOWED_PLACEHOLDERS[docKey].map((n) => `{${n}}`).join(" ")}
                  </code>
                </>
              )}
            </p>
            <Field
              label={t("legal.texts.draft.text")}
              htmlFor={ids.text}
              hint={t("legal.texts.draft.chars", { count: length, max })}
            >
              <textarea
                id={ids.text}
                lang={locale}
                required
                rows={usesPolicyMarkup(docKey) ? 18 : 8}
                maxLength={max + 2_000}
                spellCheck
                aria-describedby={
                  usesPolicyMarkup(docKey) ? `${ids.help} ${ids.placeholders}` : ids.placeholders
                }
                aria-invalid={length > max || undefined}
                disabled={waiting}
                className={cx(TEXTAREA, usesPolicyMarkup(docKey) && "font-mono text-sm")}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <Field
              label={t("legal.texts.draft.reviewNote")}
              htmlFor={ids.note}
              hint={t("legal.texts.draft.reviewNoteHint")}
            >
              <textarea
                id={ids.note}
                rows={3}
                maxLength={2_000}
                className={TEXTAREA}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {offerTranslates ? (
              <label
                key="translates"
                htmlFor={ids.translates}
                className="flex items-start gap-2 text-sm text-ink"
              >
                <input
                  id={ids.translates}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-petrol"
                  checked={translates}
                  onChange={(e) => setTranslates(e.target.checked)}
                />
                <span>
                  {t("legal.texts.draft.translates", { version: englishCurrent?.version ?? "" })}
                </span>
              </label>
            ) : null}
            {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
          </DialogBody>
          <DialogFooter>
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={onClose}
              disabled={change.busy}
            >
              {t("legal.texts.common.cancel")}
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={change.busy || waiting || length === 0 || length > max}
            >
              {change.busy ? <Spinner size={14} /> : null}
              <span>
                {mode === "create" ? t("legal.texts.draft.create") : t("legal.texts.draft.save")}
              </span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}

function PublishDialog({
  draft,
  names,
  onClose,
  onDone,
}: {
  draft: LegalTextVersionSummary;
  names: { document: string; language: string };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const change = useDataChange();
  const { version, error, loading } = useVersion(draft.id);
  const title = t("legal.texts.publish.title", names);
  async function confirm() {
    if (!version) return;
    const sha256 = version.sha256;
    await change.run(
      () => publishLegalText(version.id, sha256),
      (data) => {
        const published = t("legal.texts.publish.published", {
          version: data.version.version ?? "",
        });
        onDone(
          data.version.legalReview === "REQUIRED"
            ? `${published} ${t("legal.texts.publish.reviewPending")}`
            : published,
        );
      },
    );
  }
  return (
    <Dialog
      title={title}
      role="alertdialog"
      description={<p>{t("legal.texts.publish.text")}</p>}
      size="lg"
      busy={change.busy}
      closeLabel={t("legal.texts.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <>
          <DialogBody>
            <VersionText version={version} error={error} loading={loading} />
            {version ? (
              <p key="hash" className="break-all font-mono text-xs text-ink-3">
                {t("legal.texts.publish.hash", { hash: version.sha256 })}
              </p>
            ) : null}
            {version ? <VersionPreview key="preview" version={version} /> : null}
            {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
          </DialogBody>
          <DialogFooter>
            <button
              type="button"
              data-autofocus=""
              className={buttonStyles.secondary}
              onClick={onClose}
              disabled={change.busy}
            >
              {t("legal.texts.common.cancel")}
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              onClick={() => void confirm()}
              disabled={change.busy || !version || version.preview.publicationProblem !== null}
            >
              {change.busy ? <Spinner size={14} /> : null}
              <span>{t("legal.texts.publish.confirm")}</span>
            </button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

function ReviewDialog({
  version,
  onClose,
  onDone,
}: {
  version: LegalTextVersionSummary | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const change = useDataChange();
  if (!version) return null;
  const target = version;
  if (change.stepUp) {
    return (
      <Dialog
        title={t("owner.stepUp.form")}
        onClose={() => {
          change.clear();
          onClose();
        }}
      >
        {change.stepUp("dialog")}
      </Dialog>
    );
  }
  return (
    <ConfirmDialog
      title={t("legal.texts.review.confirmTitle")}
      text={t("legal.texts.review.confirmText", {
        version: target.version ?? t("legal.texts.draft.unnamed"),
        hash: shortHash(target.sha256),
      })}
      confirmLabel={t("legal.texts.review.confirm")}
      cancelLabel={t("legal.texts.common.cancel")}
      pending={change.busy}
      error={change.error}
      onCancel={() => {
        change.clear();
        onClose();
      }}
      onConfirm={() =>
        void change.run(
          () => approveLegalReview(target.id, target.sha256),
          () => onDone(t("legal.texts.review.recorded")),
        )
      }
    />
  );
}

function DeleteDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: LegalTextVersionSummary;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const change = useDataChange();
  return (
    <ConfirmDialog
      title={t("legal.texts.draft.deleteTitle")}
      text={t("legal.texts.draft.deleteText")}
      confirmLabel={t("legal.texts.draft.delete")}
      cancelLabel={t("legal.texts.common.cancel")}
      danger
      pending={change.busy}
      error={change.error}
      onCancel={() => {
        change.clear();
        onClose();
      }}
      onConfirm={() =>
        void change.run(
          () => deleteLegalTextDraft(draft.id),
          () => onDone(t("legal.texts.draft.deleted")),
        )
      }
    />
  );
}
