/**
 * CRM view helpers (CRM-1, ADR-032): the list query the console sends to the API, filter state
 * from the address bar and the labels the screens show. Plain module (server and client).
 * Companies are customer data; the API decides who may read them (crm:read on the site).
 */
import {
  COUNTRY_CODES,
  LEAD_STATUSES,
  type CrmCompanyField,
  type CrmCompanySummary,
} from "@dream/contracts";
import type { AdminLocale } from "./i18n/config";
import type { Translate } from "./i18n/types";
import { countryName } from "./leads-view";

export interface CrmListFilters {
  q: string;
  site: string;
  owner: string;
  country: string;
  cursor: string;
}

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function readCrmFilters(
  params: Record<string, string | string[] | undefined>,
): CrmListFilters {
  return {
    q: one(params["q"]).slice(0, 100),
    site: one(params["site"]),
    owner: one(params["owner"]),
    country: one(params["country"]).toUpperCase(),
    cursor: one(params["cursor"]),
  };
}

export function hasCrmFilters(f: CrmListFilters): boolean {
  return Boolean(f.q || f.owner || f.country);
}

/** The API query of the company list. */
export function crmListQuery(f: CrmListFilters): string {
  const p = new URLSearchParams();
  if (f.site) p.set("siteId", f.site);
  if (f.q) p.set("q", f.q);
  if (f.owner) p.set("owner", f.owner);
  if (f.country) p.set("country", f.country);
  if (f.cursor) p.set("cursor", f.cursor);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The console address of the company list with these filters. */
export function crmListHref(f: Partial<CrmListFilters>): string {
  const p = new URLSearchParams();
  for (const key of ["q", "site", "owner", "country", "cursor"] as const) {
    const v = f[key];
    if (v) p.set(key, v);
  }
  const s = p.toString();
  return s ? `/crm/companies?${s}` : "/crm/companies";
}

/** Countries sorted by their name in the UI language (for the country pickers). */
export function countryOptions(locale: AdminLocale): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

/** "Rotterdam · Netherlands", or the one that is set, or "". */
export function companyPlace(
  c: Pick<CrmCompanySummary, "city" | "country">,
  locale: AdminLocale,
): string {
  return [c.city, c.country ? countryName(c.country, locale) : null].filter(Boolean).join(" · ");
}

/** The label of a company field (form and API errors). */
export function fieldLabel(field: CrmCompanyField | "siteId", t: Translate): string {
  switch (field) {
    case "siteId":
      return t("crm.form.site");
    case "ownerUserId":
      return t("crm.form.owner");
    default:
      return t(`crm.form.${field}`);
  }
}

// --- CRM-3: the people list (ADR-032 D11) ------------------------------------------------------

export interface PeopleListFilters {
  q: string;
  site: string;
  /** "any" (with a company), "none" (without one) or a company id. */
  company: string;
  /** "me" or "none": the account owner of the person's company. */
  owner: string;
  /** A lead status: at least one lead of the person has it. */
  status: string;
  cursor: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

/** Filters from the address bar; a value the API would refuse is dropped (no error page). */
export function readPeopleFilters(
  params: Record<string, string | string[] | undefined>,
): PeopleListFilters {
  const site = one(params["site"]);
  const company = one(params["company"]).toLowerCase();
  const owner = one(params["owner"]).toLowerCase();
  const status = one(params["status"]).toUpperCase();
  const cursor = one(params["cursor"]);
  return {
    q: one(params["q"]).slice(0, 100),
    site: UUID.test(site) ? site : "",
    company: company === "any" || company === "none" || UUID.test(company) ? company : "",
    owner: owner === "me" || owner === "none" ? owner : "",
    status: (LEAD_STATUSES as readonly string[]).includes(status) ? status : "",
    cursor: CURSOR.test(cursor) ? cursor : "",
  };
}

export function hasPeopleFilters(f: PeopleListFilters): boolean {
  return Boolean(f.q || f.company || f.owner || f.status);
}

const PEOPLE_KEYS = ["q", "site", "company", "owner", "status", "cursor"] as const;

/** The API query of the people list. */
export function peopleListQuery(f: PeopleListFilters): string {
  const p = new URLSearchParams();
  for (const key of PEOPLE_KEYS) {
    const v = f[key];
    if (v) p.set(key === "site" ? "siteId" : key, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The console address of the people list with these filters. */
export function peopleListHref(f: Partial<PeopleListFilters>): string {
  const p = new URLSearchParams();
  for (const key of PEOPLE_KEYS) {
    const v = f[key];
    if (v) p.set(key, v);
  }
  const s = p.toString();
  return s ? `/crm/people?${s}` : "/crm/people";
}
