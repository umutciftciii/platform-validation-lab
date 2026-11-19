"use client";

/**
 * DP-227: "Export CSV" under the lead filters. The page counts the matching leads on the server
 * (export summary, lead:read); the file comes from the API through the same-origin proxy
 * (lead:export with its MFA step-up). A refused or broken download shows the real reason (HTTP
 * status, error code, request id); an empty result is said plainly and nothing is downloaded.
 */
import { useId, useState, type FormEvent } from "react";
import { downloadLeadExport } from "../../lib/leads-client";
import { exportSummaryText, leadCount } from "../../lib/leads-view";
import { stepUp } from "../../lib/staff-client";
import { FIELD } from "../catalog/parts";
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
  const codeId = useId();
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
    const res = await downloadLeadExport(query);
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
    setDone(`Downloaded ${res.filename} with ${leadCount(rows)}.`);
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
      aria-label="Export leads"
      role="region"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-ink-2" aria-live="polite">
          <span>{exportSummaryText(count, maxRows, filtered)}</span>
        </p>
        <button
          type="button"
          className={cx(buttonStyles.secondary, "shrink-0 self-start sm:self-auto")}
          disabled={!exportable || busy || needCode}
          onClick={() => void run()}
          title={
            canExport
              ? "Download the filtered leads as a CSV file"
              : "Needs the lead export permission"
          }
        >
          {busy ? <Spinner key="busy" /> : <Icon key="idle" name="download" size={16} />}
          <span>{busy ? "Exporting…" : "Export CSV"}</span>
        </button>
      </div>
      {canExport ? null : (
        <p key="no-permission" className="text-xs text-ink-3">
          Exporting needs the lead export permission (customer-data officer or platform
          administrator). Every export is recorded in the audit log.
        </p>
      )}
      {needCode ? (
        <form
          key="step-up"
          onSubmit={confirm}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          aria-label="Confirm the export"
        >
          <div className="w-full sm:max-w-xs">
            <label htmlFor={codeId} className="mb-1.5 block text-sm font-medium text-ink">
              Authenticator code
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
            <p className="mt-1 text-xs text-ink-3">
              Exporting customer data needs a fresh confirmation.
            </p>
          </div>
          <button type="submit" className={buttonStyles.primary} disabled={busy || !code.trim()}>
            <span>Confirm and export</span>
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
            <span>Cancel</span>
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
