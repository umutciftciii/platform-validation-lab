"use client";

import {
  CATALOG_API,
  DEFAULT_ERROR_MESSAGES,
  DOCUMENT_ACCESS_POLICIES,
  DOCUMENT_DESCRIPTION_MAX,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPE,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_TYPE_LABELS,
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
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { callCatalog } from "../../lib/catalog-client";
import { formatBytes } from "../../lib/catalog-view";
import { Icon } from "../icons";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill, type PillTone } from "../ui";
import { Field, FIELD, SITE_SHORT, TEXTAREA } from "./parts";
import { useNotice } from "./notices";

// --- wording ----------------------------------------------------------------------------------

export const POLICY_TEXT: Readonly<
  Record<DocumentAccessPolicy, { label: string; tone: PillTone; help: string }>
> = {
  PUBLIC: {
    label: "Public",
    tone: "success",
    help: "Anyone can download it on a site that shows it, while the product is published there.",
  },
  MEMBERS_ONLY: {
    label: "Members only",
    tone: "amber",
    help: "Listed on the site, but not downloadable until member accounts exist (DP-039).",
  },
  LEAD_REQUIRED: {
    label: "Lead required",
    tone: "amber",
    help: "Listed on the site, but not downloadable until the request form and download grants exist (DP-042, DP-043).",
  },
  INTERNAL: {
    label: "Internal",
    tone: "neutral",
    help: "Staff only. Never listed or served on a public site.",
  },
};

export const SITE_STATE_TEXT: Readonly<
  Record<DocumentSiteState, { label: string; tone: PillTone }>
> = {
  served: { label: "Downloadable", tone: "success" },
  served_on_request: { label: "Downloadable after request form", tone: "success" },
  hidden: { label: "Not shown", tone: "neutral" },
  internal: { label: "Internal only", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
  no_file: { label: "No file yet", tone: "amber" },
  product_not_live: { label: "Waits for publication", tone: "amber" },
  awaiting_membership: { label: "Listed, download closed", tone: "amber" },
  awaiting_lead_capture: { label: "Listed, download closed", tone: "amber" },
};

const UPLOAD_RULES: Readonly<Record<string, string>> = {
  not_pdf: "Not a PDF file (the content was checked, not the name).",
  empty: "The file is empty.",
  encrypted: "Password-protected or encrypted PDFs are not accepted. Save an unprotected copy.",
  active_content:
    "The PDF contains active content (JavaScript, embedded files, launch or form actions). Export or print it to a plain PDF and try again.",
  too_complex: "The PDF could not be inspected safely. Export or print it to a plain PDF again.",
  too_many_revisions: "This document already has the maximum number of revisions.",
  document_archived: "Archived documents cannot get new revisions. Restore it first.",
  archived: "Documents of an archived product cannot change.",
  busy: "File processing is busy. Try again in a moment.",
  too_long: "The change note is too long.",
};

/** Message for a failed upload answer (status + error body). */
export function documentUploadMessage(status: number, body: unknown): string {
  if (status === 413) return "Too large: at most 20 MB per PDF.";
  if (status === 0) return "The upload was interrupted.";
  const parsed = ErrorBodySchema.safeParse(body);
  if (!parsed.success) return "The upload failed. Try again.";
  for (const d of parsed.data.error.details) {
    if (typeof d === "object" && UPLOAD_RULES[d.rule]) return UPLOAD_RULES[d.rule] as string;
  }
  return DEFAULT_ERROR_MESSAGES[parsed.data.error.code];
}

/** Checks the browser can make before uploading (the API checks the real content again). */
export function documentPrecheck(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const pdfType =
    file.type === DOCUMENT_MIME_TYPE || (file.type === "" && /\.pdf$/i.test(file.name));
  if (!pdfType) return UPLOAD_RULES["not_pdf"] as string;
  if (file.size === 0) return UPLOAD_RULES["empty"] as string;
  if (file.size > DOCUMENT_MAX_BYTES) return "Too large: at most 20 MB per PDF.";
  return null;
}

export const revisionHref = (id: string, disposition: "inline" | "attachment") =>
  `${CATALOG_API}/document-revisions/${id}/${disposition}`;

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

function sendPdf(
  documentId: string,
  file: File,
  note: string,
  onProgress: (p: number) => void,
): Promise<{ ok: true; document: ProductDocument } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/document-upload/${documentId}`);
    xhr.setRequestHeader("Content-Type", DOCUMENT_MIME_TYPE);
    xhr.setRequestHeader(UPLOAD_FILENAME_HEADER, encodeURIComponent(file.name).slice(0, 1024));
    if (note.trim()) xhr.setRequestHeader(REVISION_NOTE_HEADER, encodeURIComponent(note.trim()));
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
        resolve({ ok: false, message: documentUploadMessage(xhr.status, body) });
      }
    };
    xhr.onerror = () => resolve({ ok: false, message: documentUploadMessage(0, null) });
    xhr.send(file);
  });
}

// --- small parts ------------------------------------------------------------------------------

function TypeBadge({ type }: { type: DocumentType }) {
  return (
    <span
      title={DOCUMENT_TYPE_LABELS[type]}
      className="inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-petrol-soft font-mono text-xs font-semibold tracking-wide text-petrol-strong ring-1 ring-petrol/20"
    >
      {type === "OTHER" ? "PDF" : type}
    </span>
  );
}

function PolicyPill({ policy }: { policy: DocumentAccessPolicy }) {
  const p = POLICY_TEXT[policy];
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
          <p className="max-w-full truncate text-sm font-medium text-ink">
            {file.name} <span className="font-normal text-ink-3">· {formatBytes(file.size)}</span>
          </p>
        ) : (
          <p className="text-sm text-ink-2">Drag a PDF here, or</p>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-sm font-medium text-petrol-strong underline-offset-2 hover:underline"
        >
          {file ? "Choose another file" : "choose a file"}
        </button>
        <p className="text-xs text-ink-3">
          PDF · up to 20 MB · no passwords, JavaScript or embedded files
        </p>
        <input
          ref={input}
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a PDF file"
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
}

function DetailsFields({
  value,
  onChange,
}: {
  value: DetailsValue;
  onChange: (v: DetailsValue) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label="Type" htmlFor={`${id}-type`}>
        <select
          id={`${id}-type`}
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as DocumentType })}
          className={FIELD}
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "OTHER" ? "Other (general PDF)" : `${t} · ${DOCUMENT_TYPE_LABELS[t]}`}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Title" htmlFor={`${id}-title`} className="sm:col-span-2">
        <input
          id={`${id}-title`}
          required
          maxLength={DOCUMENT_TITLE_MAX}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="e.g. ICCSYN 6 technical data sheet (EN)"
          className={FIELD}
        />
      </Field>
      <Field label="Description (optional)" htmlFor={`${id}-desc`} className="sm:col-span-3">
        <textarea
          id={`${id}-desc`}
          maxLength={DOCUMENT_DESCRIPTION_MAX}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          className={cx(TEXTAREA, "min-h-20")}
        />
      </Field>
      <fieldset className="sm:col-span-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">Access on public sites</legend>
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
                <span className="block text-sm font-medium text-ink">{POLICY_TEXT[p].label}</span>
                <span className="block text-xs leading-relaxed text-ink-3">
                  {POLICY_TEXT[p].help}
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
  onCreated,
  onCancel,
}: {
  productId: string;
  onCreated: (doc: ProductDocument, uploaded: boolean) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState<DetailsValue>({
    type: "TDS",
    title: "",
    description: "",
    accessPolicy: "INTERNAL",
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
    const problem = file ? documentPrecheck(file) : "Choose the PDF file.";
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
      },
    );
    if (!created.ok) {
      setBusy(false);
      setError(created.message);
      return;
    }
    const up = await sendPdf(created.data.document.id, file, note, setProgress);
    setBusy(false);
    if (!up.ok) {
      // The document exists without a file: keep it and say what to do next.
      onCreated(created.data.document, false);
      setError(`The document was created, but the file was refused: ${up.message}`);
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
        New document
      </h3>
      <DetailsFields value={value} onChange={setValue} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FilePicker
          id={`${id}-file`}
          file={file}
          onFile={(f) => {
            setFile(f);
            setFileError(f ? documentPrecheck(f) : null);
          }}
          error={fileError}
        />
        <Field
          label="Change note (optional)"
          htmlFor={`${id}-note`}
          hint="Stored with revision 1. Revisions can never be edited later."
        >
          <textarea
            id={`${id}-note`}
            maxLength={REVISION_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. First issue, English"
            className={cx(TEXTAREA, "min-h-24")}
          />
        </Field>
      </div>
      {busy ? <ProgressBar value={progress} label="Uploading the PDF" /> : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className={buttonStyles.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={busy} className={buttonStyles.primary}>
          {busy ? <Spinner /> : <Icon name="upload" size={18} />}
          Create and upload
        </button>
      </div>
    </form>
  );
}

// --- one document -----------------------------------------------------------------------------

function RevisionMeta({ rev }: { rev: DocumentRevision }) {
  return (
    <span className="tabular text-xs text-ink-3">
      Rev {rev.revisionNumber} · {formatBytes(rev.byteSize)}
      {rev.pageCount ? ` · ${rev.pageCount} page${rev.pageCount === 1 ? "" : "s"}` : ""} ·{" "}
      {DATE.format(new Date(rev.createdAt))} · {rev.uploadedBy.displayName ?? "staff"}
    </span>
  );
}

function FileLinks({ rev, compact = false }: { rev: DocumentRevision; compact?: boolean }) {
  return (
    <span className="flex shrink-0 gap-1">
      <a
        href={revisionHref(rev.id, "inline")}
        target="_blank"
        rel="noopener noreferrer"
        className={compact ? buttonStyles.icon : buttonStyles.ghost}
      >
        <Icon name="eye" size={16} />
        <span className={compact ? "sr-only" : undefined}>Preview</span>
        <span className="sr-only"> revision {rev.revisionNumber} (opens in a new tab)</span>
      </a>
      <a
        href={revisionHref(rev.id, "attachment")}
        download
        className={compact ? buttonStyles.icon : buttonStyles.ghost}
      >
        <Icon name="download" size={16} />
        <span className={compact ? "sr-only" : undefined}>Download</span>
        <span className="sr-only"> revision {rev.revisionNumber}</span>
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
  const state = SITE_STATE_TEXT[site.state];
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
            Serves revision {site.pinnedRevision.revisionNumber}
          </span>
        ) : null}
        {site.updateAvailable && doc.activeRevision ? (
          <StatusPill tone="amber">
            Revision {doc.activeRevision.revisionNumber} awaits the publisher
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
            Publish revision {doc.activeRevision.revisionNumber} on {SITE_SHORT[site.siteKey]}
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
            title={
              !site.enabled && blocked
                ? "Only an active, non-internal document with a file can be shown on a site."
                : undefined
            }
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
            {site.enabled ? "Shown" : "Show"} on {SITE_SHORT[site.siteKey]}
          </button>
        ) : (
          <span className="text-xs text-ink-3">
            {site.enabled ? "Shown by the site publisher" : "Not shown"}
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
  onChange,
}: {
  doc: ProductDocument;
  canEdit: boolean;
  productArchived: boolean;
  onChange: (doc: ProductDocument, message: string) => void;
}) {
  const id = useId();
  const router = useRouter();
  const notify = useNotice();
  const [mode, setMode] = useState<"view" | "edit" | "upload">("view");
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<DetailsValue>({
    type: doc.type,
    title: doc.title,
    description: doc.description ?? "",
    accessPolicy: doc.accessPolicy,
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
          version: doc.version,
        }),
      "Document details saved.",
    );
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    const problem = file ? documentPrecheck(file) : "Choose the PDF file.";
    setFileError(problem);
    if (problem || !file) return;
    setBusy("upload");
    const r = await sendPdf(doc.id, file, note, setProgress);
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
        ? `Revision ${r.document.revisionCount} uploaded and active. Sites keep their published revision until their publisher confirms the new one.`
        : `Revision ${r.document.revisionCount} uploaded and active.`,
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
        ? `Hidden on ${SITE_SHORT[site.siteKey]}.`
        : `Shown on ${SITE_SHORT[site.siteKey]} with revision ${doc.activeRevision?.revisionNumber ?? ""}.`,
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
      `${SITE_SHORT[site.siteKey]} now serves revision ${doc.activeRevision?.revisionNumber ?? ""}.`,
    );

  const setArchived = (archive: boolean) => {
    if (
      archive &&
      !window.confirm(
        `Archive “${doc.title}”? It disappears from every site at once. Its revisions are kept and it can be restored.`,
      )
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
      archive ? "Document archived." : "Document restored.",
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
      `Revision ${rev.revisionNumber} is now the active revision.`,
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
            {archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
          </div>
          {doc.description ? <p className="text-sm text-ink-2">{doc.description}</p> : null}
          {doc.activeRevision ? (
            <RevisionMeta rev={doc.activeRevision} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-amber-ink">
              <Icon name="alert" size={13} />
              No file uploaded yet
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
          <h4 className="sr-only">Sites</h4>
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
          <DetailsFields value={details} onChange={setDetails} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => setMode("view")}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy !== null} className={buttonStyles.primary}>
              {busy === "details" ? <Spinner /> : <Icon name="check" size={18} />}
              Save details
            </button>
          </div>
        </form>
      ) : null}

      {mode === "upload" ? (
        <form onSubmit={upload} className="space-y-4 border-t border-line p-4">
          <p className="text-sm text-ink-2">
            The new file becomes revision {doc.revisionCount + 1} and the active revision. Earlier
            revisions stay unchanged and can be made active again.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FilePicker
              id={`${id}-file`}
              file={file}
              onFile={(f) => {
                setFile(f);
                setFileError(f ? documentPrecheck(f) : null);
              }}
              error={fileError}
            />
            <Field label="Change note (optional)" htmlFor={`${id}-note`}>
              <textarea
                id={`${id}-note`}
                maxLength={REVISION_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Section 8 updated"
                className={cx(TEXTAREA, "min-h-24")}
              />
            </Field>
          </div>
          {busy === "upload" ? <ProgressBar value={progress} label="Uploading the PDF" /> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => setMode("view")}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy !== null} className={buttonStyles.primary}>
              {busy === "upload" ? <Spinner /> : <Icon name="upload" size={18} />}
              Upload revision
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
        {doc.revisions.length ? (
          <details className="group w-full sm:w-auto sm:flex-1">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Icon name="history" size={16} />
              Revision history
              <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
                {doc.revisions.length}
              </span>
              <Icon
                name="chevron"
                size={14}
                className="transition-transform group-open:rotate-90"
              />
            </summary>
            <ol className="mt-1 space-y-1 px-2 pb-2" aria-label={`Revisions of ${doc.title}`}>
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
                        Revision {rev.revisionNumber}
                      </span>
                      {rev.isActive ? <StatusPill tone="petrol">Active</StatusPill> : null}
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
                        Make active
                      </button>
                    ) : null}
                    <FileLinks rev={rev} compact />
                  </span>
                </li>
              ))}
            </ol>
            <p className="px-2 pb-2 text-xs text-ink-3">
              Revisions are immutable: they are never edited or deleted.
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
              New revision
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setMode(mode === "edit" ? "view" : "edit")}
              aria-expanded={mode === "edit"}
              className={buttonStyles.ghost}
            >
              <Icon name="edit" size={16} />
              Details
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setArchived(true)}
              className={cx(buttonStyles.ghost, "hover:text-danger")}
            >
              <Icon name="archive" size={16} />
              Archive
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
            Restore
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
}: {
  productId: string;
  initial: readonly ProductDocument[];
  canEdit: boolean;
  productArchived: boolean;
}) {
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
      onChange={replace}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl bg-surface-2/60 px-4 py-3 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl">
          A site serves a document only when its publisher shows it there <em>and</em> the product
          is published on that site. New documents are <strong>Internal</strong> until you choose
          otherwise.
        </p>
        {canEdit && !productArchived && !creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cx(buttonStyles.primary, "shrink-0")}
          >
            <Icon name="plus" size={18} />
            New document
          </button>
        ) : null}
      </div>

      {creating ? (
        <NewDocumentForm
          productId={productId}
          onCancel={() => setCreating(false)}
          onCreated={(doc, uploaded) => {
            replace(
              doc,
              uploaded ? "Document created with revision 1." : "Document created without a file.",
            );
            if (uploaded) setCreating(false);
          }}
        />
      ) : null}

      {active.length === 0 && !creating ? (
        <EmptyState icon="list" title="No documents yet">
          {canEdit && !productArchived
            ? "Add the technical data sheet, safety data sheet or a certificate of analysis as PDF."
            : "No technical document has been added to this product."}
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="Documents">
          {active.map(card)}
        </ul>
      )}

      {archived.length ? (
        <details className="group rounded-xl border border-line">
          <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-ink-2 hover:text-ink">
            <Icon name="archive" size={16} />
            Archived documents
            <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
              {archived.length}
            </span>
            <Icon
              name="chevron"
              size={14}
              className="ml-auto transition-transform group-open:rotate-90"
            />
          </summary>
          <ul className="space-y-3 p-3" aria-label="Archived documents">
            {archived.map(card)}
          </ul>
        </details>
      ) : null}

      {canEdit && productArchived ? (
        <p className="text-sm text-ink-3">
          This product is archived. Restore it to change its documents.
        </p>
      ) : null}
    </div>
  );
}
