/**
 * Lead sales workflow from the browser (DP-041; ADR-019), through the admin's same-origin proxy.
 * The API decides every change (lead:manage on the lead's site, transitions, assignee); the
 * database checks the same again. Error rules map to messages in staff-client RULE_MESSAGES.
 */
import {
  DEFAULT_ERROR_MESSAGES,
  ErrorBodySchema,
  LEAD_EXPORT_MAX_ROWS,
  LEAD_EXPORT_PATH,
  LEAD_EXPORT_SEPARATOR_PARAM,
} from "@dream/contracts";
import type {
  LeadExportSeparator,
  LeadActivityInput,
  LeadActivityResponse,
  LeadWorkflowInput,
  LeadWorkflowResponse,
} from "@dream/contracts";
import { postJson } from "./staff-client";

const base = (leadId: string) => `/api/v1/admin/leads/${encodeURIComponent(leadId)}`;

export const changeLeadWorkflow = (leadId: string, body: LeadWorkflowInput) =>
  postJson<LeadWorkflowResponse>(`${base(leadId)}/workflow`, body);

export const addLeadActivity = (leadId: string, body: LeadActivityInput) =>
  postJson<LeadActivityResponse>(`${base(leadId)}/activities`, body);

/** `<input type="datetime-local">` value (local time) → ISO instant; null when empty or invalid. */
export function localDateTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The current local time as a `datetime-local` value (minutes). */
export function nowLocalDateTime(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

// --- CSV export (DP-227) --------------------------------------------------------------------------

export type LeadExportResult =
  | { ok: true; blob: Blob; filename: string; rows: number | null }
  | { ok: false; status: number; message: string; stepUp: boolean };

const EXPORT_RULE_MESSAGES: Readonly<Record<string, string>> = {
  too_many_rows: `Too many leads for one file (at most ${LEAD_EXPORT_MAX_ROWS.toLocaleString(
    "en-GB",
  )}). Narrow the filters, for example by date.`,
  before_from: "The end date is before the start date.",
};

/** DP-229: the separator choices of the export, in the order the console shows them. */
export const EXPORT_SEPARATOR_OPTIONS: readonly {
  value: LeadExportSeparator;
  label: string;
  hint: string;
}[] = [
  {
    value: ";",
    label: "Semicolon (;)",
    hint: "Opens in columns in Excel with Dutch or Turkish settings.",
  },
  {
    value: ",",
    label: "Comma (,)",
    hint: "For Excel with English settings, Google Sheets and other tools.",
  },
];

/**
 * The list filters (`?a=1&b=2` or empty) plus the separator (DP-229). Any separator already in the
 * query is replaced, so the file always uses the one chosen on screen.
 */
export function exportQueryWithSeparator(query: string, separator: LeadExportSeparator): string {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  params.set(LEAD_EXPORT_SEPARATOR_PARAM, separator);
  return `?${params.toString()}`;
}

/** The file name the API chose (`attachment; filename="…"`), or a dated fallback. */
export function exportFilenameOf(disposition: string | null, now: Date = new Date()): string {
  const m = /filename="([A-Za-z0-9._-]{1,120})"/.exec(disposition ?? "");
  return m?.[1] ?? `leads-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * The real reason of a failed export for staff: the API's code, rule and request id (support can
 * find the request in the logs), never a generic "something went wrong".
 */
export function exportErrorMessage(status: number, body: unknown): string {
  const parsed = ErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return status === 0
      ? "The admin API cannot be reached. Check the connection and try again."
      : `The export failed (HTTP ${status}). Try again in a moment.`;
  }
  const { code, requestId, details } = parsed.data.error;
  const rule = details
    .map((d) => (typeof d === "object" && d && "rule" in d ? String(d.rule) : ""))
    .find((r) => r in EXPORT_RULE_MESSAGES);
  const ref = ` (HTTP ${status}, ${code}, request ${requestId})`;
  if (rule) return `${EXPORT_RULE_MESSAGES[rule]}${ref}`;
  const badSeparator = details.some(
    (d) => typeof d === "object" && d && "path" in d && d.path === LEAD_EXPORT_SEPARATOR_PARAM,
  );
  if (badSeparator) return `Choose a separator: semicolon (;) or comma (,).${ref}`;
  if (code === "FORBIDDEN") {
    return `You may not export these leads. Exporting needs the lead export permission (customer-data officer or platform administrator) on every selected site.${ref}`;
  }
  if (code === "AUTH_SESSION_REQUIRED") return `Your session has ended. Sign in again.${ref}`;
  const text =
    code in DEFAULT_ERROR_MESSAGES
      ? DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES]
      : "The export failed.";
  return `${text}${ref}`;
}

/** Downloads the filtered leads as CSV (chosen separator, DP-229) through the same-origin proxy. */
export async function downloadLeadExport(
  query: string,
  separator: LeadExportSeparator,
): Promise<LeadExportResult> {
  let res: Response;
  try {
    res = await fetch(`${LEAD_EXPORT_PATH}${exportQueryWithSeparator(query, separator)}`, {
      method: "GET",
      headers: { Accept: "text/csv, application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: exportErrorMessage(0, null), stepUp: false };
  }
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    const parsed = ErrorBodySchema.safeParse(json);
    return {
      ok: false,
      status: res.status,
      message: exportErrorMessage(res.status, json),
      stepUp: parsed.success && parsed.data.error.code === "AUTH_STEP_UP_REQUIRED",
    };
  }
  try {
    const blob = await res.blob();
    const rows = Number(res.headers.get("x-dp-export-rows"));
    return {
      ok: true,
      blob,
      filename: exportFilenameOf(res.headers.get("content-disposition")),
      rows: Number.isInteger(rows) && rows >= 0 ? rows : null,
    };
  } catch {
    // The connection broke while the file streamed: the file is incomplete, so nothing is saved.
    return {
      ok: false,
      status: res.status,
      message:
        "The download was interrupted before the file was complete. Nothing was saved; try again.",
      stepUp: false,
    };
  }
}
