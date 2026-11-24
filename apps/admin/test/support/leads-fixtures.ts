// ML-12e (DP-243): fixtures of the Leads area shared by leads-en.test.tsx (EN baseline) and
// leads-i18n.test.tsx (Turkish): leads in every status, source, assignment, consent and retention
// state; a lead detail with document requests, contact-form messages (every notification status
// and reason), downloads and a full sales history; the notification settings of two sites. All
// values are API response shapes (@dream/contracts) and data: names, e-mail addresses, messages,
// consent versions and hashes are never translated.
import type {
  LeadActivity,
  LeadContactMessage,
  LeadDetailResponse,
  LeadListResponse,
  LeadNotificationSettingsResponse,
  LeadNotificationSiteSettings,
  LeadRequest,
  LeadSummary,
} from "@dream/contracts";

export const id = (n: number) => `0190f3a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
export const BV = id(9001);
export const CORP = id(9002);
export const VIEWER = id(9100);
export const OTHER = id(9101);
export const GONE = id(9102);

export const AT = "2026-11-18T12:00:00.000Z";
export const EARLIER = "2026-10-02T07:30:00.000Z";
export const LATER = "2026-11-20T08:05:00.000Z";
export const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
export const SHA2 = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae";

export const LEADS_API = "/api/v1/admin/leads";
export const SUMMARY_API = "/api/v1/admin/leads/export/summary";
export const NOTIFICATIONS_API = "/api/v1/admin/lead-notifications";
export const detailPath = (leadId: string) => `${LEADS_API}/${encodeURIComponent(leadId)}`;

export const SITES: LeadListResponse["sites"] = [
  { id: BV, key: "BV", name: "Dream Petroleum BV" },
  { id: CORP, key: "CORPORATE", name: "Dream Petroleum Corporate" },
];

export const lead = (n: number, over: Partial<LeadSummary> = {}): LeadSummary => ({
  id: id(n),
  siteId: BV,
  siteKey: "BV",
  email: `buyer${n}@example-industry.nl`,
  fullName: `Jan Buyer ${n}`,
  company: `Example Industry ${n} B.V.`,
  country: "NL",
  freeMailDomain: false,
  source: "DOCUMENT_REQUEST",
  marketingConsentAt: null,
  requestCount: 1,
  firstRequestAt: EARLIER,
  lastRequestAt: AT,
  anonymisedAt: null,
  retentionHold: null,
  status: "NEW",
  statusChangedAt: null,
  assignedTo: null,
  assignedAt: null,
  workflowVersion: 0,
  ...over,
});

/** One lead per visible state of a list row. */
export const LEADS: LeadSummary[] = [
  lead(1),
  lead(2, {
    status: "CONTACTED",
    source: "CONTACT_FORM",
    requestCount: 0,
    assignedTo: { id: VIEWER, displayName: "Sanne Sales", active: true },
    marketingConsentAt: EARLIER,
    country: "DE",
  }),
  lead(3, {
    status: "QUALIFIED",
    requestCount: 3,
    retentionHold: "OPEN_OPPORTUNITY",
    assignedTo: { id: GONE, displayName: "Former Colleague", active: false },
    freeMailDomain: true,
    email: "buyer3@gmail.com",
    country: "TR",
    siteId: CORP,
    siteKey: "CORPORATE",
  }),
  lead(4, { status: "UNQUALIFIED", country: "BE", lastRequestAt: LATER }),
  lead(5, {
    status: "CONVERTED",
    retentionHold: "CUSTOMER",
    assignedTo: { id: OTHER, displayName: "Piet Partner", active: true },
    country: "GB",
  }),
  lead(6, {
    anonymisedAt: LATER,
    fullName: "",
    company: "",
    email: "",
    country: "US",
    retentionHold: "LEGAL_HOLD",
  }),
  lead(7, { country: "XK", source: "CONTACT_FORM", requestCount: 2 }),
];

export const list = (over: Partial<LeadListResponse> = {}): LeadListResponse => ({
  items: LEADS,
  nextCursor: null,
  sites: SITES,
  ...over,
});

/** A full page (50 rows) of the list. */
export const FULL_PAGE: LeadSummary[] = Array.from({ length: 50 }, (_, i) =>
  lead(100 + i, { status: (["NEW", "CONTACTED", "QUALIFIED"] as const)[i % 3] }),
);

export const summary = (count = 7, canExport = true, maxRows = 20000) => ({
  count,
  maxRows,
  canExport,
});

// --- lead detail --------------------------------------------------------------------------------

const actor = { id: OTHER, displayName: "Piet Partner" };

export const activity = (n: number, over: Partial<LeadActivity>): LeadActivity => ({
  id: id(500 + n),
  kind: "NOTE",
  createdAt: AT,
  actor,
  body: null,
  redactedAt: null,
  contactChannel: null,
  contactedAt: null,
  fromStatus: null,
  toStatus: null,
  fromAssignee: null,
  toAssignee: null,
  ...over,
});

/** Every kind of history entry, with and without its optional parts. */
export const ACTIVITIES: LeadActivity[] = [
  activity(1, { body: "Asked for a quote on 200 L drums.\nCall back on Monday." }),
  activity(2, { kind: "CONTACT", contactChannel: "PHONE", contactedAt: EARLIER, body: "Spoke." }),
  activity(3, { kind: "CONTACT", contactChannel: "EMAIL", contactedAt: EARLIER, body: "Sent." }),
  activity(4, { kind: "CONTACT", contactChannel: "MEETING", contactedAt: AT, body: "Met." }),
  activity(5, { kind: "CONTACT", contactChannel: "OTHER", contactedAt: null, body: "Fair." }),
  activity(6, { kind: "CONTACT", contactChannel: null, contactedAt: null, body: "Unknown." }),
  activity(7, { kind: "STATUS_CHANGED", fromStatus: "NEW", toStatus: "CONTACTED" }),
  activity(8, { kind: "STATUS_CHANGED", fromStatus: "QUALIFIED", toStatus: "CONVERTED" }),
  activity(9, { kind: "STATUS_CHANGED", fromStatus: "CONTACTED", toStatus: "UNQUALIFIED" }),
  activity(10, { kind: "STATUS_CHANGED", fromStatus: null, toStatus: null }),
  activity(11, {
    kind: "ASSIGNMENT_CHANGED",
    toAssignee: { id: VIEWER, displayName: "Sanne Sales" },
  }),
  activity(12, {
    kind: "ASSIGNMENT_CHANGED",
    fromAssignee: { id: VIEWER, displayName: "Sanne Sales" },
  }),
  activity(13, { kind: "ASSIGNMENT_CHANGED" }),
  activity(14, { kind: "NOTE", body: null, redactedAt: LATER }),
  activity(15, { kind: "NOTE", body: null, redactedAt: null }),
];

type Notification = NonNullable<LeadContactMessage["notification"]>;
const note = (over: Partial<Notification>): Notification => ({
  status: "SENT",
  reason: null,
  attempts: 1,
  sentAt: AT,
  recipientCount: 1,
  ...over,
});

export const message = (n: number, over: Partial<LeadContactMessage> = {}): LeadContactMessage => ({
  id: id(600 + n),
  createdAt: AT,
  fullName: "Jan Buyer 1",
  company: "Example Industry 1 B.V.",
  country: "NL",
  phone: null,
  subject: `Question ${n} about base oils`,
  message: `Message ${n}: please send prices for SN 500.`,
  privacyNoticeVersion: "2026-11-13.en",
  privacyNoticeSha256: SHA,
  locale: "en",
  redactedAt: null,
  notification: note({}),
  ...over,
});

/** Every notification status and reason, form languages (none, en, nl, other) and anonymisation. */
export const MESSAGES: LeadContactMessage[] = [
  message(1, { phone: "+31 10 123 45 67" }),
  message(2, { notification: note({ recipientCount: 3 }), locale: "nl" }),
  message(3, { notification: note({ status: "SENT", sentAt: null }) }),
  message(4, { notification: note({ status: "PENDING", attempts: 0, sentAt: null }) }),
  message(5, {
    notification: note({ status: "PENDING", attempts: 2, reason: "smtp_timeout", sentAt: null }),
  }),
  message(6, {
    notification: note({ status: "PENDING", attempts: 1, reason: "weird_code", sentAt: null }),
  }),
  ...[
    "disabled",
    "no_recipients",
    "transport_off",
    "smtp_auth",
    "smtp_rejected",
    "smtp_deferred",
    "smtp_timeout",
    "smtp_unavailable",
    "smtp_error",
  ].map((reason, i) =>
    message(10 + i, {
      notification: note({
        status: i % 2 ? "FAILED" : "SKIPPED",
        reason,
        attempts: i % 4 === 1 ? 1 : 3,
        sentAt: null,
      }),
    }),
  ),
  message(20, { notification: note({ status: "SKIPPED", reason: null, sentAt: null }) }),
  message(21, {
    notification: note({ status: "FAILED", reason: null, attempts: 5, sentAt: null }),
  }),
  message(22, {
    notification: note({ status: "FAILED", reason: "new_reason", attempts: 1, sentAt: null }),
  }),
  message(23, { notification: null, locale: null, privacyNoticeVersion: "2026-11-11" }),
  message(24, { subject: null, locale: "de", privacyNoticeVersion: "2026-11-20.nl" }),
  message(25, {
    redactedAt: LATER,
    message: null,
    subject: null,
    fullName: "",
    company: "",
    country: "FR",
  }),
  message(26, { redactedAt: null, message: null }),
];

export const request = (n: number, over: Partial<LeadRequest> = {}): LeadRequest => ({
  id: id(700 + n),
  reference: `DP-REQ-${1000 + n}`,
  createdAt: AT,
  fullName: "Jan Buyer 1",
  company: "Example Industry 1 B.V.",
  country: "NL",
  product: {
    id: id(800 + n),
    code: `DP-${n}0W-40`,
    name: `Dream Motor Oil ${n}`,
    slug: `dmo-${n}`,
  },
  document: { id: id(850 + n), type: "TDS", title: `Product data ${n}` },
  revision: { id: id(870 + n), revisionNumber: n },
  privacyNoticeVersion: "2026-11-12.en",
  privacyNoticeSha256: SHA2,
  marketingConsent: false,
  marketingConsentVersion: null,
  locale: "en",
  grant: null,
  downloads: [],
  ...over,
});

/** Every document type, form language, consent state, grant and download form. */
export const REQUESTS: LeadRequest[] = [
  request(1, {
    marketingConsent: true,
    marketingConsentVersion: "2026-11-12.en",
    grant: { expiresAt: LATER, downloadCount: 2, maxDownloads: 3 },
    downloads: [
      { deliveredAt: AT, byteSize: 2_621_440, sha256: SHA },
      { deliveredAt: LATER, byteSize: 300, sha256: null },
      { deliveredAt: EARLIER, byteSize: 52_000, sha256: SHA2 },
    ],
  }),
  request(2, {
    document: { id: id(852), type: "SDS", title: "Safety sheet 2" },
    locale: null,
    privacyNoticeVersion: "2026-11-11",
    marketingConsent: true,
    marketingConsentVersion: null,
  }),
  request(3, {
    document: { id: id(853), type: "COA", title: "Certificate 3" },
    locale: "nl",
    privacyNoticeVersion: "2026-11-20.nl",
    marketingConsent: true,
    marketingConsentVersion: "2026-11-20.nl",
    reference: null,
  }),
  request(4, {
    document: { id: id(854), type: "OTHER", title: "Brochure 4" },
    locale: "fr",
    grant: { expiresAt: AT, downloadCount: 0, maxDownloads: 3 },
  }),
];

export const detail = (
  over: Partial<LeadDetailResponse> = {},
  leadOver: Partial<LeadSummary> = {},
): LeadDetailResponse => ({
  lead: lead(1, {
    source: "CONTACT_FORM",
    requestCount: 4,
    marketingConsentAt: EARLIER,
    assignedTo: { id: VIEWER, displayName: "Sanne Sales", active: true },
    workflowVersion: 3,
    ...leadOver,
  }),
  requests: REQUESTS,
  contactMessages: MESSAGES,
  activities: ACTIVITIES,
  canManage: true,
  assignees: [
    { id: VIEWER, displayName: "Sanne Sales", email: "sanne@dreampetroleum.example" },
    { id: OTHER, displayName: "Piet Partner", email: "piet@dreampetroleum.example" },
  ],
  ...over,
});

// --- notification settings ----------------------------------------------------------------------

export const person = (n: number, name: string) => ({
  id: id(9200 + n),
  displayName: name,
  email: `${name.split(" ")[0]!.toLowerCase()}@dreampetroleum.example`,
});

export const siteSettings = (
  over: Partial<LeadNotificationSiteSettings> = {},
): LeadNotificationSiteSettings => ({
  site: { id: BV, key: "BV", name: "Dream Petroleum BV" },
  enabled: true,
  recipients: [
    { ...person(1, "Sanne Sales"), eligible: true },
    { ...person(3, "Former Colleague"), eligible: false },
  ],
  candidates: [person(1, "Sanne Sales"), person(2, "Piet Partner")],
  version: 4,
  updatedAt: AT,
  updatedBy: { id: VIEWER, displayName: "Sanne Sales" },
  recent: { PENDING: 0, SENT: 12, SKIPPED: 0, FAILED: 1 },
  ...over,
});

export const notifications = (
  over: Partial<LeadNotificationSettingsResponse> = {},
): LeadNotificationSettingsResponse => ({
  transport: "smtp",
  sites: [
    siteSettings(),
    siteSettings({
      site: { id: CORP, key: "CORPORATE", name: "Dream Petroleum Corporate" },
      enabled: false,
      recipients: [],
      candidates: [],
      version: 0,
      updatedAt: null,
      updatedBy: null,
      recent: { PENDING: 0, SENT: 0, SKIPPED: 0, FAILED: 0 },
    }),
    siteSettings({
      site: { id: id(9003), key: "BV", name: "Third site" },
      updatedBy: null,
      recent: { PENDING: 2, SENT: 1, SKIPPED: 4, FAILED: 0 },
    }),
  ],
  ...over,
});

/** Ten people chosen: the list is full, the others cannot be added. */
export const FULL_LIST = siteSettings({
  recipients: Array.from({ length: 10 }, (_, i) => ({
    ...person(10 + i, `Person ${i}`),
    eligible: true,
  })),
  candidates: Array.from({ length: 12 }, (_, i) => person(10 + i, `Person ${i}`)),
});
