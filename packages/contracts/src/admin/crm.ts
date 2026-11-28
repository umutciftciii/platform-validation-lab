/**
 * CRM 360° companies (CRM-1, ADR-032). Shared by the API and the admin console.
 *
 * - A company (organisation) belongs to one site, like its leads. It holds legal-entity data:
 *   name, location, the company's general phone and e-mail, a description and staff notes, and
 *   its account owner. People stay on the lead records (CRM-2 links them to companies).
 * - Customer data by access: read with `crm:read` on the company's site, created and changed with
 *   `crm:manage` there (sales_crm_user, platform super admin, system owner). The database checks
 *   the same again (row-level security, guard trigger) and stamps creator, editor and version.
 * - CRM-2 (DP-339): two companies of a site may share a name when country, city or registration
 *   number tells them apart. Saving a name another company of the site already has asks first
 *   (409, rule `possible_duplicate`) unless `confirmDistinct` is sent; the same name, country,
 *   city and registration number twice is refused (409, `duplicate_identity`), a registration
 *   number is unique per site (409, `duplicate_registration`).
 * - CRM-2 (ADR-032 D6): people. A person groups one or more leads of the same site (the same
 *   human with several e-mail addresses) and works for at most one company. The person holds no
 *   personal data itself: name and e-mail come from its leads. Linking needs `crm:manage`.
 * - Changes use optimistic concurrency (`version`; stale: 409, rule `stale`). Companies are never
 *   deleted through the API.
 */
import { z } from "zod";
import { EmailSchema, UuidSchema } from "../auth/common.js";
import { CountryCodeSchema, LeadStatusSchema } from "../leads.js";

const IsoDate = z.iso.datetime({ offset: true });

export const ADMIN_CRM_API = "/api/v1/admin/crm";
export const ADMIN_CRM_COMPANIES_API = `${ADMIN_CRM_API}/companies`;
/** Staff who may own the companies of the sites the caller manages (`crm:manage`). */
export const ADMIN_CRM_OWNERS_API = `${ADMIN_CRM_API}/owners`;
/** CRM-2: people (`/:id/company`). */
export const ADMIN_CRM_PEOPLE_API = `${ADMIN_CRM_API}/people`;
/** CRM-2: the CRM side of a lead (`/:leadId`, `/:leadId/person`, `/:leadId/candidates`). */
export const ADMIN_CRM_LEADS_API = `${ADMIN_CRM_API}/leads`;

export const CRM_COMPANIES_PAGE_SIZE = 50;
export const CRM_COMPANY_SEARCH_MAX = 100;
/** CRM-2: history entries per page, and lead candidates per answer. */
export const CRM_ACTIVITY_PAGE_SIZE = 50;
export const CRM_CANDIDATES_MAX = 20;
export const CRM_NOTE_MAX = 4000;

/** Field limits (the same as the database columns and CHECKs). */
export const CRM_COMPANY_LIMITS = {
  name: 200,
  registrationId: 40,
  city: 120,
  address: 500,
  website: 300,
  phone: 40,
  email: 254,
  description: 2000,
  internalNotes: 4000,
} as const;

const SINGLE_LINE = /^[^\p{Cc}\p{Cf}]*$/u;
const MULTI_LINE = /^(?:[^\p{Cc}\p{Cf}]|\n|\t)*$/u;

/** NFC, unified line breaks, trimmed. */
const clean = (v: string) => v.normalize("NFC").replace(/\r\n?/g, "\n").trim();

/** A required single-line text. */
const requiredLine = (max: number) =>
  z.string().transform(clean).pipe(z.string().min(1).max(max).regex(SINGLE_LINE));

/**
 * An optional text: `""`, white space only, `null` or a missing key are all "not set" (null), so a
 * form can send its empty fields as they are.
 */
function optional(inner: z.ZodType<string, string>) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v === undefined || v === null ? "" : clean(v)))
    .pipe(z.union([z.literal(""), inner]))
    .transform((v): string | null => (v === "" ? null : v));
}

/** The same rule as the "CrmCompany_website" CHECK: an absolute http(s) URL, no spaces. */
export const CrmWebsiteSchema = z
  .string()
  .max(CRM_COMPANY_LIMITS.website)
  .regex(/^https?:\/\/[^\s/?#@]+\.[^\s]+$/i);

/** The same rule as the "CrmCompany_phone" CHECK. */
export const CrmPhoneSchema = z
  .string()
  .max(CRM_COMPANY_LIMITS.phone)
  .regex(/^[+0-9(][0-9 ()./-]{2,39}$/);

/** The company's general e-mail (lower case; the "CrmCompany_email" CHECK needs a dot). */
export const CrmEmailSchema = EmailSchema.pipe(
  z
    .string()
    .max(CRM_COMPANY_LIMITS.email)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
);

/**
 * DP-339: a registration or VAT number (KvK, VAT, trade register). Spaces, dots, dashes and
 * slashes are dropped and letters upper-cased, so "nl 8512.34.567 B01" and "NL851234567B01" are
 * the same number (the "CrmCompany_registration_id" CHECK: 2–40 letters and digits).
 */
export const CrmRegistrationIdSchema = z
  .string()
  .max(80)
  .transform((v) => v.replace(/[\s./-]+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,40}$/));

/** The editable fields of a company (all of them: a save replaces every field). */
const CompanyFields = {
  name: requiredLine(CRM_COMPANY_LIMITS.name),
  registrationId: optional(CrmRegistrationIdSchema),
  country: z
    .union([CountryCodeSchema, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  city: optional(z.string().max(CRM_COMPANY_LIMITS.city).regex(SINGLE_LINE)),
  address: optional(z.string().max(CRM_COMPANY_LIMITS.address).regex(MULTI_LINE)),
  website: optional(CrmWebsiteSchema),
  phone: optional(CrmPhoneSchema),
  email: optional(CrmEmailSchema),
  description: optional(z.string().max(CRM_COMPANY_LIMITS.description).regex(MULTI_LINE)),
  internalNotes: optional(z.string().max(CRM_COMPANY_LIMITS.internalNotes).regex(MULTI_LINE)),
  /** The account owner (crm:manage on the company's site), or null for none. */
  ownerUserId: z
    .union([UuidSchema, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
};

/**
 * DP-339: the caller saw that another company of the site has this name and confirms this one is
 * a different legal entity (told apart by country, city or registration number).
 */
const ConfirmDistinct = { confirmDistinct: z.boolean().optional() };

export const CrmCompanyCreateInputSchema = z.strictObject({
  siteId: UuidSchema,
  ...CompanyFields,
  ...ConfirmDistinct,
});
export type CrmCompanyCreateInput = z.input<typeof CrmCompanyCreateInputSchema>;
export type CrmCompanyCreate = z.output<typeof CrmCompanyCreateInputSchema>;

/** `version` is the company's version as the caller saw it. */
export const CrmCompanyUpdateInputSchema = z.strictObject({
  version: z.number().int().min(0),
  ...CompanyFields,
  ...ConfirmDistinct,
});
export type CrmCompanyUpdateInput = z.input<typeof CrmCompanyUpdateInputSchema>;
export type CrmCompanyUpdate = z.output<typeof CrmCompanyUpdateInputSchema>;

/** The fields a company carries besides name (for the audit: names of changed fields only). */
export const CRM_COMPANY_FIELDS = [
  "name",
  "registrationId",
  "country",
  "city",
  "address",
  "website",
  "phone",
  "email",
  "description",
  "internalNotes",
  "ownerUserId",
] as const;
export type CrmCompanyField = (typeof CRM_COMPANY_FIELDS)[number];

export const CrmSiteSchema = z.strictObject({
  id: UuidSchema,
  key: z.enum(["BV", "CORPORATE"]),
  name: z.string(),
});
export type CrmSite = z.infer<typeof CrmSiteSchema>;

/** A staff user as the CRM shows them. */
export const CrmStaffSchema = z.strictObject({ id: UuidSchema, displayName: z.string() });
export type CrmStaff = z.infer<typeof CrmStaffSchema>;

/** A staff user who may own the companies of a site (crm:manage there). */
export const CrmOwnerCandidateSchema = z.strictObject({
  id: UuidSchema,
  displayName: z.string(),
  email: z.string(),
});
export type CrmOwnerCandidate = z.infer<typeof CrmOwnerCandidateSchema>;

export const CrmCompanyOwnerSchema = z.strictObject({
  id: UuidSchema,
  displayName: z.string(),
  /** Still holds crm:manage on the company's site. */
  active: z.boolean(),
});

export const CrmCompanySummarySchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  siteKey: z.enum(["BV", "CORPORATE"]),
  name: z.string(),
  registrationId: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  website: z.string().nullable(),
  owner: CrmCompanyOwnerSchema.nullable(),
  updatedAt: IsoDate,
});
export type CrmCompanySummary = z.infer<typeof CrmCompanySummarySchema>;

export const CrmCompanySchema = CrmCompanySummarySchema.extend({
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  description: z.string().nullable(),
  internalNotes: z.string().nullable(),
  version: z.number().int().min(0),
  createdAt: IsoDate,
  createdBy: CrmStaffSchema,
  updatedBy: CrmStaffSchema,
});
export type CrmCompany = z.infer<typeof CrmCompanySchema>;

/** List filter of the owner: me, none (no owner) or a staff user's id. */
export const CrmOwnerFilterSchema = z.union([z.literal("me"), z.literal("none"), UuidSchema]);

export const CrmCompanyListResponseSchema = z.strictObject({
  items: z.array(CrmCompanySummarySchema).max(CRM_COMPANIES_PAGE_SIZE),
  /** Opaque cursor of the next page, or null. */
  nextCursor: z.string().nullable(),
  /** Sites the caller reads companies of. */
  sites: z.array(CrmSiteSchema),
  /** Of those, the sites where the caller may create and change companies (crm:manage). */
  manageableSiteIds: z.array(UuidSchema),
});
export type CrmCompanyListResponse = z.infer<typeof CrmCompanyListResponseSchema>;

export const CrmCompanyDetailResponseSchema = z.strictObject({
  company: CrmCompanySchema,
  /** crm:manage on the company's site. */
  canManage: z.boolean(),
  /** Possible account owners (empty unless `canManage`). */
  owners: z.array(CrmOwnerCandidateSchema),
});
export type CrmCompanyDetailResponse = z.infer<typeof CrmCompanyDetailResponseSchema>;

/** Answer of a create or an update. */
export const CrmCompanyResponseSchema = z.strictObject({ company: CrmCompanySchema });
export type CrmCompanyResponse = z.infer<typeof CrmCompanyResponseSchema>;

/** Possible account owners per site where the caller may create companies. */
export const CrmOwnersResponseSchema = z.strictObject({
  sites: z.array(
    z.strictObject({
      site: CrmSiteSchema,
      owners: z.array(CrmOwnerCandidateSchema),
    }),
  ),
});
export type CrmOwnersResponse = z.infer<typeof CrmOwnersResponseSchema>;

// --- CRM-2: people, their leads and companies (ADR-032 D6) ---------------------------------------

/** A company as other CRM records name it. */
export const CrmCompanyRefSchema = z.strictObject({ id: UuidSchema, name: z.string() });
export type CrmCompanyRef = z.infer<typeof CrmCompanyRefSchema>;

/** One lead of a person (an anonymised lead keeps its place, without its identity). */
export const CrmPersonLeadSchema = z.strictObject({
  id: UuidSchema,
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  /** The company name the person typed into the form (free text). */
  company: z.string().nullable(),
  status: LeadStatusSchema,
  requestCount: z.number().int().min(0),
  lastRequestAt: IsoDate,
  anonymised: z.boolean(),
});
export type CrmPersonLead = z.infer<typeof CrmPersonLeadSchema>;

export const CrmPersonSchema = z.strictObject({
  id: UuidSchema,
  siteId: UuidSchema,
  /** The name of the person's most recent live lead (null when every lead is anonymised). */
  displayName: z.string().nullable(),
  company: CrmCompanyRefSchema.nullable(),
  /** Most recent first. */
  leads: z.array(CrmPersonLeadSchema),
  version: z.number().int().min(0),
  updatedAt: IsoDate,
});
export type CrmPerson = z.infer<typeof CrmPersonSchema>;

export const CrmCompanyPeopleResponseSchema = z.strictObject({
  people: z.array(CrmPersonSchema),
  /** crm:manage on the company's site. */
  canManage: z.boolean(),
});
export type CrmCompanyPeopleResponse = z.infer<typeof CrmCompanyPeopleResponseSchema>;

/** Why a lead is suggested for a company: the typed company name or the e-mail domain matches. */
export const CRM_SUGGESTION_REASONS = ["company_name", "email_domain"] as const;

/** A live lead of the same site that may be linked (to a company, or as the same person). */
export const CrmLeadCandidateSchema = z.strictObject({
  id: UuidSchema,
  fullName: z.string(),
  email: z.string(),
  company: z.string().nullable(),
  lastRequestAt: IsoDate,
  reason: z.enum(CRM_SUGGESTION_REASONS).nullable(),
  /** The person the lead already belongs to, and that person's company. */
  person: z.strictObject({ id: UuidSchema, company: CrmCompanyRefSchema.nullable() }).nullable(),
});
export type CrmLeadCandidate = z.infer<typeof CrmLeadCandidateSchema>;

export const CrmLeadCandidatesResponseSchema = z.strictObject({
  items: z.array(CrmLeadCandidateSchema).max(CRM_CANDIDATES_MAX),
});
export type CrmLeadCandidatesResponse = z.infer<typeof CrmLeadCandidatesResponseSchema>;

/** Add a lead (and the person it belongs to) to a company. */
export const CrmAddPersonInputSchema = z.strictObject({
  leadId: UuidSchema,
  /** The lead's person works for another company: move it (otherwise 409 `other_company`). */
  confirmMove: z.boolean().optional(),
});
export type CrmAddPersonInput = z.input<typeof CrmAddPersonInputSchema>;

/** Move a person to another company of the site, or remove it from its company (null). */
export const CrmPersonCompanyInputSchema = z.strictObject({
  companyId: UuidSchema.nullable(),
  version: z.number().int().min(0),
});
export type CrmPersonCompanyInput = z.input<typeof CrmPersonCompanyInputSchema>;

/**
 * The same person as another lead of the site (`samePersonAsLeadId`), or a person of its own
 * again (null: the link is removed).
 */
export const CrmLeadPersonInputSchema = z.strictObject({
  samePersonAsLeadId: UuidSchema.nullable(),
});
export type CrmLeadPersonInput = z.input<typeof CrmLeadPersonInputSchema>;

export const CrmPersonResponseSchema = z.strictObject({ person: CrmPersonSchema.nullable() });
export type CrmPersonResponse = z.infer<typeof CrmPersonResponseSchema>;

/** The CRM side of a lead: its person (with the other leads and the company), if any. */
export const CrmLeadResponseSchema = z.strictObject({
  person: CrmPersonSchema.nullable(),
  /** crm:manage on the lead's site. */
  canManage: z.boolean(),
  /** The lead is anonymised: it is never linked again. */
  anonymised: z.boolean(),
});
export type CrmLeadResponse = z.infer<typeof CrmLeadResponseSchema>;

// --- CRM-2: history (ADR-032 D7) ---------------------------------------------------------------

export const CRM_ACTIVITY_KINDS = [
  "NOTE",
  "COMPANY_CREATED",
  "COMPANY_OWNER_CHANGED",
  "PERSON_COMPANY_CHANGED",
  "LEAD_PERSON_CHANGED",
] as const;
export type CrmActivityKind = (typeof CRM_ACTIVITY_KINDS)[number];

const PersonRef = z.strictObject({ id: UuidSchema, displayName: z.string().nullable() });

export const CrmActivitySchema = z.strictObject({
  id: UuidSchema,
  kind: z.enum(CRM_ACTIVITY_KINDS),
  createdAt: IsoDate,
  actor: CrmStaffSchema,
  body: z.string().nullable(),
  person: PersonRef.nullable(),
  /** The lead whose person changed (LEAD_PERSON_CHANGED); its label is null when anonymised. */
  lead: z.strictObject({ id: UuidSchema, label: z.string().nullable() }).nullable(),
  fromCompany: CrmCompanyRefSchema.nullable(),
  toCompany: CrmCompanyRefSchema.nullable(),
  /** LEAD_PERSON_CHANGED: the person the lead left and joined (null: none). */
  fromPerson: PersonRef.nullable(),
  toPerson: PersonRef.nullable(),
  fromOwner: CrmStaffSchema.nullable(),
  toOwner: CrmStaffSchema.nullable(),
});
export type CrmActivity = z.infer<typeof CrmActivitySchema>;

export const CrmActivityListResponseSchema = z.strictObject({
  items: z.array(CrmActivitySchema).max(CRM_ACTIVITY_PAGE_SIZE),
  nextCursor: z.string().nullable(),
});
export type CrmActivityListResponse = z.infer<typeof CrmActivityListResponseSchema>;

/** A staff note on a company. */
export const CrmNoteInputSchema = z.strictObject({
  body: z.string().transform(clean).pipe(z.string().min(1).max(CRM_NOTE_MAX).regex(MULTI_LINE)),
});
export type CrmNoteInput = z.input<typeof CrmNoteInputSchema>;
