/**
 * CRM companies from the browser (CRM-1, ADR-032), through the admin's same-origin proxy. The API
 * decides every change (crm:manage on the company's site, unique names, account owner); the
 * database checks the same again. Refusals map to the CRM messages (`crm.errors.*`).
 *
 * CRM-2 (ADR-032 D6/D7): people of a company, the CRM side of a lead and company notes; lead and
 * company searches for the pickers (GET, never cached).
 */
import {
  ADMIN_CRM_COMPANIES_API,
  ADMIN_CRM_LEADS_API,
  ADMIN_CRM_PEOPLE_API,
  CRM_COMPANY_FIELDS,
  ErrorBodySchema,
  type CrmAddPersonInput,
  type CrmCompanyCreateInput,
  type CrmCompanyField,
  type CrmCompanyListResponse,
  type CrmCompanyResponse,
  type CrmCompanyUpdateInput,
  type CrmLeadCandidatesResponse,
  type CrmLeadPersonInput,
  type CrmLeadResponse,
  type CrmPersonCompanyInput,
  type CrmPersonResponse,
} from "@dream/contracts";
import { fieldLabel } from "./crm-view";
import type { Translate } from "./i18n/types";
import { browserT, codeMessage } from "./staff-client";

/** API rules with their own message. */
const RULES = [
  "possible_duplicate",
  "duplicate_identity",
  "duplicate_registration",
  "owner_not_eligible",
  "stale",
  "unchanged",
  "db_guard",
  "already_linked",
  "other_company",
  "lead_anonymised",
] as const;
export type CrmRule = (typeof RULES)[number];
const isRule = (r: string): r is CrmRule => (RULES as readonly string[]).includes(r);
const FIELDS: readonly string[] = [...CRM_COMPANY_FIELDS, "siteId"];

export type CrmCall<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      message: string;
      field: CrmCompanyField | "siteId" | null;
      /** The API's rule, when it has its own message (e.g. `possible_duplicate`). */
      rule: CrmRule | null;
    };

type Fallback = "saveFailed" | "linkFailed";

/** The message of a refused save, from the error envelope. */
export function crmErrorMessage(
  json: unknown,
  t: Translate,
  fallback: Fallback = "saveFailed",
): { message: string; field: CrmCompanyField | "siteId" | null; rule: CrmRule | null } {
  const parsed = ErrorBodySchema.safeParse(json);
  if (!parsed.success) return { message: t(`crm.errors.${fallback}`), field: null, rule: null };
  const { code, details } = parsed.data.error;
  const detail = details.find(
    (d): d is { path: string; rule: string } =>
      typeof d === "object" && d !== null && "path" in d && "rule" in d,
  );
  const path = detail ? (String(detail.path).split(".")[0] ?? "") : "";
  const field = FIELDS.includes(path) ? (path as CrmCompanyField | "siteId") : null;
  if (detail && isRule(String(detail.rule))) {
    const rule = detail.rule as CrmRule;
    return { message: t(`crm.errors.${rule}`), field, rule };
  }
  if (code === "VALIDATION_FAILED" && field) {
    return {
      message: t("crm.errors.invalidField", { field: fieldLabel(field, t) }),
      field,
      rule: null,
    };
  }
  return { message: codeMessage(code, t(`crm.errors.${fallback}`), t), field: null, rule: null };
}

async function call<T>(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  fallback: Fallback = "saveFailed",
): Promise<CrmCall<T>> {
  const t = browserT();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers:
        method === "POST"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: t("staff.api.unreachable"), field: null, rule: null };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, ...crmErrorMessage(json, t, fallback) };
}

const enc = encodeURIComponent;

export const createCompany = (body: CrmCompanyCreateInput) =>
  call<CrmCompanyResponse>("POST", ADMIN_CRM_COMPANIES_API, body);

export const updateCompany = (companyId: string, body: CrmCompanyUpdateInput) =>
  call<CrmCompanyResponse>("POST", `${ADMIN_CRM_COMPANIES_API}/${enc(companyId)}`, body);

// --- CRM-2 ---------------------------------------------------------------------------------------

/** Companies of one site whose name (or city, website, registration number) matches. */
export const searchCompanies = (siteId: string, q: string) =>
  call<CrmCompanyListResponse>(
    "GET",
    `${ADMIN_CRM_COMPANIES_API}?${new URLSearchParams({ siteId, q }).toString()}`,
  );

/** Leads that may join a company: suggestions (no `q`) or a search. */
export const companyCandidates = (companyId: string, q: string) =>
  call<CrmLeadCandidatesResponse>(
    "GET",
    `${ADMIN_CRM_COMPANIES_API}/${enc(companyId)}/candidates${
      q ? `?${new URLSearchParams({ q }).toString()}` : ""
    }`,
  );

export const addPersonToCompany = (companyId: string, body: CrmAddPersonInput) =>
  call<CrmPersonResponse>(
    "POST",
    `${ADMIN_CRM_COMPANIES_API}/${enc(companyId)}/people`,
    body,
    "linkFailed",
  );

export const setPersonCompany = (personId: string, body: CrmPersonCompanyInput) =>
  call<CrmPersonResponse>(
    "POST",
    `${ADMIN_CRM_PEOPLE_API}/${enc(personId)}/company`,
    body,
    "linkFailed",
  );

/** Other leads of the site that may be the same person as this one (search only). */
export const leadCandidates = (leadId: string, q: string) =>
  call<CrmLeadCandidatesResponse>(
    "GET",
    `${ADMIN_CRM_LEADS_API}/${enc(leadId)}/candidates?${new URLSearchParams({ q }).toString()}`,
  );

export const setLeadPerson = (leadId: string, body: CrmLeadPersonInput) =>
  call<CrmLeadResponse>("POST", `${ADMIN_CRM_LEADS_API}/${enc(leadId)}/person`, body, "linkFailed");

export const addCompanyNote = (companyId: string, body: string) =>
  call<{ ok: true }>(
    "POST",
    `${ADMIN_CRM_COMPANIES_API}/${enc(companyId)}/notes`,
    { body },
    "linkFailed",
  );
