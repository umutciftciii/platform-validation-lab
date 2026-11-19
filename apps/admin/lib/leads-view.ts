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
  return {
    site: UUID.test(site) ? site.toLowerCase() : "",
    q: one(params["q"]).trim().slice(0, 100),
    cursor: CURSOR.test(cursor) ? cursor : "",
    status: STATUS_SET.has(status) ? status : "",
    assignee: assignee === "me" || assignee === "none" ? assignee : "",
    source: SOURCE_SET.has(source) ? source : "",
  };
}

export function leadListQuery(f: LeadFilters): string {
  const qs = new URLSearchParams();
  if (f.site) qs.set("siteId", f.site);
  if (f.q) qs.set("q", f.q);
  if (f.status) qs.set("status", f.status);
  if (f.assignee) qs.set("assignee", f.assignee);
  if (f.source) qs.set("source", f.source);
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
