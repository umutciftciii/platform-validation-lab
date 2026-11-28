/**
 * CRM companies from the browser (CRM-1, ADR-032), through the admin's same-origin proxy. The API
 * decides every change (crm:manage on the company's site, unique names, account owner); the
 * database checks the same again. Refusals map to the CRM messages (`crm.errors.*`).
 */
import {
  ADMIN_CRM_COMPANIES_API,
  CRM_COMPANY_FIELDS,
  ErrorBodySchema,
  type CrmCompanyCreateInput,
  type CrmCompanyField,
  type CrmCompanyResponse,
  type CrmCompanyUpdateInput,
} from "@dream/contracts";
import { fieldLabel } from "./crm-view";
import type { Translate } from "./i18n/types";
import { browserT, codeMessage } from "./staff-client";

export type CrmCall<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; field: CrmCompanyField | "siteId" | null };

/** API rules with their own message. */
const RULES = ["duplicate_name", "owner_not_eligible", "stale", "unchanged", "db_guard"] as const;
type CrmRule = (typeof RULES)[number];
const isRule = (r: string): r is CrmRule => (RULES as readonly string[]).includes(r);
const FIELDS: readonly string[] = [...CRM_COMPANY_FIELDS, "siteId"];

/** The message of a refused save, from the error envelope. */
export function crmErrorMessage(
  json: unknown,
  t: Translate,
): { message: string; field: CrmCompanyField | "siteId" | null } {
  const parsed = ErrorBodySchema.safeParse(json);
  if (!parsed.success) return { message: t("crm.errors.saveFailed"), field: null };
  const { code, details } = parsed.data.error;
  const detail = details.find(
    (d): d is { path: string; rule: string } =>
      typeof d === "object" && d !== null && "path" in d && "rule" in d,
  );
  const path = detail ? (String(detail.path).split(".")[0] ?? "") : "";
  const field = FIELDS.includes(path) ? (path as CrmCompanyField | "siteId") : null;
  if (detail && isRule(String(detail.rule))) {
    return { message: t(`crm.errors.${detail.rule as CrmRule}`), field };
  }
  if (code === "VALIDATION_FAILED" && field) {
    return { message: t("crm.errors.invalidField", { field: fieldLabel(field, t) }), field };
  }
  return { message: codeMessage(code, t("crm.errors.saveFailed"), t), field: null };
}

async function post<T>(url: string, body: unknown): Promise<CrmCall<T>> {
  const t = browserT();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: t("staff.api.unreachable"), field: null };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, ...crmErrorMessage(json, t) };
}

export const createCompany = (body: CrmCompanyCreateInput) =>
  post<CrmCompanyResponse>(ADMIN_CRM_COMPANIES_API, body);

export const updateCompany = (companyId: string, body: CrmCompanyUpdateInput) =>
  post<CrmCompanyResponse>(`${ADMIN_CRM_COMPANIES_API}/${encodeURIComponent(companyId)}`, body);
