"use client";

import {
  SEO_REDIRECT_CSV_MAX_BYTES,
  SEO_REDIRECT_CSV_MAX_ROWS,
  SEO_REDIRECT_CSV_SAMPLE,
  redirectSourceLabel,
  type SeoRedirectCreateRequest,
  type SeoRedirectHistoryResponse,
  type SeoRedirectImportResponse,
  type SeoRedirectItem,
  type SeoRedirectListResponse,
  type SeoRedirectResponse,
} from "@dream/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { callRedirects, downloadText } from "../../lib/redirects-client";
import {
  IMPORT_ACTION_LABEL,
  ORIGIN_LABEL,
  WARNINGS,
  historyActionLabel,
  historySummary,
  importReportCsv,
  redirectContentHref,
  redirectsApi,
  ruleMessage,
} from "../../lib/redirects-view";
import { FormMessage } from "../catalog/parts";
import { ConfirmBox } from "../cms/publication-panel";
import { Icon } from "../icons";
import { buttonStyles, cx, StatusPill } from "../ui";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

type Editing = { mode: "create" } | { mode: "edit"; item: SeoRedirectItem } | null;

/**
 * DP-211: the interactive part of Admin > SEO > Redirects: the list of the current page (from the
 * server page), creating and editing a redirect, deleting it, its change history and the CSV
 * import (dry-run first, import of exactly the checked plan). Every change is checked again by
 * the API; slug-change redirects are protected (only their note can change).
 */
export function RedirectManager({ data }: { data: SeoRedirectListResponse }) {
  const router = useRouter();
  const api = redirectsApi(data.site.id);
  const [editing, setEditing] = useState<Editing>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warnings: readonly string[] } | null>(null);
  const { manage, history } = data.permissions;

  function done(text: string, warnings: readonly string[] = []) {
    setEditing(null);
    setNotice({ text, warnings });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {manage ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonStyles.primary}
            onClick={() => {
              setImporting(false);
              setNotice(null);
              setEditing({ mode: "create" });
            }}
          >
            <Icon name="plus" size={17} />
            <span>New redirect</span>
          </button>
          <button
            type="button"
            className={buttonStyles.secondary}
            aria-expanded={importing}
            onClick={() => {
              setEditing(null);
              setImporting((v) => !v);
            }}
          >
            <Icon name="upload" size={17} />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            className={buttonStyles.ghost}
            onClick={() => downloadText("redirects-sample.csv", SEO_REDIRECT_CSV_SAMPLE)}
          >
            <Icon name="download" size={16} />
            <span>Sample CSV</span>
          </button>
        </div>
      ) : (
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <span>
            You can read the redirects. Creating, changing, deleting and importing them needs the
            right to publish content on this site.
          </span>
        </p>
      )}

      {notice ? (
        <div
          key="notice"
          role="status"
          className="flex items-start justify-between gap-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success ring-1 ring-inset ring-success/25"
        >
          <div className="min-w-0 space-y-1">
            <p>{notice.text}</p>
            {notice.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-amber-ink">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                <span>{WARNINGS[w] ?? w}</span>
              </p>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className={buttonStyles.icon}
            aria-label="Dismiss"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {editing?.mode === "create" ? (
        <RedirectForm
          key="create"
          api={api}
          item={null}
          onCancel={() => setEditing(null)}
          onSaved={(res) => done("Redirect created. It is live on the site now.", res.warnings)}
        />
      ) : null}
      {importing ? (
        <ImportPanel
          key="import"
          api={api}
          onDone={(n) => {
            setImporting(false);
            done(`${n} redirect${n === 1 ? "" : "s"} imported. They are live on the site now.`);
          }}
        />
      ) : null}

      {data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-sm text-ink-3">
          No redirects match.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {data.items.map((item) =>
            editing?.mode === "edit" && editing.item.id === item.id ? (
              <li key={`edit-${item.id}`} className="p-3 sm:p-4">
                <RedirectForm
                  api={api}
                  item={item}
                  onCancel={() => setEditing(null)}
                  onSaved={(res) => done("Redirect saved.", res.warnings)}
                />
              </li>
            ) : (
              <RedirectRow
                key={`row-${item.id}`}
                item={item}
                api={api}
                canManage={manage}
                canReadHistory={history}
                onEdit={() => {
                  setImporting(false);
                  setEditing({ mode: "edit", item });
                }}
                onDeleted={() => done("Redirect deleted. The old address answers 404 again.")}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function RedirectRow({
  item,
  api,
  canManage,
  canReadHistory,
  onEdit,
  onDeleted,
}: {
  item: SeoRedirectItem;
  api: string;
  canManage: boolean;
  canReadHistory: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SeoRedirectHistoryResponse["events"] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const contentHref = redirectContentHref(item);

  async function remove() {
    setPending(true);
    setError(null);
    const res = await callRedirects<{ deleted: true }>(`${api}/${item.id}/delete`, {
      method: "POST",
      body: { version: item.version },
    });
    setPending(false);
    setConfirm(false);
    if (!res.ok) return setError(res.message);
    onDeleted();
  }

  async function toggleHistory() {
    if (showHistory) return setShowHistory(false);
    setShowHistory(true);
    if (events) return;
    const res = await callRedirects<SeoRedirectHistoryResponse>(`${api}/${item.id}/history`, {
      method: "GET",
    });
    if (!res.ok) return setError(res.message);
    setEvents(res.data.events);
  }

  return (
    <li className="space-y-2 px-4 py-3 sm:px-5" data-redirect-row={item.id}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm">
            <span className="break-all text-ink">{redirectSourceLabel(item)}</span>
            <Icon name="arrow" size={14} className="shrink-0 rotate-45 text-ink-3" />
            <span className="break-all text-petrol-strong">{item.target}</span>
          </p>
          {item.content ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2">
              <span>{`Moved ${item.content.type === "PRODUCT" ? "product" : "page"}:`}</span>
              {contentHref && item.content.name ? (
                <Link href={contentHref} className="font-medium text-petrol-strong hover:underline">
                  {item.content.name}
                </Link>
              ) : (
                <span className="text-ink-3">not available to you</span>
              )}
              <span className="text-ink-3">
                {item.content.livePath ? `· live at ${item.content.livePath}` : "· not live now"}
              </span>
            </p>
          ) : null}
          {item.note ? <p className="break-words text-sm text-ink-2">{item.note}</p> : null}
          <p className="text-xs text-ink-3">
            {`Changed ${DATE.format(new Date(item.updatedAt))}${item.updatedBy ? ` by ${item.updatedBy}` : ""} · created ${DATE.format(new Date(item.createdAt))}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <StatusPill tone={item.statusCode === 301 ? "petrol" : "amber"}>
            {item.statusCode === 301 ? "301 permanent" : "302 temporary"}
          </StatusPill>
          <StatusPill tone={item.active ? "success" : "neutral"}>
            {item.active ? "Active" : "Inactive"}
          </StatusPill>
          <StatusPill tone="neutral">{ORIGIN_LABEL[item.origin]}</StatusPill>
          {item.protected ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-ink-3"
              title="Created when the content moved. Only its note can be changed."
            >
              <Icon name="shield" size={13} />
              <span>Protected</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {canManage ? (
          <button
            type="button"
            onClick={onEdit}
            className="font-medium text-petrol-strong hover:underline"
          >
            {item.protected ? "Edit note" : "Edit"}
          </button>
        ) : null}
        {canReadHistory ? (
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={showHistory}
            className="font-medium text-petrol-strong hover:underline"
          >
            {showHistory ? "Hide history" : "History"}
          </button>
        ) : null}
        {canManage && !item.protected && !confirm ? (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="font-medium text-danger hover:underline"
          >
            Delete
          </button>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmBox
          text={`Delete the redirect from ${redirectSourceLabel(item)}? The old address answers 404 again (the change history is kept).`}
          action="Delete redirect"
          danger
          pending={pending}
          onConfirm={remove}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {showHistory ? (
        <div className="rounded-lg bg-surface-2 px-3 py-2 ring-1 ring-inset ring-line">
          {events === null ? (
            <p key="loading" className="text-sm text-ink-3">
              Loading the history…
            </p>
          ) : events.length === 0 ? (
            <p key="empty" className="text-sm text-ink-3">
              No recorded changes.
            </p>
          ) : (
            <ol key="events" className="space-y-1.5 text-sm" aria-label="Changes, newest first">
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <span className="shrink-0 text-ink-3">{DATE.format(new Date(e.occurredAt))}</span>
                  <span className="min-w-0 break-words text-ink-2">
                    {`${historyActionLabel(e.action, e.details)}${e.actor ? ` by ${e.actor}` : ""} — ${historySummary(e.details)}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RedirectForm({
  api,
  item,
  onCancel,
  onSaved,
}: {
  api: string;
  item: SeoRedirectItem | null;
  onCancel: () => void;
  onSaved: (res: SeoRedirectResponse) => void;
}) {
  const id = useId();
  const locked = item?.protected ?? false;
  const [source, setSource] = useState(item ? redirectSourceLabel(item) : "");
  const [target, setTarget] = useState(item?.target ?? "");
  const [statusCode, setStatusCode] = useState<301 | 302>(item?.statusCode ?? 301);
  const [active, setActive] = useState(item?.active ?? true);
  const [note, setNote] = useState(item?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; fields: string[] } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body: SeoRedirectCreateRequest = { source, target, statusCode, active, note };
    const res = await callRedirects<SeoRedirectResponse>(item ? `${api}/${item.id}` : api, {
      method: "POST",
      body: item ? { ...body, version: item.version } : body,
    });
    setPending(false);
    if (!res.ok) {
      return setError({ message: res.message, fields: res.issues.map((i) => i.path) });
    }
    onSaved(res.data);
  }

  const invalid = (f: string) => (error?.fields.includes(f) ? true : undefined);
  const input =
    "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-3 disabled:bg-surface-2 disabled:text-ink-3 aria-invalid:border-danger";

  return (
    <form
      onSubmit={submit}
      aria-label={item ? "Edit redirect" : "New redirect"}
      className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">
          {item ? "Edit redirect" : "New redirect"}
        </h2>
        <button type="button" onClick={onCancel} className={buttonStyles.icon} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>
      {locked ? (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2 ring-1 ring-inset ring-line">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <span>
            Created when the content moved: it keeps the old address for search engines and follows
            the content. Only the note can be changed here.
          </span>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="min-w-0 space-y-1.5" htmlFor={`${id}-source`}>
          <span className="block text-sm font-medium text-ink">Old address (source)</span>
          <input
            id={`${id}-source`}
            className={input}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="/old-page"
            disabled={locked}
            required
            maxLength={1000}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid("source")}
          />
          <span className="block text-xs text-ink-3">
            /page, /news/article, /products/product or an old-site address such as /en/about-us,
            optionally with ?query
          </span>
        </label>
        <label className="min-w-0 space-y-1.5" htmlFor={`${id}-target`}>
          <span className="block text-sm font-medium text-ink">New address (target)</span>
          <input
            id={`${id}-target`}
            className={input}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="/new-page"
            disabled={locked}
            required
            maxLength={1000}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid("target")}
          />
          <span className="block text-xs text-ink-3">
            A path of this site, never another domain
          </span>
        </label>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2" disabled={locked}>
          <legend className="sr-only">Status</legend>
          {([301, 302] as const).map((code) => (
            <label key={code} className="inline-flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name={`${id}-status`}
                checked={statusCode === code}
                onChange={() => setStatusCode(code)}
              />
              <span>{code === 301 ? "301 permanent" : "302 temporary"}</span>
            </label>
          ))}
        </fieldset>
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={locked}
          />
          <span>Active</span>
        </label>
      </div>
      <label className="block space-y-1.5" htmlFor={`${id}-note`}>
        <span className="block text-sm font-medium text-ink">Note (optional)</span>
        <textarea
          id={`${id}-note`}
          className="min-h-16 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          aria-invalid={invalid("note")}
        />
      </label>
      {error ? <FormMessage kind="error">{error.message}</FormMessage> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonStyles.primary} disabled={pending}>
          <span>{pending ? "Saving…" : item ? "Save redirect" : "Create redirect"}</span>
        </button>
        <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
          <span>Cancel</span>
        </button>
        <span className="text-xs text-ink-3">
          Takes effect on the site at once; no publication step.
        </span>
      </div>
    </form>
  );
}

function ImportPanel({ api, onDone }: { api: string; onDone: (n: number) => void }) {
  const id = useId();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<SeoRedirectImportResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // DP-212: a legacy map has hundreds of rows; the rows that need attention come first.
  const [onlyIssues, setOnlyIssues] = useState(true);

  async function pick(file: File | undefined) {
    setResult(null);
    setError(null);
    setCsv(null);
    if (!file) return;
    if (file.size > SEO_REDIRECT_CSV_MAX_BYTES) {
      setError(ruleMessage("csv:too_large"));
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function run(dryRun: boolean) {
    if (csv === null) return;
    setPending(true);
    setError(null);
    const res = await callRedirects<SeoRedirectImportResponse>(`${api}/import`, {
      method: "POST",
      body: dryRun ? { csv, dryRun } : { csv, dryRun, planHash: result?.planHash },
    });
    setPending(false);
    if (!res.ok) {
      if (!dryRun) setResult(null);
      return setError(res.message);
    }
    if (dryRun) return setResult(res.data);
    onDone(res.data.summary.create + res.data.summary.update);
  }

  const lines = csv?.replace(/^﻿/, "").split(/\r?\n/) ?? [];
  const preview = lines.slice(0, 6);
  const dataLines = Math.max(0, lines.filter((l) => l.trim() !== "").length - 1);
  const changes = result ? result.summary.create + result.summary.update : 0;
  const issues = result ? result.rows.filter((r) => r.errors.length || r.warnings.length) : [];
  const shown = result ? (onlyIssues && issues.length ? issues : result.rows) : [];
  return (
    <section
      aria-label="Import redirects from CSV"
      className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-ink">Import redirects from CSV</h2>
        <p className="text-sm text-ink-2">
          Columns: source, target, status (301/302), active (true/false), note. Check the file
          first; nothing changes until you confirm. A file with errors is never imported, and
          importing the same file again creates no duplicates.
        </p>
      </div>
      <label className="block space-y-1.5" htmlFor={`${id}-file`}>
        <span className="block text-sm font-medium text-ink">
          {`CSV file (at most ${SEO_REDIRECT_CSV_MAX_ROWS} rows, ${SEO_REDIRECT_CSV_MAX_BYTES / 1024} KB)`}
        </span>
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void pick(e.target.files?.[0])}
          className="block w-full min-w-0 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
      </label>
      {csv !== null ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-3">
            {`${fileName} · ${dataLines} line${dataLines === 1 ? "" : "s"} · first lines`}
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink-2 ring-1 ring-inset ring-line">
            {preview.join("\n")}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={pending}
              onClick={() => void run(true)}
            >
              <Icon name="check" size={16} />
              <span>Check file (dry-run)</span>
            </button>
          </div>
        </div>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {result ? (
        <div className="space-y-3">
          <p className="flex flex-wrap gap-2 text-sm" aria-label="Dry-run result">
            <StatusPill tone="petrol">{`${result.summary.create} new`}</StatusPill>
            <StatusPill tone="amber">{`${result.summary.update} updated`}</StatusPill>
            <StatusPill tone="neutral">{`${result.summary.unchanged} unchanged`}</StatusPill>
            <StatusPill tone={result.summary.error ? "danger" : "success"}>
              {`${result.summary.error} with errors`}
            </StatusPill>
          </p>
          {issues.length && issues.length < result.rows.length ? (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(e) => setOnlyIssues(e.target.checked)}
              />
              <span>{`Only rows with errors or warnings (${issues.length} of ${result.rows.length})`}</span>
            </label>
          ) : null}
          <ol className="max-h-96 divide-y divide-line overflow-auto rounded-lg ring-1 ring-inset ring-line">
            {shown.map((r) => (
              <li key={r.line} className="space-y-1 px-3 py-2 text-sm">
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-3">{`Line ${r.line}`}</span>
                  <span
                    className={cx(
                      "rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset",
                      r.action === "error"
                        ? "bg-danger-soft text-danger ring-danger/25"
                        : "bg-surface-2 text-ink-2 ring-line",
                    )}
                  >
                    {IMPORT_ACTION_LABEL[r.action]}
                  </span>
                  <span className="min-w-0 break-all font-mono text-xs text-ink">
                    {`${r.source || "—"} → ${r.target || "—"}${r.statusCode ? ` (${r.statusCode})` : ""}`}
                  </span>
                </p>
                {r.errors.map((c) => (
                  <p key={`e-${c}`} className="text-xs text-danger">
                    {ruleMessage(c)}
                  </p>
                ))}
                {r.warnings.map((w) => (
                  <p key={`w-${w}`} className="text-xs text-amber-ink">
                    {WARNINGS[w] ?? w}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={pending || result.summary.error > 0 || changes === 0}
              onClick={() => void run(false)}
            >
              <Icon name="upload" size={16} />
              <span>{`Import ${changes} redirect${changes === 1 ? "" : "s"}`}</span>
            </button>
            <button
              type="button"
              className={buttonStyles.ghost}
              onClick={() => downloadText("redirects-check-report.csv", importReportCsv(result))}
            >
              <Icon name="download" size={16} />
              <span>Download report</span>
            </button>
            <span className="text-xs text-ink-3">
              {result.summary.error > 0
                ? "Fix the rows with errors and check the file again."
                : changes === 0
                  ? "Nothing to import: every row is already in place."
                  : "The import writes exactly this result; if the redirects changed meanwhile, check again."}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
