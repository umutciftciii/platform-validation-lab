"use client";

/**
 * DP-227: "Export CSV" under the lead filters. The page counts the matching leads on the server
 * (export summary, lead:read); the file comes from the API through the same-origin proxy
 * (lead:export with its MFA step-up). A refused or broken download shows the real reason (HTTP
 * status, error code, request id); an empty result is said plainly and nothing is downloaded.
 *
 * DP-229: the cell separator is chosen before the download, semicolon by default (Excel with Dutch
 * or Turkish settings), comma as the alternative. It is not part of the filter form, so changing it
 * never reloads the list; the count and the filters stay as they are.
 */
import { useId, useState, type FormEvent } from "react";
import {
  LEAD_EXPORT_DEFAULT_SEPARATOR,
  LeadExportSeparatorSchema,
  type LeadExportSeparator,
} from "@dream/contracts";
import { downloadLeadExport, exportSeparatorOptions } from "../../lib/leads-client";
import { exportSummaryText, leadCount } from "../../lib/leads-view";
import { stepUp } from "../../lib/staff-client";
import { FIELD } from "../catalog/parts";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";

export function LeadExport({
  count,
  maxRows,
  canExport,
  query,
  filtered,
}: {
  count: number;
  maxRows: number;
  canExport: boolean;
  /** The list filters as an API query string (no cursor), e.g. `?source=CONTACT_FORM`. */
  query: string;
  filtered: boolean;
}) {
  const t = useT();
  const locale = useAdminLocale();
  const separatorOptions = exportSeparatorOptions(t);
  const codeId = useId();
  const separatorId = useId();
  const separatorHintId = useId();
  const [separator, setSeparator] = useState<LeadExportSeparator>(LEAD_EXPORT_DEFAULT_SEPARATOR);
  const separatorOption =
    separatorOptions.find((o) => o.value === separator) ?? separatorOptions[0];
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const exportable = canExport && count > 0 && count <= maxRows;

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await downloadLeadExport(query, separator, locale);
    setBusy(false);
    if (!res.ok) {
      if (res.stepUp) {
        setNeedCode(true);
        return;
      }
      setError(res.message);
      return;
    }
    setNeedCode(false);
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const rows = res.rows ?? count;
    setDone(t("leads.export.done", { file: res.filename, leads: leadCount(rows, t, locale) }));
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const up = await stepUp(code.replace(/\s/g, ""));
    setBusy(false);
    setCode("");
    if (!up.ok) {
      setError(up.message);
      return;
    }
    await run();
  }

  return (
    <div
      className="space-y-3 border-b border-line px-5 py-3 sm:px-6"
      aria-label={t("leads.export.region")}
      role="region"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-ink-2" aria-live="polite">
          <span>{exportSummaryText(count, maxRows, filtered, t, locale)}</span>
        </p>
        <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:flex sm:w-auto sm:shrink-0">
          <label htmlFor={separatorId} className="shrink-0 text-sm font-medium text-ink">
            <span>{t("leads.export.separator")}</span>
          </label>
          <select
            id={separatorId}
            className={cx(FIELD, "sm:w-44")}
            value={separator}
            disabled={busy}
            aria-describedby={separatorHintId}
            onChange={(e) => {
              const next = LeadExportSeparatorSchema.safeParse(e.target.value);
              if (next.success) setSeparator(next.data);
            }}
          >
            {separatorOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={cx(
              buttonStyles.secondary,
              "col-span-2 justify-center sm:col-span-1 sm:shrink-0",
            )}
            disabled={!exportable || busy || needCode}
            onClick={() => void run()}
            title={canExport ? t("leads.export.buttonTitle") : t("leads.export.needsPermission")}
          >
            {busy ? <Spinner key="busy" /> : <Icon key="idle" name="download" size={16} />}
            <span>{busy ? t("leads.export.busy") : t("leads.export.button")}</span>
          </button>
        </div>
      </div>
      <p id={separatorHintId} className="text-xs text-ink-3">
        <span>{separatorOption?.hint}</span>
      </p>
      {canExport ? null : (
        <p key="no-permission" className="text-xs text-ink-3">
          {t("leads.export.noPermission")}
        </p>
      )}
      {needCode ? (
        <form
          key="step-up"
          onSubmit={confirm}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          aria-label={t("leads.export.stepUpLabel")}
        >
          <div className="w-full sm:max-w-xs">
            <label htmlFor={codeId} className="mb-1.5 block text-sm font-medium text-ink">
              {t("leads.export.code")}
            </label>
            <input
              id={codeId}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={10}
              className={FIELD}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-3">{t("leads.export.codeHint")}</p>
          </div>
          <button type="submit" className={buttonStyles.primary} disabled={busy || !code.trim()}>
            <span>{t("leads.export.confirm")}</span>
          </button>
          <button
            type="button"
            className={buttonStyles.ghost}
            disabled={busy}
            onClick={() => {
              setNeedCode(false);
              setCode("");
            }}
          >
            <span>{t("leads.export.cancel")}</span>
          </button>
        </form>
      ) : null}
      {error ? (
        <p key="error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {done ? (
        <p key="done" role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
    </div>
  );
}
