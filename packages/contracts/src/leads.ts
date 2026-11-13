/**
 * Lead-gated document downloads (DP-042, DP-043; ADR-016). Shared by the API, the public sites
 * and the admin console.
 *
 * - A visitor asks for a `LEAD_REQUIRED` document with a short form: name, company, work e-mail
 *   and country. The privacy notice must be confirmed; marketing consent is a separate, optional,
 *   unticked box. Both texts are versioned here; the API refuses a version it does not know and
 *   stores the version and the SHA-256 of the exact text with every request (consent evidence).
 * - The request answers a short-lived download grant (15 minutes, at most 3 downloads) whose token
 *   only the site's server sees; it travels to the API in `X-DP-Download-Grant`, never in a URL.
 * - Leads are customer data: the admin reads them only with `lead:read` on the lead's site.
 */
import { z } from "zod";
import { EmailSchema, UuidSchema } from "./auth/common.js";
import { DocumentTypeSchema } from "./admin/catalog-documents.js";

const IsoDate = z.iso.datetime({ offset: true });

export const PUBLIC_LEADS_API = "/api/v1/public/leads";
export const ADMIN_LEADS_API = "/api/v1/admin/leads";

/** Header that carries a download grant from the site's server to the API. */
export const DOWNLOAD_GRANT_HEADER = "X-DP-Download-Grant";
export const DOWNLOAD_GRANT_TTL_MINUTES = 15;
export const DOWNLOAD_GRANT_MAX_DOWNLOADS = 3;

/**
 * Required information (GDPR Art. 13), not consent. Changing the text needs a new version; the
 * API refuses requests that name an older one (the site then offers the current text, DP-095
 * D-T7), so stored evidence always matches a known text. The version names the language
 * (D-T6): a later language is its own version and hash.
 *
 * `final: false` (DP-095 D-T3): the wording is approved, but it is not final while the controller
 * details of D-T2 are missing (`privacyBlockers()`); it is not published in production until then.
 */
export const LEAD_PRIVACY_NOTICE = {
  version: "2026-11-12.en",
  final: false,
  text:
    "Dream Petroleum B.V. uses your name, company, work e-mail and country to send you this " +
    "document, to keep a record of which document we provided, and to follow up on your " +
    "request. We do this on the basis of our legitimate interest in answering business " +
    "enquiries. The PDF you receive is marked with your name, your company and a request " +
    "reference. We keep these details for 24 months after your last request or your last " +
    "activity under a marketing consent, then anonymise them. You can ask to see, correct or " +
    "delete them, or object to this use, as explained in our Privacy Policy.",
} as const;

/**
 * Optional, separate marketing consent (never required for a download, never pre-ticked). No
 * marketing e-mail is sent before DP-097 (one-click unsubscribe, withdrawal record) is live.
 */
export const LEAD_MARKETING_CONSENT = {
  version: "2026-11-12.en",
  final: true,
  text:
    "Yes, Dream Petroleum B.V. may e-mail me occasional news about its products and technical " +
    "updates. I can withdraw this at any time with the link in every e-mail or as explained in " +
    "the Privacy Policy.",
} as const;

/**
 * DP-151: required information for the contact form (GDPR Art. 13), not consent: shown next to
 * the form with a link to the Privacy Policy, never as a box to tick. Same rules as the document
 * notice: a new wording is a new version, older texts go to the archive. A draft
 * until Dream Petroleum (or its DPO) approves it (`final: false` blocks production publication,
 * `privacyBlockers()`).
 */
export const LEAD_CONTACT_NOTICE = {
  version: "2026-11-13.en",
  final: false,
  text:
    "Dream Petroleum B.V. uses your name, company, e-mail, country, your message and, if you give " +
    "it, your phone number to answer your enquiry and to keep a record of it. We do this on the " +
    "basis of our legitimate interest in answering business enquiries. We keep these details for " +
    "24 months after your last message or request, then anonymise them. You can ask to see, " +
    "correct or delete them, or object to this use, as explained in our Privacy Policy.",
} as const;

/**
 * Earlier texts, kept so the version and SHA-256 stored with an older request can still be
 * checked against the exact words the visitor saw (DP-095 D-T7). Never edit an entry.
 */
export const LEAD_TEXT_ARCHIVE = {
  privacyNotice: [
    {
      version: "2026-11-11",
      text:
        "Dream Petroleum BV uses the details in this form to send you the requested document, to " +
        "keep a record of which document was provided to you, and to follow up on your request. " +
        "The file you receive is marked with your name, company and a request reference. We do not " +
        "sell your details. You can ask us at any time to see or delete them.",
    },
  ],
  marketingConsent: [
    {
      version: "2026-11-11",
      text:
        "Yes, send me occasional e-mails about Dream Petroleum products and technical updates. I can " +
        "unsubscribe at any time.",
    },
  ],
} as const;

/** The current texts of the lead form, as a site serves them to a page that holds older ones. */
export const LeadFormTextsSchema = z.strictObject({
  privacyNotice: z.strictObject({ version: z.string(), text: z.string() }),
  marketingConsent: z.strictObject({ version: z.string(), text: z.string() }),
});
export type LeadFormTexts = z.infer<typeof LeadFormTextsSchema>;

export function currentLeadFormTexts(): LeadFormTexts {
  return {
    privacyNotice: { version: LEAD_PRIVACY_NOTICE.version, text: LEAD_PRIVACY_NOTICE.text },
    marketingConsent: {
      version: LEAD_MARKETING_CONSENT.version,
      text: LEAD_MARKETING_CONSENT.text,
    },
  };
}

/** Error code a site answers its own browser when the form named an older text (D-T7). */
export const LEAD_TEXT_OUTDATED = "LEAD_TEXT_OUTDATED";
export const LEAD_TEXT_FIELDS = ["privacyNoticeVersion", "marketingConsentVersion"] as const;

/** ISO 3166-1 alpha-2 codes (249). Names come from Intl.DisplayNames in the UI. */
export const COUNTRY_CODES = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
] as const;
export const CountryCodeSchema = z.enum(COUNTRY_CODES);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/**
 * Well-known free-mail domains. Accepted, but the lead is flagged (`freeMailDomain`) so sales can
 * judge (ADR-016 D1; blocking them is an open owner decision, DP-098).
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
  "zoho.com",
  "hotmail.co.uk",
  "yahoo.co.uk",
  "outlook.de",
  "hotmail.de",
  "yahoo.de",
  "hotmail.fr",
  "yahoo.fr",
  "orange.fr",
  "laposte.net",
  "libero.it",
  "t-online.de",
]);

export function isFreeMailDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at > 0 && FREE_MAIL_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

/** Free text of the form: trimmed, inner whitespace collapsed, no control or angle characters. */
function formText(min: number, max: number) {
  return z
    .string()
    .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .regex(/^[^\p{Cc}\p{Cf}<>]*$/u),
    );
}

export const LEAD_FULL_NAME_MAX = 120;
export const LEAD_COMPANY_MAX = 160;
export const LEAD_EMAIL_MAX = 254;

/** The short form as the site's server forwards it (strict: unknown keys are refused). */
export const LEAD_PHONE_MAX = 40;
export const LEAD_SUBJECT_MAX = 160;
export const LEAD_MESSAGE_MIN = 10;
export const LEAD_MESSAGE_MAX = 4000;

/** Multi-line text: line breaks kept (at most one blank line in a row), other control characters refused. */
function messageText(min: number, max: number) {
  return z
    .string()
    .transform((v) =>
      v
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        // Refusing control characters is the point (line feeds stay, everything else goes).
        // eslint-disable-next-line no-control-regex
        .regex(/^[^\p{Cf}<>\u0000-\u0009\u000B-\u001F\u007F]*$/u),
    );
}

/** An optional single-line field: blank becomes null. */
function optionalText(max: number, pattern?: RegExp) {
  return z
    .string()
    .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .max(max)
        .regex(pattern ?? /^[^\p{Cc}\p{Cf}<>]*$/u),
    )
    .transform((v) => (v === "" ? null : v));
}

/**
 * DP-151: the contact form as the site's server forwards it. Name, company, e-mail, country and
 * the message are required (company and country because one person is one lead per site, and a
 * lead always has them); phone and subject are optional.
 *
 * Owner decisions (2026-11-13): no marketing consent on this form, and no tick box for the
 * notice. Answering an enquiry rests on legitimate interest, not consent, so the notice is
 * information the visitor can read next to the form, not something to agree to. The form sends
 * the version of the notice it showed; the API stores that version and the SHA-256 of its text.
 */
export const LeadContactMessageInputSchema = z.strictObject({
  fullName: formText(2, LEAD_FULL_NAME_MAX),
  company: formText(1, LEAD_COMPANY_MAX),
  email: EmailSchema.pipe(z.string().max(LEAD_EMAIL_MAX)),
  country: CountryCodeSchema,
  phone: optionalText(LEAD_PHONE_MAX, /^[+0-9 ()./-]*$/),
  subject: optionalText(LEAD_SUBJECT_MAX),
  message: messageText(LEAD_MESSAGE_MIN, LEAD_MESSAGE_MAX),
  /** The notice version shown next to the form (information, not consent). */
  privacyNoticeVersion: z.string().max(20),
  /** Honeypot: hidden in the form, must stay empty. */
  website: z.literal(""),
});
export type LeadContactMessageInput = z.input<typeof LeadContactMessageInputSchema>;

/** Nothing about the stored message comes back to the visitor. */
export const LeadContactMessageResponseSchema = z.strictObject({ received: z.literal(true) });
export type LeadContactMessageResponse = z.infer<typeof LeadContactMessageResponseSchema>;

export const LeadDocumentRequestInputSchema = z.strictObject({
  documentId: UuidSchema,
  fullName: formText(2, LEAD_FULL_NAME_MAX),
  company: formText(1, LEAD_COMPANY_MAX),
  email: EmailSchema.pipe(z.string().max(LEAD_EMAIL_MAX)),
  country: CountryCodeSchema,
  privacyNoticeVersion: z.string().max(20),
  privacyNoticeAccepted: z.literal(true),
  marketingConsent: z.boolean(),
  /** The marketing text version shown next to the box (required when the box is ticked). */
  marketingConsentVersion: z.string().max(20).nullable(),
  /** Honeypot: hidden in the form, must stay empty. */
  website: z.literal(""),
});
export type LeadDocumentRequestInput = z.infer<typeof LeadDocumentRequestInputSchema>;

/** API answer to the site's server. The token never reaches the browser or a URL. */
export const LeadDocumentRequestResponseSchema = z.strictObject({
  reference: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
  grant: z.strictObject({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: IsoDate,
    maxDownloads: z.number().int().min(1),
  }),
});
export type LeadDocumentRequestResponse = z.infer<typeof LeadDocumentRequestResponseSchema>;

/** What the site's server answers its own browser after a successful request. */
export const SiteLeadRequestResultSchema = z.strictObject({
  reference: z.string(),
  expiresAt: IsoDate,
  maxDownloads: z.number().int().min(1),
  downloadUrl: z.string().startsWith("/"),
});
export type SiteLeadRequestResult = z.infer<typeof SiteLeadRequestResultSchema>;

// --- admin (lead:read on the lead's site) -----------------------------------------------------

export const LEADS_PAGE_SIZE = 50;

// --- sales workflow (DP-041, ADR-019; lead:manage on the lead's site) ----------------------------

/** Where a lead is in the sales workflow. Every lead starts as NEW. */
export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

/**
 * Allowed status changes (ADR-019 D2). The database refuses any other one (leads_lead_guard).
 * CONVERTED is final; UNQUALIFIED can be reopened.
 */
export const LEAD_STATUS_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  NEW: ["CONTACTED", "QUALIFIED", "UNQUALIFIED"],
  CONTACTED: ["QUALIFIED", "UNQUALIFIED"],
  QUALIFIED: ["CONVERTED", "UNQUALIFIED"],
  UNQUALIFIED: ["CONTACTED", "QUALIFIED"],
  CONVERTED: [],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Statuses that keep a lead out of automatic anonymisation (ADR-019 D5, DP-096 D-R1): an open
 * opportunity (QUALIFIED) or a customer (CONVERTED).
 */
export const LEAD_PIPELINE_HELD: readonly LeadStatus[] = ["QUALIFIED", "CONVERTED"];

export const LEAD_CONTACT_CHANNELS = ["EMAIL", "PHONE", "MEETING", "OTHER"] as const;
export const LeadContactChannelSchema = z.enum(LEAD_CONTACT_CHANNELS);
export type LeadContactChannel = z.infer<typeof LeadContactChannelSchema>;

export const LEAD_ACTIVITY_KINDS = [
  "NOTE",
  "CONTACT",
  "STATUS_CHANGED",
  "ASSIGNMENT_CHANGED",
] as const;
export const LeadActivityKindSchema = z.enum(LEAD_ACTIVITY_KINDS);
export type LeadActivityKind = z.infer<typeof LeadActivityKindSchema>;

export const LEAD_NOTE_MAX = 4000;

/** Free text of a note or contact summary: NFC, trimmed, no control characters except newlines. */
const ActivityText = z
  .string()
  .transform((v) => v.normalize("NFC").replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(LEAD_NOTE_MAX)
      .regex(/^(?:[^\p{Cc}\p{Cf}]|\n|\t)*$/u),
  );

/** A staff user a lead can be assigned to (lead:manage on the lead's site). */
export const LeadAssigneeSchema = z.strictObject({
  id: UuidSchema,
  displayName: z.string(),
  email: z.string(),
});
export type LeadAssignee = z.infer<typeof LeadAssigneeSchema>;

/**
 * Status and/or assignment change. `version` is the lead's `workflowVersion` as the caller saw it
 * (stale: 409 CONFLICT_STATE, rule `stale`). `assignedToId: null` unassigns. An optional note is
 * stored with the change (same transaction).
 */
export const LeadWorkflowInputSchema = z
  .strictObject({
    version: z.number().int().min(0),
    status: LeadStatusSchema.optional(),
    assignedToId: UuidSchema.nullable().optional(),
    note: ActivityText.optional(),
  })
  .refine((v) => v.status !== undefined || v.assignedToId !== undefined, {
    message: "status or assignedToId is required",
    path: ["status"],
  });
export type LeadWorkflowInput = z.input<typeof LeadWorkflowInputSchema>;

/** A note, or a record of a contact (channel and when it happened, not in the future). */
export const LeadActivityInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("NOTE"), body: ActivityText }),
  z.strictObject({
    kind: z.literal("CONTACT"),
    body: ActivityText,
    channel: LeadContactChannelSchema,
    contactedAt: IsoDate,
  }),
]);
export type LeadActivityInput = z.input<typeof LeadActivityInputSchema>;

export const LeadActivitySchema = z.strictObject({
  id: UuidSchema,
  kind: LeadActivityKindSchema,
  createdAt: IsoDate,
  actor: z.strictObject({ id: UuidSchema, displayName: z.string() }),
  /** Null once the lead was anonymised (`redactedAt`). */
  body: z.string().nullable(),
  redactedAt: IsoDate.nullable(),
  contactChannel: LeadContactChannelSchema.nullable(),
  contactedAt: IsoDate.nullable(),
  fromStatus: LeadStatusSchema.nullable(),
  toStatus: LeadStatusSchema.nullable(),
  fromAssignee: z.strictObject({ id: UuidSchema, displayName: z.string() }).nullable(),
  toAssignee: z.strictObject({ id: UuidSchema, displayName: z.string() }).nullable(),
});
export type LeadActivity = z.infer<typeof LeadActivitySchema>;

export const LEAD_ACTIVITY_LIMIT = 200;

/** List filter `assignee`: `me`, `none` (unassigned) or a staff user id. */
export const LeadAssigneeFilterSchema = z.union([z.literal("me"), z.literal("none"), UuidSchema]);

export const LeadSummarySchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  siteKey: z.enum(["BV", "CORPORATE"]),
  email: z.string(),
  fullName: z.string(),
  company: z.string(),
  country: z.string(),
  freeMailDomain: z.boolean(),
  marketingConsentAt: IsoDate.nullable(),
  requestCount: z.number().int().min(0),
  firstRequestAt: IsoDate,
  lastRequestAt: IsoDate,
  /** DP-096: identity fields cleared (retention or erasure request); the row is evidence only. */
  anonymisedAt: IsoDate.nullable(),
  /** DP-096: kept outside the 24-month rule (customer, open opportunity, legal hold). */
  retentionHold: z.enum(["CUSTOMER", "OPEN_OPPORTUNITY", "LEGAL_HOLD"]).nullable(),
  /** DP-041: sales workflow. */
  status: LeadStatusSchema,
  statusChangedAt: IsoDate.nullable(),
  assignedTo: z
    .strictObject({
      id: UuidSchema,
      displayName: z.string(),
      /** False when the assignee no longer holds lead:manage on the lead's site. */
      active: z.boolean(),
    })
    .nullable(),
  assignedAt: IsoDate.nullable(),
  workflowVersion: z.number().int().min(0),
});
export type LeadSummary = z.infer<typeof LeadSummarySchema>;

export const LeadListResponseSchema = z.strictObject({
  items: z.array(LeadSummarySchema).max(LEADS_PAGE_SIZE),
  /** Opaque cursor of the next page, or null. */
  nextCursor: z.string().nullable(),
  /** Sites the caller may read leads of (empty: no lead:read anywhere). */
  sites: z.array(
    z.strictObject({ id: UuidSchema, key: z.enum(["BV", "CORPORATE"]), name: z.string() }),
  ),
});
export type LeadListResponse = z.infer<typeof LeadListResponseSchema>;

export const LeadDownloadSchema = z.strictObject({
  deliveredAt: IsoDate,
  byteSize: z.number().int(),
  /** Null once the lead is anonymised (it re-links the stamped PDF, DP-096 D-R5). */
  sha256: z.string().nullable(),
});

export const LeadRequestSchema = z.strictObject({
  id: UuidSchema,
  /** Null once the lead is anonymised (printed on the PDF, DP-096 D-R5). */
  reference: z.string().nullable(),
  createdAt: IsoDate,
  fullName: z.string(),
  company: z.string(),
  country: z.string(),
  product: z.strictObject({ id: UuidSchema, code: z.string(), name: z.string(), slug: z.string() }),
  document: z.strictObject({ id: UuidSchema, type: DocumentTypeSchema, title: z.string() }),
  revision: z.strictObject({ id: UuidSchema, revisionNumber: z.number().int() }),
  privacyNoticeVersion: z.string(),
  privacyNoticeSha256: z.string(),
  marketingConsent: z.boolean(),
  marketingConsentVersion: z.string().nullable(),
  grant: z
    .strictObject({
      expiresAt: IsoDate,
      downloadCount: z.number().int(),
      maxDownloads: z.number().int(),
    })
    .nullable(),
  downloads: z.array(LeadDownloadSchema),
});
export type LeadRequest = z.infer<typeof LeadRequestSchema>;

/** DP-151: a contact-form message. Name, company, phone, subject and text are cleared on anonymisation. */
export const LeadContactMessageSchema = z.strictObject({
  id: UuidSchema,
  createdAt: IsoDate,
  fullName: z.string(),
  company: z.string(),
  country: z.string(),
  phone: z.string().nullable(),
  subject: z.string().nullable(),
  /** Null once the lead is anonymised. */
  message: z.string().nullable(),
  /** The notice shown with the form (version and SHA-256 of its exact text). */
  privacyNoticeVersion: z.string(),
  privacyNoticeSha256: z.string(),
  redactedAt: IsoDate.nullable(),
});
export type LeadContactMessage = z.infer<typeof LeadContactMessageSchema>;

export const LeadDetailResponseSchema = z.strictObject({
  lead: LeadSummarySchema,
  requests: z.array(LeadRequestSchema).max(200),
  /** DP-151: contact-form messages, newest first. */
  contactMessages: z.array(LeadContactMessageSchema).max(200),
  /** DP-041: newest first. */
  activities: z.array(LeadActivitySchema).max(LEAD_ACTIVITY_LIMIT),
  /** The caller holds lead:manage on the lead's site (and the lead is not anonymised). */
  canManage: z.boolean(),
  /** Staff the lead can be assigned to; empty unless `canManage`. */
  assignees: z.array(LeadAssigneeSchema),
});

/** Answer of a workflow change or a new activity: the lead as it is now. */
export const LeadWorkflowResponseSchema = z.strictObject({ lead: LeadSummarySchema });
export type LeadWorkflowResponse = z.infer<typeof LeadWorkflowResponseSchema>;
export const LeadActivityResponseSchema = z.strictObject({ activity: LeadActivitySchema });
export type LeadActivityResponse = z.infer<typeof LeadActivityResponseSchema>;
export type LeadDetailResponse = z.infer<typeof LeadDetailResponseSchema>;
