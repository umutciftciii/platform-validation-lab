// CRM-1 (ADR-032): the CRM company screens — list, new company, a company — rendered on the
// server in English and Turkish with the same fixtures, the browser client of the saves, the view
// helpers and the static rules of the console (no hard-coded UI text in the CRM area). The API
// and the database decide every access; these tests check what the console shows and sends.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_CRM_COMPANIES_API,
  ADMIN_CRM_OWNERS_API,
  type CrmCompany,
  type CrmCompanyDetailResponse,
  type CrmCompanyListResponse,
  type CrmOwnersResponse,
} from "@dream/contracts";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";
import { listFiles, scanFiles } from "./support/ui-literals";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = new Map<string, unknown>();
const FORBIDDEN = Symbol("forbidden");
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dp-admin-locale" ? { value: ui.locale } : undefined),
    has: () => false,
  }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (p: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(p)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(p);
    if (v === FORBIDDEN) return { ok: false, status: 403, code: "FORBIDDEN" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({
  requireStaffSession: async () => ({ user: { id: VIEWER } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const VIEWER = "0190f3a0-0000-7000-8000-000000009100";
const OTHER = "0190f3a0-0000-7000-8000-000000009200";
const BV = {
  id: "0190f3a0-0000-7000-8000-000000000001",
  key: "BV" as const,
  name: "Dream Petroleum BV",
};
const COM = {
  id: "0190f3a0-0000-7000-8000-000000000002",
  key: "CORPORATE" as const,
  name: "Dream Petroleum",
};
const ACME = "0190f3a0-0000-7000-8000-00000000a001";
const AT = "2026-11-24T09:15:00.000Z";

const company = (over: Partial<CrmCompany> = {}): CrmCompany => ({
  id: ACME,
  siteId: BV.id,
  siteKey: "BV",
  name: "Acme Lubricants B.V.",
  country: "NL",
  city: "Rotterdam",
  website: "https://acme.example",
  owner: { id: VIEWER, displayName: "Sanne Visser", active: true },
  updatedAt: AT,
  address: "Haven 1\n3011 Rotterdam",
  phone: "+31 10 123 4567",
  email: "info@acme.example",
  description: "Blender of marine lubricants.",
  internalNotes: "Prefers quarterly calls.",
  version: 3,
  createdAt: AT,
  createdBy: { id: VIEWER, displayName: "Sanne Visser" },
  updatedBy: { id: OTHER, displayName: "Jan de Vries" },
  ...over,
});

const LIST: CrmCompanyListResponse = {
  items: [
    company(),
    {
      ...company(),
      id: "0190f3a0-0000-7000-8000-00000000a002",
      siteId: COM.id,
      siteKey: "CORPORATE" as const,
      name: "Baltic Oils",
      country: null,
      city: null,
      website: null,
      owner: null,
    },
  ].map(({ id, siteId, siteKey, name, country, city, website, owner, updatedAt }) => ({
    id,
    siteId,
    siteKey,
    name,
    country,
    city,
    website,
    owner,
    updatedAt,
  })),
  nextCursor: null,
  sites: [BV, COM],
  manageableSiteIds: [BV.id],
};

const OWNERS: CrmOwnersResponse = {
  sites: [
    { site: BV, owners: [{ id: VIEWER, displayName: "Sanne Visser", email: "sanne@dp.test" }] },
    { site: COM, owners: [{ id: OTHER, displayName: "Jan de Vries", email: "jan@dp.test" }] },
  ],
};

const DETAIL = (over: Partial<CrmCompanyDetailResponse> = {}): CrmCompanyDetailResponse => ({
  company: company(),
  canManage: true,
  owners: OWNERS.sites[0]!.owners,
  ...over,
});

const listPage = await import("../app/(console)/crm/companies/page");
const newPage = await import("../app/(console)/crm/companies/new/page");
const companyPage = await import("../app/(console)/crm/companies/[id]/page");
const crmRoot = await import("../app/(console)/crm/page");
const view = await import("../lib/crm-view");
const client = await import("../lib/crm-client");

beforeAll(() => {
  process.env["TZ"] = "UTC";
});
beforeEach(() => reads.clear());
afterEach(() => vi.unstubAllGlobals());

type Render = () => Promise<ReactElement> | ReactElement;
async function render(make: Render, locale: AdminLocale): Promise<string> {
  ui.locale = locale;
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{await make()}</LocaleProvider>);
}

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");

/** Visible texts: text nodes and the attributes people read or hear. */
function texts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of html.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

/** Names, data and terms that are the same in English and Turkish on purpose. */
const FIXED = new Set(["Site", "CRM", "BV", "Corporate", "Dream Petroleum BV", "Dream Petroleum"]);
function isData(text: string): boolean {
  const data: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") data.push(v.replace(/\s+/g, " "));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([LIST, OWNERS, DETAIL()]);
  // Country names that Intl writes the same in both languages (e.g. "Malta").
  const trNames = new Set(view.countryOptions("tr").map((c) => c.name));
  const same = (p: string) =>
    FIXED.has(p) || trNames.has(p) || data.some((d) => d === p || (p.length > 3 && d.includes(p)));
  return same(text) || text.split(/\s*·\s*/).every(same);
}

const page = {
  list:
    (q: Record<string, string> = {}) =>
    () =>
      listPage.default({ searchParams: Promise.resolve(q) } as never),
  detail: () => () => companyPage.default({ params: Promise.resolve({ id: ACME }) } as never),
  create: () => () => newPage.default(),
};

describe("CRM-1 company list", () => {
  it("shows companies with place, owner and site, and the create button for managers", async () => {
    reads.set(ADMIN_CRM_COMPANIES_API, LIST);
    const html = await render(page.list(), "en");
    expect(html).toContain("Acme Lubricants B.V.");
    expect(html).toContain("Rotterdam · Netherlands");
    expect(html).toContain("Sanne Visser");
    expect(html).toContain("No account owner");
    expect(html).toContain('href="/crm/companies/new"');
    expect(html).toContain(`href="/crm/companies/${ACME}"`);
    expect(html).toContain("2 shown");
    const tr = await render(page.list(), "tr");
    expect(tr).toContain("Yeni firma");
    expect(tr).toContain("Müşteri sorumlusu yok");
    expect(tr).toContain("Rotterdam · Hollanda");
  });

  it("sends the filters to the API and hides the button without crm:manage", async () => {
    const q = { q: "acme", site: BV.id, owner: "me", country: "nl" };
    reads.set(`${ADMIN_CRM_COMPANIES_API}?siteId=${BV.id}&q=acme&owner=me&country=NL`, {
      ...LIST,
      items: LIST.items.slice(0, 1),
      manageableSiteIds: [],
    });
    const html = await render(page.list(q), "en");
    expect(html).toContain("Acme Lubricants B.V.");
    expect(html).not.toContain('href="/crm/companies/new"');
    expect(html).toContain("Clear filters");
  });

  it("explains a refusal and an empty list", async () => {
    reads.set(ADMIN_CRM_COMPANIES_API, FORBIDDEN);
    expect(await render(page.list(), "en")).toContain("No access to the CRM");
    expect(await render(page.list(), "tr")).toContain("CRM&#x27;e erişiminiz yok");
    reads.set(ADMIN_CRM_COMPANIES_API, { ...LIST, items: [] });
    expect(await render(page.list(), "en")).toContain("No companies yet");
  });

  it("starts the CRM at the companies", () => {
    expect(() => crmRoot.default()).toThrow("NEXT_REDIRECT /crm/companies");
  });
});

describe("CRM-1 a company", () => {
  it("shows profile, contact details, notes and the editor for managers", async () => {
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL());
    const html = await render(page.detail(), "en");
    for (const text of [
      "Company profile",
      "Contact details",
      "Haven 1\n3011 Rotterdam",
      "+31 10 123 4567",
      "info@acme.example",
      "Prefers quarterly calls.",
      "Edit company",
      "Save changes",
      "Version 3",
      "Jan de Vries",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('href="https://acme.example"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("is read-only without crm:manage and marks an owner who lost access", async () => {
    reads.set(
      `${ADMIN_CRM_COMPANIES_API}/${ACME}`,
      DETAIL({
        canManage: false,
        owners: [],
        company: company({ owner: { id: OTHER, displayName: "Jan de Vries", active: false } }),
      }),
    );
    const html = await render(page.detail(), "en");
    expect(html).not.toContain("Save changes");
    expect(html).toContain("You can view this company.");
    expect(html).toContain("(no longer has access)");
    const tr = await render(page.detail(), "tr");
    expect(tr).toContain("(artık erişimi yok)");
  });

  it("answers an unknown company with its own state", async () => {
    expect(await render(page.detail(), "en")).toContain("Company not found");
  });
});

describe("CRM-1 new company", () => {
  it("offers the manageable sites and their owners", async () => {
    reads.set(ADMIN_CRM_OWNERS_API, OWNERS);
    const html = await render(page.create(), "en");
    expect(html).toContain("Create company");
    expect(html).toContain(`<option value="${BV.id}" selected="">Dream Petroleum BV</option>`);
    // The creator owns the new company by default when allowed to.
    expect(html).toContain(`<option value="${VIEWER}" selected="">Sanne Visser</option>`);
    expect(html).not.toContain("Jan de Vries");
  });

  it("explains when no site can be managed", async () => {
    reads.set(ADMIN_CRM_OWNERS_API, FORBIDDEN);
    expect(await render(page.create(), "en")).toContain("You cannot create companies");
  });
});

describe("CRM-1 Turkish", () => {
  it("leaves no English UI text on any screen", async () => {
    reads.set(ADMIN_CRM_COMPANIES_API, LIST);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL());
    reads.set(ADMIN_CRM_OWNERS_API, OWNERS);
    for (const make of [page.list(), page.detail(), page.create()]) {
      const en = new Set(texts(await render(make, "en")));
      const tr = texts(await render(make, "tr"));
      const left = [...new Set(tr)].filter((t) => en.has(t) && !isData(t));
      expect(left).toEqual([]);
    }
  });
});

describe("CRM-1 browser client and view helpers", () => {
  it("posts creates and updates to the API with the fields as typed", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ company: company() }), { status: 200 });
    });
    await client.createCompany({ siteId: BV.id, name: "Acme" });
    await client.updateCompany(ACME, { version: 3, name: "Acme" });
    expect(calls).toEqual([
      { url: ADMIN_CRM_COMPANIES_API, body: { siteId: BV.id, name: "Acme" } },
      { url: `${ADMIN_CRM_COMPANIES_API}/${ACME}`, body: { version: 3, name: "Acme" } },
    ]);
  });

  it("maps the API's refusals to CRM messages and names the field", () => {
    const t = createTranslator("en");
    const err = (code: string, details: { path: string; rule: string }[]) => ({
      error: { code, message: "x", requestId: "r", details },
    });
    expect(
      client.crmErrorMessage(err("CONFLICT_STATE", [{ path: "name", rule: "duplicate_name" }]), t),
    ).toEqual({ message: "Another company of this site already has this name.", field: "name" });
    expect(
      client.crmErrorMessage(err("CONFLICT_STATE", [{ path: "version", rule: "stale" }]), t)
        .message,
    ).toMatch(/Someone else changed this company/);
    expect(
      client.crmErrorMessage(err("VALIDATION_FAILED", [{ path: "website", rule: "invalid" }]), t),
    ).toEqual({ message: "Check this field: Website.", field: "website" });
    expect(
      client.crmErrorMessage(
        err("VALIDATION_FAILED", [{ path: "ownerUserId", rule: "owner_not_eligible" }]),
        createTranslator("tr"),
      ),
    ).toEqual({ message: "Bu kişi bu sitenin firmalarına sorumlu olamaz.", field: "ownerUserId" });
    expect(client.crmErrorMessage(null, t).message).toBe("The company could not be saved.");
  });

  it("builds list queries and addresses", () => {
    const f = view.readCrmFilters({ q: " acme ", site: BV.id, owner: "none", country: "de" });
    expect(view.crmListQuery(f)).toBe(`?siteId=${BV.id}&q=acme&owner=none&country=DE`);
    expect(view.crmListHref({ site: BV.id })).toBe(`/crm/companies?site=${BV.id}`);
    expect(view.crmListHref({})).toBe("/crm/companies");
    expect(view.hasCrmFilters(view.readCrmFilters({ site: BV.id }))).toBe(false);
    expect(view.companyPlace({ city: null, country: "DE" }, "tr")).toBe("Almanya");
  });
});

describe("CRM-1 static rules", () => {
  it("has no hard-coded UI text in the CRM area", () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const files = listFiles(ROOT, [
      "app/(console)/crm",
      "components/crm",
      "lib/crm-view.ts",
      "lib/crm-client.ts",
    ]);
    expect(files.length).toBe(7);
    expect(scanFiles(ROOT, files)).toEqual([]);
  });
});
