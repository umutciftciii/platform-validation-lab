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
import { ADMIN_TIME_ZONE } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import { callRedirects, downloadText } from "../../lib/redirects-client";
import {
  historyActionLabel,
  historySummary,
  importActionLabel,
  importReportCsv,
  originLabel,
  redirectContentHref,
  redirectsApi,
  ruleMessage,
  warningMessage,
} from "../../lib/redirects-view";
import { FormMessage } from "../catalog/parts";
import { Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { ConfirmBox } from "../cms/publication-panel";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, StatusPill } from "../ui";

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

type Editing = { mode: "create" } | { mode: "edit"; item: SeoRedirectItem } | null;

/**
 * DP-211: the interactive part of Admin > SEO > Redirects: the list of the current page (from the
 * server page), creating and editing a redirect, deleting it, its change history and the CSV
 * import (dry-run first, import of exactly the checked plan). Every change is checked again by
 * the API; slug-change redirects are protected (only their note can change).
 * ML-12d (DP-243): every text in the console's language (`seo.redirects.*`); request bodies,
 * versions, codes and the downloaded CSV files are unchanged.
 */
export function RedirectManager({ data }: { data: SeoRedirectListResponse }) {
  const t = useT();
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
            aria-haspopup="dialog"
          >
            <Icon name="plus" size={17} />
            <span>{t("seo.redirects.manager.newRedirect")}</span>
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
            <span>{t("seo.redirects.manager.importCsv")}</span>
          </button>
          <button
            type="button"
            className={buttonStyles.ghost}
            onClick={() => downloadText("redirects-sample.csv", SEO_REDIRECT_CSV_SAMPLE)}
          >
            <Icon name="download" size={16} />
            <span>{t("seo.redirects.manager.sampleCsv")}</span>
          </button>
        </div>
      ) : (
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <span>{t("seo.redirects.manager.readOnly")}</span>
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
                <span>{warningMessage(w, t)}</span>
              </p>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className={buttonStyles.icon}
            aria-label={t("seo.redirects.manager.dismiss")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {editing ? (
        <RedirectForm
          key={editing.mode === "edit" ? `edit-${editing.item.id}` : "create"}
          api={api}
          item={editing.mode === "edit" ? editing.item : null}
          onCancel={() => setEditing(null)}
          onSaved={(res) =>
            done(
              editing.mode === "edit"
                ? t("seo.redirects.manager.saved")
                : t("seo.redirects.manager.created"),
              res.warnings,
            )
          }
        />
      ) : null}
      {importing ? (
        <ImportPanel
          key="import"
          api={api}
          onDone={(n) => {
            setImporting(false);
            done(t("seo.redirects.manager.imported", { count: n }));
          }}
        />
      ) : null}

      {data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-sm text-ink-3">
          {t("seo.redirects.list.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {data.items.map((item) => (
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
              onDeleted={() => done(t("seo.redirects.manager.deleted"))}
            />
          ))}
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
  const t = useT();
  const locale = useAdminLocale();
  const date = (iso: string) => dateTimeFormat(locale, DATE_OPTIONS).format(new Date(iso));
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
              <span>
                {item.content.type === "PRODUCT"
                  ? t("seo.redirects.row.movedProduct")
                  : t("seo.redirects.row.movedPage")}
              </span>
              {contentHref && item.content.name ? (
                <Link href={contentHref} className="font-medium text-petrol-strong hover:underline">
                  {item.content.name}
                </Link>
              ) : (
                <span className="text-ink-3">{t("seo.redirects.row.notAvailable")}</span>
              )}
              <span className="text-ink-3">
                {item.content.livePath
                  ? t("seo.redirects.row.liveAt", { path: item.content.livePath })
                  : t("seo.redirects.row.notLiveNow")}
              </span>
            </p>
          ) : null}
          {item.note ? <p className="break-words text-sm text-ink-2">{item.note}</p> : null}
          <p className="text-xs text-ink-3">
            {item.updatedBy
              ? t("seo.redirects.row.changedBy", {
                  date: date(item.updatedAt),
                  person: item.updatedBy,
                  created: date(item.createdAt),
                })
              : t("seo.redirects.row.changed", {
                  date: date(item.updatedAt),
                  created: date(item.createdAt),
                })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <StatusPill tone={item.statusCode === 301 ? "petrol" : "amber"}>
            {item.statusCode === 301
              ? t("seo.redirects.row.permanent")
              : t("seo.redirects.row.temporary")}
          </StatusPill>
          <StatusPill tone={item.active ? "success" : "neutral"}>
            {item.active ? t("seo.redirects.row.active") : t("seo.redirects.row.inactive")}
          </StatusPill>
          <StatusPill tone="neutral">{originLabel(item.origin, t)}</StatusPill>
          {item.protected ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-ink-3"
              title={t("seo.redirects.row.protectedTitle")}
            >
              <Icon name="shield" size={13} />
              <span>{t("seo.redirects.row.protected")}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {canManage ? (
          <button
            type="button"
            onClick={onEdit}
            aria-haspopup="dialog"
            className="font-medium text-petrol-strong hover:underline"
          >
            {item.protected ? t("seo.redirects.row.editNote") : t("seo.redirects.row.edit")}
          </button>
        ) : null}
        {canReadHistory ? (
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={showHistory}
            className="font-medium text-petrol-strong hover:underline"
          >
            {showHistory ? t("seo.redirects.row.hideHistory") : t("seo.redirects.row.history")}
          </button>
        ) : null}
        {canManage && !item.protected ? (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            aria-haspopup="dialog"
            className="font-medium text-danger hover:underline"
          >
            {t("seo.redirects.row.delete")}
          </button>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmBox
          text={t("seo.redirects.row.confirmDelete", { source: redirectSourceLabel(item) })}
          action={t("seo.redirects.row.confirmAction")}
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
              {t("seo.redirects.row.loadingHistory")}
            </p>
          ) : events.length === 0 ? (
            <p key="empty" className="text-sm text-ink-3">
              {t("seo.redirects.row.noHistory")}
            </p>
          ) : (
            <ol
              key="events"
              className="space-y-1.5 text-sm"
              aria-label={t("seo.redirects.row.historyLabel")}
            >
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <span className="shrink-0 text-ink-3">{date(e.occurredAt)}</span>
                  <span className="min-w-0 break-words text-ink-2">
                    {e.actor
                      ? t("seo.redirects.row.eventBy", {
                          action: historyActionLabel(e.action, e.details, t),
                          person: e.actor,
                          summary: historySummary(e.details, t),
                        })
                      : t("seo.redirects.row.event", {
                          action: historyActionLabel(e.action, e.details, t),
                          summary: historySummary(e.details, t),
                        })}
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
  const t = useT();
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
  // DP-268: Escape asks before it throws away typed input (Cancel and × keep their old rule).
  const dirty =
    source !== (item ? redirectSourceLabel(item) : "") ||
    target !== (item?.target ?? "") ||
    statusCode !== (item?.statusCode ?? 301) ||
    active !== (item?.active ?? true) ||
    note !== (item?.note ?? "");
  const input =
    "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-3 disabled:bg-surface-2 disabled:text-ink-3 aria-invalid:border-danger";

  return (
    <Dialog
      title={item ? t("seo.redirects.form.edit") : t("seo.redirects.form.create")}
      size="lg"
      busy={pending}
      dirty={dirty}
      closeLabel={t("seo.redirects.form.close")}
      onClose={onCancel}
    >
      <DialogForm
        onSubmit={submit}
        label={item ? t("seo.redirects.form.edit") : t("seo.redirects.form.create")}
      >
        <DialogBody>
          {locked ? (
            <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2 ring-1 ring-inset ring-line">
              <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
              <span>{t("seo.redirects.form.locked")}</span>
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="min-w-0 space-y-1.5" htmlFor={`${id}-source`}>
              <span className="block text-sm font-medium text-ink">
                {t("seo.redirects.form.source")}
              </span>
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
              <span className="block text-xs text-ink-3">{t("seo.redirects.form.sourceHint")}</span>
            </label>
            <label className="min-w-0 space-y-1.5" htmlFor={`${id}-target`}>
              <span className="block text-sm font-medium text-ink">
                {t("seo.redirects.form.target")}
              </span>
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
              <span className="block text-xs text-ink-3">{t("seo.redirects.form.targetHint")}</span>
            </label>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2" disabled={locked}>
              <legend className="sr-only">{t("seo.redirects.form.status")}</legend>
              {([301, 302] as const).map((code) => (
                <label key={code} className="inline-flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name={`${id}-status`}
                    checked={statusCode === code}
                    onChange={() => setStatusCode(code)}
                  />
                  <span>
                    {code === 301
                      ? t("seo.redirects.row.permanent")
                      : t("seo.redirects.row.temporary")}
                  </span>
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
              <span>{t("seo.redirects.form.active")}</span>
            </label>
          </div>
          <label className="block space-y-1.5" htmlFor={`${id}-note`}>
            <span className="block text-sm font-medium text-ink">
              {t("seo.redirects.form.note")}
            </span>
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
        </DialogBody>
        <DialogFooter hint={t("seo.redirects.form.atOnce")}>
          <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
            <span>{t("seo.redirects.form.cancel")}</span>
          </button>
          <button type="submit" className={buttonStyles.primary} disabled={pending}>
            <span>
              {pending
                ? t("seo.redirects.form.saving")
                : item
                  ? t("seo.redirects.form.save")
                  : t("seo.redirects.form.createAction")}
            </span>
          </button>
        </DialogFooter>
      </DialogForm>
    </Dialog>
  );
}

function ImportPanel({ api, onDone }: { api: string; onDone: (n: number) => void }) {
  const t = useT();
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
      setError(ruleMessage("csv:too_large", t));
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
      aria-label={t("seo.redirects.import.label")}
      className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-ink">{t("seo.redirects.import.label")}</h2>
        <p className="text-sm text-ink-2">{t("seo.redirects.import.intro")}</p>
      </div>
      <label className="block space-y-1.5" htmlFor={`${id}-file`}>
        <span className="block text-sm font-medium text-ink">
          {t("seo.redirects.import.file", {
            rows: SEO_REDIRECT_CSV_MAX_ROWS,
            kb: SEO_REDIRECT_CSV_MAX_BYTES / 1024,
          })}
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
            {t("seo.redirects.import.lines", { file: fileName, count: dataLines })}
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
              <span>{t("seo.redirects.import.check")}</span>
            </button>
          </div>
        </div>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {result ? (
        <div className="space-y-3">
          <p className="flex flex-wrap gap-2 text-sm" aria-label={t("seo.redirects.import.result")}>
            <StatusPill tone="petrol">
              {t("seo.redirects.import.new", { n: result.summary.create })}
            </StatusPill>
            <StatusPill tone="amber">
              {t("seo.redirects.import.updated", { n: result.summary.update })}
            </StatusPill>
            <StatusPill tone="neutral">
              {t("seo.redirects.import.unchanged", { n: result.summary.unchanged })}
            </StatusPill>
            <StatusPill tone={result.summary.error ? "danger" : "success"}>
              {t("seo.redirects.import.withErrors", { n: result.summary.error })}
            </StatusPill>
          </p>
          {issues.length && issues.length < result.rows.length ? (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(e) => setOnlyIssues(e.target.checked)}
              />
              <span>
                {t("seo.redirects.import.onlyIssues", {
                  n: issues.length,
                  total: result.rows.length,
                })}
              </span>
            </label>
          ) : null}
          <ol className="max-h-96 divide-y divide-line overflow-auto rounded-lg ring-1 ring-inset ring-line">
            {shown.map((r) => (
              <li key={r.line} className="space-y-1 px-3 py-2 text-sm">
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-3">
                    {t("seo.redirects.import.line", { line: r.line })}
                  </span>
                  <span
                    className={cx(
                      "rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset",
                      r.action === "error"
                        ? "bg-danger-soft text-danger ring-danger/25"
                        : "bg-surface-2 text-ink-2 ring-line",
                    )}
                  >
                    {importActionLabel(r.action, t)}
                  </span>
                  <span className="min-w-0 break-all font-mono text-xs text-ink">
                    {`${r.source || "—"} → ${r.target || "—"}${r.statusCode ? ` (${r.statusCode})` : ""}`}
                  </span>
                </p>
                {r.errors.map((c) => (
                  <p key={`e-${c}`} className="text-xs text-danger">
                    {ruleMessage(c, t)}
                  </p>
                ))}
                {r.warnings.map((w) => (
                  <p key={`w-${w}`} className="text-xs text-amber-ink">
                    {warningMessage(w, t)}
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
              <span>{t("seo.redirects.import.run", { count: changes })}</span>
            </button>
            <button
              type="button"
              className={buttonStyles.ghost}
              onClick={() => downloadText("redirects-check-report.csv", importReportCsv(result))}
            >
              <Icon name="download" size={16} />
              <span>{t("seo.redirects.import.download")}</span>
            </button>
            <span className="text-xs text-ink-3">
              {result.summary.error > 0
                ? t("seo.redirects.import.fixErrors")
                : changes === 0
                  ? t("seo.redirects.import.nothing")
                  : t("seo.redirects.import.exact")}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
