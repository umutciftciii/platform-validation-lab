/**
 * Lead list view helpers (DP-042; ADR-016 D8): the query the console sends to the API and the
 * labels it shows. Leads are customer data; the API decides who may read them (lead:read).
 * DP-041 (ADR-019): status and assignee filters, workflow labels.
 */
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  type LeadContactChannel,
  type LeadNotificationStatus,
  type LeadSource,
  type LeadStatus,
} from "@dream/contracts";
import type { PillTone } from "../components/ui";

export interface LeadFilters {
  site: string;
  q: string;
  cursor: string;
  /** DP-041: a LeadStatus or "". */
  status: string;
  /** DP-041: "me", "none" or "". */
  assignee: string;
  /** DP-221: a LeadSource or "". */
  source: string;
  /** DP-227: creation date range, `YYYY-MM-DD` (Europe/Amsterdam, inclusive) or "". */
  from: string;
  to: string;
}

/** DP-221: how the lead first reached us. */
export const SOURCE_LABEL: Readonly<Record<LeadSource, string>> = {
  DOCUMENT_REQUEST: "Document request",
  CONTACT_FORM: "Contact form",
};

/** DP-221: the staff e-mail of a contact-form message. */
export const NOTIFICATION_LABEL: Readonly<Record<LeadNotificationStatus, string>> = {
  PENDING: "E-mail pending",
  SENT: "Staff e-mailed",
  SKIPPED: "No e-mail",
  FAILED: "E-mail failed",
};

export const NOTIFICATION_TONE: Readonly<Record<LeadNotificationStatus, PillTone>> = {
  PENDING: "neutral",
  SENT: "success",
  SKIPPED: "neutral",
  FAILED: "amber",
};

/** Reason codes of a skipped or failed notification, for staff. */
export const NOTIFICATION_REASON: Readonly<Record<string, string>> = {
  disabled: "notifications are off for this site",
  no_recipients: "nobody on the list can read this site's leads",
  transport_off: "e-mail delivery is off in this environment",
  smtp_auth: "the mail server refused our login",
  smtp_rejected: "the mail server refused the e-mail",
  smtp_deferred: "the mail server asked us to try later",
  smtp_timeout: "the mail server did not answer in time",
  smtp_unavailable: "the mail server could not be reached",
  smtp_error: "the e-mail could not be sent",
};

export const STATUS_LABEL: Readonly<Record<LeadStatus, string>> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  UNQUALIFIED: "Unqualified",
  CONVERTED: "Converted",
};

export const STATUS_TONE: Readonly<Record<LeadStatus, PillTone>> = {
  NEW: "petrol",
  CONTACTED: "neutral",
  QUALIFIED: "amber",
  UNQUALIFIED: "neutral",
  CONVERTED: "success",
};

/** What each status means for the sales team (shown as a hint). */
export const STATUS_HINT: Readonly<Record<LeadStatus, string>> = {
  NEW: "Not yet worked.",
  CONTACTED: "We reached out or spoke with them.",
  QUALIFIED: "A real opportunity. Kept out of automatic anonymisation.",
  UNQUALIFIED: "Not a fit. Can be reopened.",
  CONVERTED: "Became a customer. Final; kept out of automatic anonymisation.",
};

export const CHANNEL_LABEL: Readonly<Record<LeadContactChannel, string>> = {
  EMAIL: "E-mail",
  PHONE: "Phone",
  MEETING: "Meeting",
  OTHER: "Other",
};

const STATUS_SET = new Set<string>(LEAD_STATUSES);
const SOURCE_SET = new Set<string>(LEAD_SOURCES);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** DP-227: `YYYY-MM-DD` and a real calendar day, else "". */
export function calendarDay(value: string): string {
  if (!DAY.test(value)) return "";
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 &&
    y <= 2999 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? value
    : "";
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export function readLeadFilters(
  params: Record<string, string | string[] | undefined>,
): LeadFilters {
  const site = one(params["site"]);
  const cursor = one(params["cursor"]);
  const status = one(params["status"]).toUpperCase();
  const assignee = one(params["assignee"]).toLowerCase();
  const source = one(params["source"]).toUpperCase();
  const from = calendarDay(one(params["from"]));
  let to = calendarDay(one(params["to"]));
  // A range that ends before it starts is dropped at the end (the API would refuse it).
  if (from && to && to < from) to = "";
  return {
    site: UUID.test(site) ? site.toLowerCase() : "",
    q: one(params["q"]).trim().slice(0, 100),
    cursor: CURSOR.test(cursor) ? cursor : "",
    status: STATUS_SET.has(status) ? status : "",
    assignee: assignee === "me" || assignee === "none" ? assignee : "",
    source: SOURCE_SET.has(source) ? source : "",
    from,
    to,
  };
}

/** DP-227: any filter beyond the site (search, status, assignee, source, dates). */
export function hasLeadFilters(f: LeadFilters): boolean {
  return Boolean(f.q || f.status || f.assignee || f.source || f.from || f.to);
}

/** DP-227: the API query of the CSV export and its summary: the list filters, no cursor. */
export function leadExportQuery(f: LeadFilters): string {
  return leadListQuery({ ...f, cursor: "" });
}

export function leadListQuery(f: LeadFilters): string {
  const qs = new URLSearchParams();
  if (f.site) qs.set("siteId", f.site);
  if (f.q) qs.set("q", f.q);
  if (f.status) qs.set("status", f.status);
  if (f.assignee) qs.set("assignee", f.assignee);
  if (f.source) qs.set("source", f.source);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.cursor) qs.set("cursor", f.cursor);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function leadListHref(f: Partial<LeadFilters>): string {
  const qs = new URLSearchParams();
  if (f.site) qs.set("site", f.site);
  if (f.q) qs.set("q", f.q);
  if (f.status) qs.set("status", f.status);
  if (f.assignee) qs.set("assignee", f.assignee);
  if (f.source) qs.set("source", f.source);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.cursor) qs.set("cursor", f.cursor);
  const s = qs.toString();
  return s ? `/leads?${s}` : "/leads";
}

const REGION = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return REGION.of(code) ?? code;
  } catch {
    return code;
  }
}

export const DOC_TYPE_LABEL: Readonly<Record<string, string>> = {
  TDS: "Technical data sheet",
  SDS: "Safety data sheet",
  COA: "Certificate of analysis",
  OTHER: "Document",
};

const NUMBER = new Intl.NumberFormat("en-GB");

/** DP-227: "1 lead", "1,234 leads". */
export function leadCount(n: number): string {
  return `${NUMBER.format(n)} lead${n === 1 ? "" : "s"}`;
}

/** DP-227: what the export would download, said before the click. */
export function exportSummaryText(count: number, maxRows: number, filtered: boolean): string {
  if (count === 0) {
    return filtered
      ? "No leads match these filters, so there is nothing to export."
      : "There are no leads to export yet.";
  }
  if (count > maxRows) {
    return `${leadCount(count)} match. One export holds at most ${NUMBER.format(maxRows)}; narrow the filters (for example the dates) to export.`;
  }
  return `${leadCount(count)} ${filtered ? "match these filters" : "in total"} and will be exported.`;
}
