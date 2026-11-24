/**
 * Lead list view helpers (DP-042; ADR-016 D8): the query the console sends to the API and the
 * labels it shows. Leads are customer data; the API decides who may read them (lead:read).
 * DP-041 (ADR-019): status and assignee filters, workflow labels.
 */
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  legalTextVersionLocale,
  type LeadContactChannel,
  type LeadNotificationStatus,
  type LeadSource,
  type LeadStatus,
} from "@dream/contracts";
import type { DocumentType } from "@dream/contracts";
import type { PillTone } from "../components/ui";
import { type AdminLocale, INTL_LOCALE } from "./i18n/config";
import { formatNumber } from "./i18n/format";
import type { Translate } from "./i18n/types";

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

/**
 * ML-12e: the labels below are dictionary messages (`leads.*` in lib/i18n/messages/leads), keyed by
 * the API's codes; the codes themselves never change. Tones are not text and stay here.
 */

/** DP-221: how the lead first reached us. */
export function sourceLabel(source: LeadSource, t: Translate): string {
  return t(`leads.source.${source}`);
}

/** DP-221: the staff e-mail of a contact-form message. */
export function notificationLabel(status: LeadNotificationStatus, t: Translate): string {
  return t(`leads.notification.${status}`);
}

export const NOTIFICATION_TONE: Readonly<Record<LeadNotificationStatus, PillTone>> = {
  PENDING: "neutral",
  SENT: "success",
  SKIPPED: "neutral",
  FAILED: "amber",
};

/** Reason codes of a skipped or failed notification that have their own words for staff. */
export const NOTIFICATION_REASONS = [
  "disabled",
  "no_recipients",
  "transport_off",
  "smtp_auth",
  "smtp_rejected",
  "smtp_deferred",
  "smtp_timeout",
  "smtp_unavailable",
  "smtp_error",
] as const;
type NotificationReason = (typeof NOTIFICATION_REASONS)[number];
const REASON_SET = new Set<string>(NOTIFICATION_REASONS);

/** The words of a reason code, or undefined for an unknown (or no) code. */
export function notificationReason(code: string | null, t: Translate): string | undefined {
  return code !== null && REASON_SET.has(code)
    ? t(`leads.notificationReason.${code as NotificationReason}`)
    : undefined;
}

export function statusLabel(status: LeadStatus, t: Translate): string {
  return t(`leads.status.${status}`);
}

export const STATUS_TONE: Readonly<Record<LeadStatus, PillTone>> = {
  NEW: "petrol",
  CONTACTED: "neutral",
  QUALIFIED: "amber",
  UNQUALIFIED: "neutral",
  CONVERTED: "success",
};

/** What each status means for the sales team (shown as a hint). */
export function statusHint(status: LeadStatus, t: Translate): string {
  return t(`leads.statusHint.${status}`);
}

export function channelLabel(channel: LeadContactChannel, t: Translate): string {
  return t(`leads.channel.${channel}`);
}

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

const regions = new Map<AdminLocale, Intl.DisplayNames>();

/** The country's name in the UI language (English: as before ML-12e); the code if unknown. */
export function countryName(code: string, locale: AdminLocale): string {
  let names = regions.get(locale);
  if (!names) {
    // English keeps the plain "en" names the console showed before ML-12e.
    names = new Intl.DisplayNames([locale === "en" ? "en" : INTL_LOCALE[locale]], {
      type: "region",
    });
    regions.set(locale, names);
  }
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function docTypeLabel(type: DocumentType, t: Translate): string {
  return t(`leads.docType.${type}`);
}

/** DP-227: "1 lead", "1,234 leads". */
export function leadCount(n: number, t: Translate, locale: AdminLocale): string {
  return t("leads.count", { count: n, n: formatNumber(n, locale) });
}

/** DP-227: what the export would download, said before the click. */
export function exportSummaryText(
  count: number,
  maxRows: number,
  filtered: boolean,
  t: Translate,
  locale: AdminLocale,
): string {
  if (count === 0) {
    return filtered ? t("leads.exportSummary.noneFiltered") : t("leads.exportSummary.none");
  }
  const leads = leadCount(count, t, locale);
  if (count > maxRows) {
    return t("leads.exportSummary.tooMany", { leads, max: formatNumber(maxRows, locale) });
  }
  return filtered
    ? t("leads.exportSummary.filtered", { leads })
    : t("leads.exportSummary.total", { leads });
}

/** ML-10: names of the form languages in the UI language; any other tag is shown as stored. */
function languageName(tag: string, t: Translate): string {
  return tag === "en" || tag === "nl" ? t(`leads.language.${tag}`) : tag;
}

/**
 * ML-10 (ADR-028 D12): the language a form was sent in, as stored. A request or message stored
 * before ML-10 has none: it is shown as English (the only language then) and marked as not
 * recorded; the stored row is never changed. Only the label is translated (ML-12e).
 */
export function formLanguageLabel(locale: string | null, t: Translate): string {
  return locale === null ? t("leads.language.notRecorded") : languageName(locale, t);
}

/** ML-10: the language of the legal text a version names (`<date>.<locale>`; older: English). */
export function textLanguageLabel(version: string, t: Translate): string {
  return languageName(legalTextVersionLocale(version), t);
}
