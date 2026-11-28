/**
 * CRM 360° companies (CRM-1, ADR-032). Shared by the API and the admin console.
 *
 * - A company (organisation) belongs to one site, like its leads. It holds legal-entity data:
 *   name, location, the company's general phone and e-mail, a description and staff notes, and
 *   its account owner. People stay on the lead records (CRM-2 links them to companies).
 * - Customer data by access: read with `crm:read` on the company's site, created and changed with
 *   `crm:manage` there (sales_crm_user, platform super admin, system owner). The database checks
 *   the same again (row-level security, guard trigger) and stamps creator, editor and version.
 * - Names are unique per site after normalisation (trim, single spaces, lower case): a second
 *   "ACME  b.v." next to "Acme B.V." is refused (409, rule `duplicate_name`).
 * - Changes use optimistic concurrency (`version`; stale: 409, rule `stale`). Companies are never
 *   deleted through the API.
 */
import { z } from "zod";
import { EmailSchema, UuidSchema } from "../auth/common.js";
import { CountryCodeSchema } from "../leads.js";

const IsoDate = z.iso.datetime({ offset: true });

export const ADMIN_CRM_API = "/api/v1/admin/crm";
export const ADMIN_CRM_COMPANIES_API = `${ADMIN_CRM_API}/companies`;
/** Staff who may own the companies of the sites the caller manages (`crm:manage`). */
export const ADMIN_CRM_OWNERS_API = `${ADMIN_CRM_API}/owners`;

export const CRM_COMPANIES_PAGE_SIZE = 50;
export const CRM_COMPANY_SEARCH_MAX = 100;

/** Field limits (the same as the database columns and CHECKs). */
export const CRM_COMPANY_LIMITS = {
  name: 200,
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

/** The editable fields of a company (all of them: a save replaces every field). */
const CompanyFields = {
  name: requiredLine(CRM_COMPANY_LIMITS.name),
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

export const CrmCompanyCreateInputSchema = z.strictObject({
  siteId: UuidSchema,
  ...CompanyFields,
});
export type CrmCompanyCreateInput = z.input<typeof CrmCompanyCreateInputSchema>;
export type CrmCompanyCreate = z.output<typeof CrmCompanyCreateInputSchema>;

/** `version` is the company's version as the caller saw it. */
export const CrmCompanyUpdateInputSchema = z.strictObject({
  version: z.number().int().min(0),
  ...CompanyFields,
});
export type CrmCompanyUpdateInput = z.input<typeof CrmCompanyUpdateInputSchema>;
export type CrmCompanyUpdate = z.output<typeof CrmCompanyUpdateInputSchema>;

/** The fields a company carries besides name (for the audit: names of changed fields only). */
export const CRM_COMPANY_FIELDS = [
  "name",
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
