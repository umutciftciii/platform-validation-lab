"use client";

import {
  CATALOG_API,
  DOCUMENT_ACCESS_POLICIES,
  DOCUMENT_DEFAULT_LANGUAGE,
  DOCUMENT_DESCRIPTION_MAX,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPE,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_TYPES,
  ErrorBodySchema,
  REVISION_NOTE_HEADER,
  REVISION_NOTE_MAX,
  UPLOAD_FILENAME_HEADER,
  type DocumentAccessPolicy,
  type DocumentRevision,
  type DocumentSite,
  type DocumentSiteState,
  type DocumentType,
  type ProductDocument,
  type ProductDocumentListResponse,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { callCatalog } from "../../lib/catalog-client";
import { formatBytes } from "../../lib/catalog-view";
import { ADMIN_TIME_ZONE, type AdminLocale, INTL_LOCALE } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import { createTranslator } from "../../lib/i18n/translate";
import type { Translate } from "../../lib/i18n/types";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill, type PillTone } from "../ui";
import { Field, FIELD, SITE_SHORT, TEXTAREA } from "./parts";
import { useNotice } from "./notices";

// --- wording ----------------------------------------------------------------------------------

/** English, for callers without a console language (tests). */
const EN: Translate = createTranslator("en");

const POLICY_TONE: Readonly<Record<DocumentAccessPolicy, PillTone>> = {
  PUBLIC: "success",
  MEMBERS_ONLY: "amber",
  LEAD_REQUIRED: "amber",
  INTERNAL: "neutral",
};

/** Label, tone and explanation of an access policy, in the console language. */
export function policyText(
  policy: DocumentAccessPolicy,
  t: Translate = EN,
): { label: string; tone: PillTone; help: string } {
  return {
    label: t(`catalog.media.documents.policy.${policy}.label`),
    tone: POLICY_TONE[policy],
    help: t(`catalog.media.documents.policy.${policy}.help`),
  };
}

const SITE_STATE_TONE: Readonly<Record<DocumentSiteState, PillTone>> = {
  served: "success",
  served_on_request: "success",
  hidden: "neutral",
  internal: "neutral",
  archived: "neutral",
  no_file: "amber",
  product_not_live: "amber",
  awaiting_membership: "amber",
  awaiting_lead_capture: "amber",
  language_not_public: "amber",
};

/** Label and tone of what a site does with a document, in the console language. */
export function siteStateText(
  state: DocumentSiteState,
  t: Translate = EN,
): { label: string; tone: PillTone } {
  return { label: t(`catalog.media.documents.siteState.${state}`), tone: SITE_STATE_TONE[state] };
}

/** ML-9: the languages a document can have (SiteLocale of the caller's sites). */
export type DocumentLanguageOption = ProductDocumentListResponse["languages"][number];

/**
 * ML-9: "English (en)", "Dutch (nl)": the admin names a language in the console language, with its
 * tag (ML-12a; TR "İngilizce (en)"). English keeps the plain "en" names of before.
 */
export function documentLanguageName(tag: string, locale: AdminLocale = "en"): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([locale === "en" ? "en" : INTL_LOCALE[locale]], {
      type: "language",
    }).of(tag);
  } catch {
    name = undefined;
  }
  return name && name !== tag ? `${name} (${tag})` : tag;
}

/**
 * ML-9: the options of the language field — the enabled languages, English always, and the
 * document's own language even when it is no longer enabled (so the field shows the truth).
 */
export function documentLanguageOptions(
  languages: readonly DocumentLanguageOption[],
  current?: string,
): DocumentLanguageOption[] {
  const out = [...languages];
  for (const tag of [DOCUMENT_DEFAULT_LANGUAGE, current]) {
    if (tag && !out.some((l) => l.locale === tag)) {
      out.push({ locale: tag, isDefault: false, public: false });
    }
  }
  return out;
}

/** API rule codes with their own wording (catalog.media.documents.uploadRules). */
const UPLOAD_RULES = [
  "not_pdf",
  "encrypted",
  "active_content",
  "too_complex",
  "too_many_revisions",
  "document_archived",
  "archived",
  "busy",
  "too_long",
] as const;
type UploadRule = (typeof UPLOAD_RULES)[number];

/** The wording of one API rule code, or undefined for a code without its own text. */
function ruleMessage(rule: string, t: Translate): string | undefined {
  if (rule === "empty") return t("catalog.media.upload.empty");
  if ((UPLOAD_RULES as readonly string[]).includes(rule)) {
    return t(`catalog.media.documents.uploadRules.${rule as UploadRule}`);
  }
  return undefined;
}

/** Message for a failed upload answer (status + error body). */
export function documentUploadMessage(status: number, body: unknown, t: Translate = EN): string {
  if (status === 413) return t("catalog.media.documents.tooLarge");
  if (status === 0) return t("catalog.media.upload.interrupted");
  const parsed = ErrorBodySchema.safeParse(body);
  if (!parsed.success) return t("catalog.media.upload.failed");
  for (const d of parsed.data.error.details) {
    const message = typeof d === "object" ? ruleMessage(d.rule, t) : undefined;
    if (message) return message;
  }
  return t(`errors.${parsed.data.error.code}`);
}

/** Checks the browser can make before uploading (the API checks the real content again). */
export function documentPrecheck(
  file: {
    name: string;
    type: string;
    size: number;
  },
  t: Translate = EN,
): string | null {
  const pdfType =
    file.type === DOCUMENT_MIME_TYPE || (file.type === "" && /\.pdf$/i.test(file.name));
  if (!pdfType) return t("catalog.media.documents.uploadRules.not_pdf");
  if (file.size === 0) return t("catalog.media.upload.empty");
  if (file.size > DOCUMENT_MAX_BYTES) return t("catalog.media.documents.tooLarge");
  return null;
}

export const revisionHref = (id: string, disposition: "inline" | "attachment") =>
  `${CATALOG_API}/document-revisions/${id}/${disposition}`;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
};

function sendPdf(
  documentId: string,
  file: File,
  note: string,
  onProgress: (p: number) => void,
  t: Translate,
): Promise<{ ok: true; document: ProductDocument } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/document-upload/${documentId}`);
    // i18n-ignore: HTTP header name
    xhr.setRequestHeader("Content-Type", DOCUMENT_MIME_TYPE);
    xhr.setRequestHeader(UPLOAD_FILENAME_HEADER, encodeURIComponent(file.name).slice(0, 1024));
    if (note.trim()) xhr.setRequestHeader(REVISION_NOTE_HEADER, encodeURIComponent(note.trim()));
    // i18n-ignore: HTTP header name
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status === 201) {
        resolve({ ok: true, document: (body as { document: ProductDocument }).document });
      } else {
        resolve({ ok: false, message: documentUploadMessage(xhr.status, body, t) });
      }
    };
    xhr.onerror = () => resolve({ ok: false, message: documentUploadMessage(0, null, t) });
    xhr.send(file);
  });
}

// --- small parts ------------------------------------------------------------------------------

function TypeBadge({ type }: { type: DocumentType }) {
  const t = useT();
  return (
    <span
      title={t(`catalog.media.documents.types.${type}`)}
      className="inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-petrol-soft font-mono text-xs font-semibold tracking-wide text-petrol-strong ring-1 ring-petrol/20"
    >
      {type === "OTHER" ? "PDF" : type}
    </span>
  );
}

function PolicyPill({ policy }: { policy: DocumentAccessPolicy }) {
  const p = policyText(policy, useT());
  return <StatusPill tone={p.tone}>{p.label}</StatusPill>;
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className="h-full rounded-full bg-petrol transition-[width]"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function FilePicker({
  id,
  file,
  onFile,
  error,
}: {
  id: string;
  file: File | null;
  onFile: (f: File | null) => void;
  error: string | null;
}) {
  const t = useT();
  const locale = useAdminLocale();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFile(e.dataTransfer.files[0] ?? null);
        }}
        className={cx(
          "flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors",
          over ? "border-petrol bg-petrol-soft" : "border-line-strong bg-surface-2/50",
          error && "border-danger",
        )}
      >
        <Icon name="document" size={22} className="text-ink-3" />
        {file ? (
          <p key="file" className="max-w-full truncate text-sm font-medium text-ink">
            {file.name}{" "}
            <span className="font-normal text-ink-3">· {formatBytes(file.size, locale)}</span>
          </p>
        ) : (
          <p key="empty" className="text-sm text-ink-2">
            {t("catalog.media.documents.picker.dropHere")}
          </p>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-sm font-medium text-petrol-strong underline-offset-2 hover:underline"
        >
          {file
            ? t("catalog.media.documents.picker.chooseAnother")
            : t("catalog.media.documents.picker.choose")}
        </button>
        <p className="text-xs text-ink-3">{t("catalog.media.documents.picker.rules")}</p>
        <input
          ref={input}
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label={t("catalog.media.documents.picker.inputLabel")}
          onChange={(e) => {
            onFile(e.currentTarget.files?.[0] ?? null);
            e.currentTarget.value = "";
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- forms ------------------------------------------------------------------------------------

interface DetailsValue {
  type: DocumentType;
  title: string;
  description: string;
  accessPolicy: DocumentAccessPolicy;
  language: string;
}

function DetailsFields({
  value,
  onChange,
  languages,
  languageLocked = false,
}: {
  value: DetailsValue;
  onChange: (v: DetailsValue) => void;
  languages: readonly DocumentLanguageOption[];
  /** ML-9: shown on a site; the language is fixed until it is hidden everywhere. */
  languageLocked?: boolean;
}) {
  const id = useId();
  const t = useT();
  const locale = useAdminLocale();
  const options = documentLanguageOptions(languages, value.language);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label={t("catalog.media.documents.fields.type")} htmlFor={`${id}-type`}>
        <select
          id={`${id}-type`}
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as DocumentType })}
          className={FIELD}
        >
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === "OTHER"
                ? t("catalog.media.documents.fields.typeOther")
                : t("catalog.media.documents.fields.typeOption", {
                    code: type,
                    label: t(`catalog.media.documents.types.${type}`),
                  })}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={t("catalog.media.documents.fields.title")}
        htmlFor={`${id}-title`}
        className="sm:col-span-2"
      >
        <input
          id={`${id}-title`}
          required
          maxLength={DOCUMENT_TITLE_MAX}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={t("catalog.media.documents.fields.titlePlaceholder")}
          className={FIELD}
        />
      </Field>
      <Field
        label={t("catalog.media.documents.fields.description")}
        htmlFor={`${id}-desc`}
        className="sm:col-span-3"
      >
        <textarea
          id={`${id}-desc`}
          maxLength={DOCUMENT_DESCRIPTION_MAX}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          className={cx(TEXTAREA, "min-h-20")}
        />
      </Field>
      <Field
        label={t("catalog.media.documents.fields.language")}
        htmlFor={`${id}-language`}
        className="sm:col-span-3"
        hint={
          languageLocked
            ? t("catalog.media.documents.fields.languageLockedHint")
            : t("catalog.media.documents.fields.languageHint")
        }
      >
        <select
          id={`${id}-language`}
          value={value.language}
          disabled={languageLocked}
          onChange={(e) => onChange({ ...value, language: e.target.value })}
          className={cx(FIELD, "sm:max-w-sm")}
        >
          {options.map((l) => (
            <option key={l.locale} value={l.locale}>
              {documentLanguageName(l.locale, locale)}
              {l.public ? "" : t("catalog.media.documents.fields.notPublic")}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="sm:col-span-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">
          {t("catalog.media.documents.fields.access")}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DOCUMENT_ACCESS_POLICIES.map((p) => (
            <label
              key={p}
              className={cx(
                "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
                value.accessPolicy === p
                  ? "border-petrol bg-petrol-soft/60 ring-1 ring-petrol/30"
                  : "border-line hover:border-line-strong",
              )}
            >
              <input
                type="radio"
                name={`${id}-policy`}
                value={p}
                checked={value.accessPolicy === p}
                onChange={() => onChange({ ...value, accessPolicy: p })}
                className="mt-1 accent-[var(--petrol)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  {t(`catalog.media.documents.policy.${p}.label`)}
                </span>
                <span className="block text-xs leading-relaxed text-ink-3">
                  {t(`catalog.media.documents.policy.${p}.help`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function NewDocumentForm({
  productId,
  languages,
  onCreated,
  onCancel,
}: {
  productId: string;
  languages: readonly DocumentLanguageOption[];
  onCreated: (doc: ProductDocument, uploaded: boolean) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const t = useT();
  const [value, setValue] = useState<DetailsValue>({
    type: "TDS",
    title: "",
    description: "",
    accessPolicy: "INTERNAL",
    language: DOCUMENT_DEFAULT_LANGUAGE,
  });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = file
      ? documentPrecheck(file, t)
      : t("catalog.media.documents.create.chooseFile");
    setFileError(problem);
    if (problem || !file) return;
    setBusy(true);
    const created = await callCatalog<{ document: ProductDocument }>(
      "POST",
      `/products/${productId}/documents`,
      {
        type: value.type,
        title: value.title,
        description: value.description || null,
        accessPolicy: value.accessPolicy,
        language: value.language,
      },
    );
    if (!created.ok) {
      setBusy(false);
      setError(created.message);
      return;
    }
    const up = await sendPdf(created.data.document.id, file, note, setProgress, t);
    setBusy(false);
    if (!up.ok) {
      // The document exists without a file: keep it and say what to do next.
      onCreated(created.data.document, false);
      setError(t("catalog.media.documents.create.fileRefused", { message: up.message }));
      return;
    }
    onCreated(up.document, true);
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${id}-heading`}
      className="space-y-5 rounded-xl border border-line bg-surface-2/40 p-4 sm:p-5"
    >
      <h3 id={`${id}-heading`} className="text-base font-semibold text-ink">
        {t("catalog.media.documents.create.heading")}
      </h3>
      <DetailsFields value={value} onChange={setValue} languages={languages} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FilePicker
          id={`${id}-file`}
          file={file}
          onFile={(f) => {
            setFile(f);
            setFileError(f ? documentPrecheck(f, t) : null);
          }}
          error={fileError}
        />
        <Field
          label={t("catalog.media.documents.fields.noteLabel")}
          htmlFor={`${id}-note`}
          hint={t("catalog.media.documents.create.noteHint")}
        >
          <textarea
            id={`${id}-note`}
            maxLength={REVISION_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("catalog.media.documents.create.notePlaceholder")}
            className={cx(TEXTAREA, "min-h-24")}
          />
        </Field>
      </div>
      {busy ? (
        <ProgressBar value={progress} label={t("catalog.media.documents.picker.uploading")} />
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className={buttonStyles.secondary}>
          {t("catalog.media.documents.create.cancel")}
        </button>
        <button type="submit" disabled={busy} className={buttonStyles.primary}>
          {busy ? <Spinner /> : <Icon name="upload" size={18} />}
          <span>{t("catalog.media.documents.create.submit")}</span>
        </button>
      </div>
    </form>
  );
}

// --- one document -----------------------------------------------------------------------------

function RevisionMeta({ rev }: { rev: DocumentRevision }) {
  const t = useT();
  const locale = useAdminLocale();
  const parts = {
    number: rev.revisionNumber,
    size: formatBytes(rev.byteSize, locale),
    date: dateTimeFormat(locale, DATE_OPTIONS).format(new Date(rev.createdAt)),
    by: rev.uploadedBy.displayName ?? t("catalog.media.documents.revision.staff"),
  };
  return (
    <span className="tabular text-xs text-ink-3">
      {rev.pageCount
        ? t("catalog.media.documents.revision.metaWithPages", {
            ...parts,
            pages: t("catalog.media.documents.revision.pages", { count: rev.pageCount }),
          })
        : t("catalog.media.documents.revision.meta", parts)}
    </span>
  );
}

function FileLinks({ rev, compact = false }: { rev: DocumentRevision; compact?: boolean }) {
  const t = useT();
  return (
    <span className="flex shrink-0 gap-1">
      <a
        href={revisionHref(rev.id, "inline")}
        target="_blank"
        rel="noopener noreferrer"
        className={compact ? buttonStyles.icon : buttonStyles.ghost}
      >
        <Icon name="eye" size={16} />
        <span className={compact ? "sr-only" : undefined}>
          {t("catalog.media.documents.revision.preview")}
        </span>
        <span className="sr-only">
          {t("catalog.media.documents.revision.previewSr", { number: rev.revisionNumber })}
        </span>
      </a>
      <a
        href={revisionHref(rev.id, "attachment")}
        download
        className={compact ? buttonStyles.icon : buttonStyles.ghost}
      >
        <Icon name="download" size={16} />
        <span className={compact ? "sr-only" : undefined}>
          {t("catalog.media.documents.revision.download")}
        </span>
        <span className="sr-only">
          {t("catalog.media.documents.revision.downloadSr", { number: rev.revisionNumber })}
        </span>
      </a>
    </span>
  );
}

function SiteRow({
  doc,
  site,
  busy,
  onToggle,
  onRepin,
}: {
  doc: ProductDocument;
  site: DocumentSite;
  busy: boolean;
  onToggle: (site: DocumentSite) => void;
  onRepin: (site: DocumentSite) => void;
}) {
  const t = useT();
  const state = siteStateText(site.state, t);
  const blocked =
    doc.status === "ARCHIVED" || doc.accessPolicy === "INTERNAL" || !doc.activeRevision;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-36 shrink-0 text-sm font-medium text-ink sm:w-44">
          {SITE_SHORT[site.siteKey]}
        </span>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
        {site.pinnedRevision ? (
          <span className="text-xs text-ink-3">
            {t("catalog.media.documents.site.serves", {
              number: site.pinnedRevision.revisionNumber,
            })}
          </span>
        ) : null}
        {site.updateAvailable && doc.activeRevision ? (
          <StatusPill tone="amber">
            {t("catalog.media.documents.site.awaits", {
              number: doc.activeRevision.revisionNumber,
            })}
          </StatusPill>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {site.canPublish && site.updateAvailable && doc.activeRevision && !blocked ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRepin(site)}
            className={cx(buttonStyles.primary, "h-9 px-3 text-sm")}
          >
            {t("catalog.media.documents.site.publish", {
              number: doc.activeRevision.revisionNumber,
              site: SITE_SHORT[site.siteKey],
            })}
          </button>
        ) : null}
        {site.canPublish ? (
          <button
            type="button"
            role="switch"
            aria-checked={site.enabled}
            disabled={busy || (!site.enabled && blocked)}
            onClick={() => onToggle(site)}
            className={cx(buttonStyles.secondary, "h-9 px-3 text-sm")}
            title={!site.enabled && blocked ? t("catalog.media.documents.site.blocked") : undefined}
          >
            <span
              aria-hidden="true"
              className={cx(
                "relative inline-flex h-4 w-7 rounded-full transition-colors",
                site.enabled ? "bg-petrol" : "bg-line-strong",
              )}
            >
              <span
                className={cx(
                  "absolute top-0.5 size-3 rounded-full bg-surface shadow transition-transform",
                  site.enabled ? "translate-x-3.5" : "translate-x-0.5",
                )}
              />
            </span>
            {site.enabled
              ? t("catalog.media.documents.site.shownOn", { site: SITE_SHORT[site.siteKey] })
              : t("catalog.media.documents.site.showOn", { site: SITE_SHORT[site.siteKey] })}
          </button>
        ) : (
          <span className="text-xs text-ink-3">
            {site.enabled
              ? t("catalog.media.documents.site.shownByPublisher")
              : t("catalog.media.documents.site.notShown")}
          </span>
        )}
      </span>
    </li>
  );
}

function DocumentCard({
  doc,
  canEdit,
  productArchived,
  languages,
  onChange,
}: {
  doc: ProductDocument;
  canEdit: boolean;
  productArchived: boolean;
  languages: readonly DocumentLanguageOption[];
  onChange: (doc: ProductDocument, message: string) => void;
}) {
  const id = useId();
  const t = useT();
  const locale = useAdminLocale();
  const router = useRouter();
  const notify = useNotice();
  const [mode, setMode] = useState<"view" | "edit" | "upload">("view");
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<DetailsValue>({
    type: doc.type,
    title: doc.title,
    description: doc.description ?? "",
    accessPolicy: doc.accessPolicy,
    language: doc.language,
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(0);
  const editable = canEdit && !productArchived && doc.status === "ACTIVE";
  const archived = doc.status === "ARCHIVED";

  async function run(
    key: string,
    call: () => Promise<
      { ok: true; data: { document: ProductDocument } } | { ok: false; message: string }
    >,
    message: string,
  ) {
    setBusy(key);
    const r = await call();
    setBusy(null);
    if (!r.ok) {
      notify?.(r.message, "error");
      router.refresh();
      return;
    }
    onChange(r.data.document, message);
    setMode("view");
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    await run(
      "details",
      () =>
        callCatalog<{ document: ProductDocument }>("POST", `/documents/${doc.id}`, {
          type: details.type,
          title: details.title,
          description: details.description || null,
          accessPolicy: details.accessPolicy,
          language: details.language,
          version: doc.version,
        }),
      t("catalog.media.documents.notices.detailsSaved"),
    );
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    const problem = file
      ? documentPrecheck(file, t)
      : t("catalog.media.documents.create.chooseFile");
    setFileError(problem);
    if (problem || !file) return;
    setBusy("upload");
    const r = await sendPdf(doc.id, file, note, setProgress, t);
    setBusy(null);
    if (!r.ok) {
      setFileError(r.message);
      return;
    }
    setFile(null);
    setNote("");
    onChange(
      r.document,
      r.document.sites.some((x) => x.updateAvailable)
        ? t("catalog.media.documents.notices.uploadedPending", {
            number: r.document.revisionCount,
          })
        : t("catalog.media.documents.notices.uploaded", { number: r.document.revisionCount }),
    );
    setMode("view");
  }

  const toggleSite = (site: DocumentSite) =>
    run(
      `site-${site.siteId}`,
      () =>
        callCatalog<{ document: ProductDocument }>(
          "POST",
          `/documents/${doc.id}/sites/${site.siteId}`,
          site.enabled
            ? { visible: false, version: doc.version }
            : // DP-086: showing pins the active revision the publisher sees now.
              { visible: true, version: doc.version, revisionId: doc.activeRevision?.id },
        ),
      site.enabled
        ? t("catalog.media.documents.notices.hidden", { site: SITE_SHORT[site.siteKey] })
        : t("catalog.media.documents.notices.shown", {
            site: SITE_SHORT[site.siteKey],
            number: doc.activeRevision?.revisionNumber ?? "",
          }),
    );

  /** DP-086: the publisher's explicit approval of the new active revision for one site. */
  const repinSite = (site: DocumentSite) =>
    run(
      `site-${site.siteId}`,
      () =>
        callCatalog<{ document: ProductDocument }>(
          "POST",
          `/documents/${doc.id}/sites/${site.siteId}`,
          { visible: true, version: doc.version, revisionId: doc.activeRevision?.id },
        ),
      t("catalog.media.documents.notices.repinned", {
        site: SITE_SHORT[site.siteKey],
        number: doc.activeRevision?.revisionNumber ?? "",
      }),
    );

  const setArchived = (archive: boolean) => {
    if (
      archive &&
      !window.confirm(t("catalog.media.documents.card.archiveConfirm", { title: doc.title }))
    )
      return;
    void run(
      "archive",
      () =>
        callCatalog<{ document: ProductDocument }>(
          "POST",
          `/documents/${doc.id}/${archive ? "archive" : "restore"}`,
          { version: doc.version },
        ),
      archive
        ? t("catalog.media.documents.notices.archived")
        : t("catalog.media.documents.notices.restored"),
    );
  };

  const activate = (rev: DocumentRevision) =>
    run(
      `rev-${rev.id}`,
      () =>
        callCatalog<{ document: ProductDocument }>(
          "POST",
          `/document-revisions/${rev.id}/activate`,
          {
            version: doc.version,
          },
        ),
      t("catalog.media.documents.notices.activated", { number: rev.revisionNumber }),
    );

  return (
    <li
      aria-labelledby={`${id}-title`}
      className={cx(
        "rounded-xl border bg-surface",
        archived ? "border-dashed border-line-strong opacity-80" : "border-line",
      )}
    >
      <div className="flex gap-3 p-4">
        <TypeBadge type={doc.type} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`${id}-title`}
              className="min-w-0 break-words text-[0.9375rem] font-semibold text-ink"
            >
              {doc.title}
            </h3>
            <PolicyPill policy={doc.accessPolicy} />
            <StatusPill tone="neutral">{documentLanguageName(doc.language, locale)}</StatusPill>
            {archived ? (
              <StatusPill tone="neutral">{t("catalog.media.documents.card.archived")}</StatusPill>
            ) : null}
          </div>
          {doc.description ? <p className="text-sm text-ink-2">{doc.description}</p> : null}
          {doc.activeRevision ? (
            <RevisionMeta rev={doc.activeRevision} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-amber-ink">
              <Icon name="alert" size={13} />
              {t("catalog.media.documents.card.noFile")}
            </p>
          )}
        </div>
        {doc.activeRevision ? (
          <div className="hidden sm:block">
            <FileLinks rev={doc.activeRevision} />
          </div>
        ) : null}
      </div>
      {doc.activeRevision ? (
        <div className="-mt-2 px-4 pb-2 sm:hidden">
          <FileLinks rev={doc.activeRevision} />
        </div>
      ) : null}

      {doc.sites.length ? (
        <div className="border-t border-line px-4 py-1">
          <h4 className="sr-only">{t("catalog.media.documents.card.sites")}</h4>
          <ul className="divide-y divide-line">
            {doc.sites.map((s) => (
              <SiteRow
                key={s.siteId}
                doc={doc}
                site={s}
                busy={busy !== null}
                onToggle={(site) => void toggleSite(site)}
                onRepin={(site) => void repinSite(site)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {mode === "edit" ? (
        <form onSubmit={saveDetails} className="space-y-4 border-t border-line p-4">
          <DetailsFields
            value={details}
            onChange={setDetails}
            languages={languages}
            languageLocked={doc.sites.some((x) => x.enabled)}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => setMode("view")}
            >
              {t("catalog.media.documents.card.cancel")}
            </button>
            <button type="submit" disabled={busy !== null} className={buttonStyles.primary}>
              {busy === "details" ? <Spinner /> : <Icon name="check" size={18} />}
              <span>{t("catalog.media.documents.card.saveDetails")}</span>
            </button>
          </div>
        </form>
      ) : null}

      {mode === "upload" ? (
        <form onSubmit={upload} className="space-y-4 border-t border-line p-4">
          <p className="text-sm text-ink-2">
            {t("catalog.media.documents.card.uploadIntro", { number: doc.revisionCount + 1 })}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FilePicker
              id={`${id}-file`}
              file={file}
              onFile={(f) => {
                setFile(f);
                setFileError(f ? documentPrecheck(f, t) : null);
              }}
              error={fileError}
            />
            <Field label={t("catalog.media.documents.fields.noteLabel")} htmlFor={`${id}-note`}>
              <textarea
                id={`${id}-note`}
                maxLength={REVISION_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("catalog.media.documents.card.notePlaceholder")}
                className={cx(TEXTAREA, "min-h-24")}
              />
            </Field>
          </div>
          {busy === "upload" ? (
            <ProgressBar value={progress} label={t("catalog.media.documents.picker.uploading")} />
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => setMode("view")}
            >
              {t("catalog.media.documents.card.cancel")}
            </button>
            <button type="submit" disabled={busy !== null} className={buttonStyles.primary}>
              {busy === "upload" ? <Spinner /> : <Icon name="upload" size={18} />}
              <span>{t("catalog.media.documents.card.uploadRevision")}</span>
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
        {doc.revisions.length ? (
          <details className="group w-full sm:w-auto sm:flex-1">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Icon name="history" size={16} />
              {t("catalog.media.documents.card.history")}
              <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
                {doc.revisions.length}
              </span>
              <Icon
                name="chevron"
                size={14}
                className="transition-transform group-open:rotate-90"
              />
            </summary>
            <ol
              className="mt-1 space-y-1 px-2 pb-2"
              aria-label={t("catalog.media.documents.card.historyLabel", { title: doc.title })}
            >
              {doc.revisions.map((rev) => (
                <li
                  key={rev.id}
                  className={cx(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2",
                    rev.isActive ? "bg-petrol-soft/60 ring-1 ring-petrol/20" : "bg-surface-2/60",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {t("catalog.media.documents.card.revision", {
                          number: rev.revisionNumber,
                        })}
                      </span>
                      {rev.isActive ? (
                        <StatusPill tone="petrol">
                          {t("catalog.media.documents.card.active")}
                        </StatusPill>
                      ) : null}
                    </span>
                    <span
                      className="block truncate text-xs text-ink-3"
                      title={rev.originalFilename}
                    >
                      {rev.originalFilename}
                    </span>
                    <RevisionMeta rev={rev} />
                    {rev.changeNote ? (
                      <span className="mt-0.5 block whitespace-pre-line text-xs text-ink-2">
                        {rev.changeNote}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-1">
                    {editable && !rev.isActive ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void activate(rev)}
                        className={cx(buttonStyles.ghost, "h-8")}
                      >
                        {busy === `rev-${rev.id}` ? <Spinner /> : <Icon name="check" size={15} />}
                        <span>{t("catalog.media.documents.card.makeActive")}</span>
                      </button>
                    ) : null}
                    <FileLinks rev={rev} compact />
                  </span>
                </li>
              ))}
            </ol>
            <p className="px-2 pb-2 text-xs text-ink-3">
              {t("catalog.media.documents.card.immutable")}
            </p>
          </details>
        ) : (
          <span className="flex-1" />
        )}
        {editable ? (
          <span className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setMode(mode === "upload" ? "view" : "upload")}
              aria-expanded={mode === "upload"}
              className={buttonStyles.ghost}
            >
              <Icon name="upload" size={16} />
              {t("catalog.media.documents.card.newRevision")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setMode(mode === "edit" ? "view" : "edit")}
              aria-expanded={mode === "edit"}
              className={buttonStyles.ghost}
            >
              <Icon name="edit" size={16} />
              {t("catalog.media.documents.card.details")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setArchived(true)}
              className={cx(buttonStyles.ghost, "hover:text-danger")}
            >
              <Icon name="archive" size={16} />
              {t("catalog.media.documents.card.archive")}
            </button>
          </span>
        ) : canEdit && archived && !productArchived ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setArchived(false)}
            className={cx(buttonStyles.ghost, "ml-auto")}
          >
            <Icon name="refresh" size={16} />
            {t("catalog.media.documents.card.restore")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

// --- the section ------------------------------------------------------------------------------

export function DocumentManager({
  productId,
  initial,
  canEdit,
  productArchived,
  languages = [],
}: {
  productId: string;
  initial: readonly ProductDocument[];
  canEdit: boolean;
  productArchived: boolean;
  /** ML-9: the languages a document can have (`ProductDocumentListResponse.languages`). */
  languages?: readonly DocumentLanguageOption[];
}) {
  const t = useT();
  const router = useRouter();
  const notify = useNotice();
  const [docs, setDocs] = useState<ProductDocument[]>([...initial]);
  const [creating, setCreating] = useState(false);
  const active = docs.filter((d) => d.status === "ACTIVE");
  const archived = docs.filter((d) => d.status === "ARCHIVED");

  function replace(doc: ProductDocument, message: string) {
    setDocs((list) =>
      list.some((d) => d.id === doc.id)
        ? list.map((d) => (d.id === doc.id ? doc : d))
        : [...list, doc],
    );
    notify?.(message);
    router.refresh();
  }

  const card = (d: ProductDocument) => (
    <DocumentCard
      key={`${d.id}:${d.version}`}
      doc={d}
      canEdit={canEdit}
      productArchived={productArchived}
      languages={languages}
      onChange={replace}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl bg-surface-2/60 px-4 py-3 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl">
          {t("catalog.media.documents.section.introBefore")}
          <em>{t("catalog.media.documents.section.introAnd")}</em>
          {t("catalog.media.documents.section.introMiddle")}
          <strong>{t("catalog.media.documents.section.introInternal")}</strong>
          {t("catalog.media.documents.section.introAfter")}
        </p>
        {canEdit && !productArchived && !creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cx(buttonStyles.primary, "shrink-0")}
          >
            <Icon name="plus" size={18} />
            {t("catalog.media.documents.section.newDocument")}
          </button>
        ) : null}
      </div>

      {creating ? (
        <NewDocumentForm
          productId={productId}
          languages={languages}
          onCancel={() => setCreating(false)}
          onCreated={(doc, uploaded) => {
            replace(
              doc,
              uploaded
                ? t("catalog.media.documents.notices.created")
                : t("catalog.media.documents.notices.createdNoFile"),
            );
            if (uploaded) setCreating(false);
          }}
        />
      ) : null}

      {active.length === 0 && !creating ? (
        <EmptyState icon="list" title={t("catalog.media.documents.section.emptyTitle")}>
          {canEdit && !productArchived
            ? t("catalog.media.documents.section.emptyEditable")
            : t("catalog.media.documents.section.emptyReadOnly")}
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label={t("catalog.media.documents.section.listLabel")}>
          {active.map(card)}
        </ul>
      )}

      {archived.length ? (
        <details className="group rounded-xl border border-line">
          <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-ink-2 hover:text-ink">
            <Icon name="archive" size={16} />
            {t("catalog.media.documents.section.archivedTitle")}
            <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
              {archived.length}
            </span>
            <Icon
              name="chevron"
              size={14}
              className="ml-auto transition-transform group-open:rotate-90"
            />
          </summary>
          <ul
            className="space-y-3 p-3"
            aria-label={t("catalog.media.documents.section.archivedTitle")}
          >
            {archived.map(card)}
          </ul>
        </details>
      ) : null}

      {canEdit && productArchived ? (
        <p className="text-sm text-ink-3">{t("catalog.media.documents.section.productArchived")}</p>
      ) : null}
    </div>
  );
}
