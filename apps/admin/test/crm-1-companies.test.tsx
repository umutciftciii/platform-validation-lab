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
  ADMIN_CRM_LEADS_API,
  ADMIN_CRM_OWNERS_API,
  ADMIN_CRM_OVERVIEW_API,
  ADMIN_CRM_PEOPLE_API,
  type CrmActivityListResponse,
  type CrmCompanyLeadsResponse,
  type CrmContactHistoryResponse,
  type CrmOverviewResponse,
  type CrmPeopleListResponse,
  type CrmPersonProfileResponse,
  type CrmCompanyPeopleResponse,
  type CrmCompany,
  type CrmCompanyDetailResponse,
  type CrmCompanyListResponse,
  type CrmOwnersResponse,
} from "@dream/contracts";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";
import { listFiles, scanFiles } from "./support/ui-literals";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale, pathname: "/crm" }));
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
  usePathname: () => ui.pathname,
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
  registrationId: "NL851234567B01",
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
      registrationId: null,
      country: null,
      city: null,
      website: null,
      owner: null,
    },
  ].map(
    (
      { id, siteId, siteKey, name, registrationId, country, city, website, owner, updatedAt },
      i,
    ) => ({
      id,
      siteId,
      siteKey,
      name,
      registrationId,
      country,
      city,
      website,
      owner,
      updatedAt,
      // CRM-3: people (null without lead:read on the site) and the last CRM activity.
      peopleCount: i === 0 ? 3 : null,
      lastActivityAt: i === 0 ? AT : null,
    }),
  ),
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

// --- CRM-2 fixtures -----------------------------------------------------------------------------
const PERSON = "0190f3a0-0000-7000-8000-00000000b001";
const LEAD_A = "0190f3a0-0000-7000-8000-00000000c001";
const LEAD_B = "0190f3a0-0000-7000-8000-00000000c002";
const PEOPLE: CrmCompanyPeopleResponse = {
  people: [
    {
      id: PERSON,
      siteId: BV.id,
      displayName: "Ann Jansen",
      company: { id: ACME, name: "Acme Lubricants B.V." },
      leads: [
        {
          id: LEAD_A,
          fullName: "Ann Jansen",
          email: "ann@acme.example",
          company: "Acme",
          status: "CONTACTED",
          requestCount: 2,
          lastRequestAt: AT,
          anonymised: false,
        },
        {
          id: LEAD_B,
          fullName: null,
          email: null,
          company: null,
          status: "NEW",
          requestCount: 1,
          lastRequestAt: AT,
          anonymised: true,
        },
      ],
      version: 1,
      updatedAt: AT,
    },
  ],
  canManage: true,
};
const staffRef = (id: string, displayName: string) => ({ id, displayName });
const HISTORY: CrmActivityListResponse = {
  items: [
    {
      id: "0190f3a0-0000-7000-8000-00000000d001",
      kind: "NOTE",
      createdAt: AT,
      actor: staffRef(VIEWER, "Sanne Visser"),
      body: "Visited the plant.\nFollow up in Q1.",
      person: null,
      lead: null,
      fromCompany: null,
      toCompany: null,
      fromPerson: null,
      toPerson: null,
      fromOwner: null,
      toOwner: null,
    },
    {
      id: "0190f3a0-0000-7000-8000-00000000d002",
      kind: "LEAD_PERSON_CHANGED",
      createdAt: AT,
      actor: staffRef(VIEWER, "Sanne Visser"),
      body: null,
      person: { id: PERSON, displayName: "Ann Jansen" },
      lead: { id: LEAD_A, label: "Ann Jansen <ann@acme.example>" },
      fromCompany: null,
      toCompany: null,
      fromPerson: null,
      toPerson: { id: PERSON, displayName: "Ann Jansen" },
      fromOwner: null,
      toOwner: null,
    },
    {
      id: "0190f3a0-0000-7000-8000-00000000d003",
      kind: "PERSON_COMPANY_CHANGED",
      createdAt: AT,
      actor: staffRef(OTHER, "Jan de Vries"),
      body: null,
      person: { id: PERSON, displayName: "Ann Jansen" },
      lead: null,
      fromCompany: null,
      toCompany: { id: ACME, name: "Acme Lubricants B.V." },
      fromPerson: null,
      toPerson: null,
      fromOwner: null,
      toOwner: null,
    },
    {
      id: "0190f3a0-0000-7000-8000-00000000d004",
      kind: "COMPANY_OWNER_CHANGED",
      createdAt: AT,
      actor: staffRef(OTHER, "Jan de Vries"),
      body: null,
      person: null,
      lead: null,
      fromCompany: null,
      toCompany: null,
      fromPerson: null,
      toPerson: null,
      fromOwner: null,
      toOwner: staffRef(VIEWER, "Sanne Visser"),
    },
    {
      id: "0190f3a0-0000-7000-8000-00000000d005",
      kind: "COMPANY_CREATED",
      createdAt: AT,
      actor: staffRef(OTHER, "Jan de Vries"),
      body: null,
      person: null,
      lead: null,
      fromCompany: null,
      toCompany: null,
      fromPerson: null,
      toPerson: null,
      fromOwner: null,
      toOwner: null,
    },
  ],
  nextCursor: "MTIz",
};

const DETAIL = (over: Partial<CrmCompanyDetailResponse> = {}): CrmCompanyDetailResponse => ({
  company: company(),
  canManage: true,
  owners: OWNERS.sites[0]!.owners,
  ...over,
});

// --- CRM-3 fixtures (360° views) ------------------------------------------------------------------
const DOC = "0190f3a0-0000-7000-8000-00000000e001";
const MSG = "0190f3a0-0000-7000-8000-00000000e002";
const CALL = "0190f3a0-0000-7000-8000-00000000e003";
const NOTE = "0190f3a0-0000-7000-8000-00000000e004";
const STEP = "0190f3a0-0000-7000-8000-00000000e005";
const PRODUCT = "0190f3a0-0000-7000-8000-00000000f001";
const LATER = "2026-11-25T10:30:00.000Z";
const personRef = { id: PERSON, displayName: "Ann Jansen" };
/** A list row without the list-only fields (the summary other answers carry). */
function summaryOf(item: CrmCompanyListResponse["items"][number]) {
  const copy: Partial<typeof item> = { ...item };
  delete copy.peopleCount;
  delete copy.lastActivityAt;
  return copy as Omit<typeof item, "peopleCount" | "lastActivityAt">;
}
const leadRef = { id: LEAD_A, label: "Ann Jansen <ann@acme.example>" };
const RECORDS: CrmCompanyLeadsResponse = {
  leads: [
    {
      id: LEAD_A,
      person: personRef,
      fullName: "Ann Jansen",
      email: "ann@acme.example",
      company: "Acme",
      country: "NL",
      source: "DOCUMENT_REQUEST",
      status: "CONTACTED",
      assignedTo: { id: VIEWER, displayName: "Sanne Visser", active: true },
      requestCount: 2,
      firstRequestAt: AT,
      lastRequestAt: LATER,
      anonymised: false,
      documentRequests: [
        {
          id: DOC,
          createdAt: AT,
          product: { id: PRODUCT, code: "DP-4T-10W40", name: "Dream Moto 4T 10W-40" },
          document: { id: PRODUCT, title: "Technical data sheet", type: "TDS" },
        },
      ],
      contactMessages: [{ id: MSG, createdAt: LATER, subject: "Price for 200 drums" }],
    },
    {
      id: LEAD_B,
      person: personRef,
      fullName: null,
      email: null,
      company: null,
      country: null,
      source: "CONTACT_FORM",
      status: "NEW",
      assignedTo: null,
      requestCount: 1,
      firstRequestAt: AT,
      lastRequestAt: AT,
      anonymised: true,
      documentRequests: [],
      contactMessages: [],
    },
  ],
  truncated: false,
};
const CONTACTS: CrmContactHistoryResponse = {
  items: [
    {
      id: MSG,
      kind: "FORM_MESSAGE",
      at: LATER,
      lead: leadRef,
      person: personRef,
      actor: null,
      channel: "CONTACT_FORM",
      subject: "Price for 200 drums",
      body: "Please send a quote for 200 drums.",
      phone: "+31 6 1234 5678",
    },
    {
      id: CALL,
      kind: "LOGGED_CONTACT",
      at: AT,
      lead: leadRef,
      person: personRef,
      actor: staffRef(VIEWER, "Sanne Visser"),
      channel: "PHONE",
      subject: null,
      body: "Called about delivery dates.",
      phone: null,
    },
  ],
  truncated: false,
};
const OVERVIEW: CrmOverviewResponse = {
  sites: [BV, COM],
  counts: {
    companies: 12,
    myCompanies: 4,
    companiesWithoutOwner: 3,
    people: 27,
    peopleWithoutCompany: 9,
  },
  recentCompanies: LIST.items.slice(0, 1).map(summaryOf),
};
const PEOPLE_LIST: CrmPeopleListResponse = {
  items: [{ ...PEOPLE.people[0]!, siteKey: "BV", companyOwner: company().owner }],
  nextCursor: "bmV4dA",
  sites: [BV],
};
const PROFILE = (over: Partial<CrmPersonProfileResponse> = {}): CrmPersonProfileResponse => ({
  person: PEOPLE.people[0]!,
  siteKey: "BV",
  company: summaryOf(LIST.items[0]!),
  email: "ann@acme.example",
  phone: "+31 6 1234 5678",
  leads: RECORDS.leads,
  contacts: CONTACTS.items,
  notes: [
    {
      id: NOTE,
      createdAt: AT,
      lead: leadRef,
      actor: staffRef(OTHER, "Jan de Vries"),
      body: "Wants samples before ordering.",
    },
  ],
  leadEvents: [
    {
      id: STEP,
      kind: "STATUS_CHANGED",
      createdAt: AT,
      lead: leadRef,
      actor: staffRef(VIEWER, "Sanne Visser"),
      fromStatus: "NEW",
      toStatus: "CONTACTED",
      fromAssignee: null,
      toAssignee: null,
    },
  ],
  activities: HISTORY.items.slice(1, 3),
  canManage: true,
  ...over,
});

const listPage = await import("../app/(console)/crm/companies/page");
const peoplePage = await import("../app/(console)/crm/people/page");
const personPage = await import("../app/(console)/crm/people/[id]/page");
const { CrmNav } = await import("../components/crm/crm-nav");
const newPage = await import("../app/(console)/crm/companies/new/page");
const companyPage = await import("../app/(console)/crm/companies/[id]/page");
const crmRoot = await import("../app/(console)/crm/page");
const { LeadPerson } = await import("../components/crm/lead-person");
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
  walk([LIST, OWNERS, DETAIL(), PEOPLE, HISTORY, RECORDS, CONTACTS, PEOPLE_LIST, PROFILE()]);
  // Country names that Intl writes the same in both languages (e.g. "Malta").
  const trNames = new Set(view.countryOptions("tr").map((c) => c.name));
  const same = (p: string) =>
    FIXED.has(p) || trNames.has(p) || data.some((d) => d === p || (p.length > 3 && d.includes(p)));
  return (
    same(text) ||
    text
      .split(/\s*·\s*/)
      .filter(Boolean)
      .every(same)
  );
}

const page = {
  list:
    (q: Record<string, string> = {}) =>
    () =>
      listPage.default({ searchParams: Promise.resolve(q) } as never),
  detail:
    (q: Record<string, string> = {}) =>
    () =>
      companyPage.default({
        params: Promise.resolve({ id: ACME }),
        searchParams: Promise.resolve(q),
      } as never),
  create: () => () => newPage.default(),
  overview: () => () => crmRoot.default(),
  people:
    (q: Record<string, string> = {}) =>
    () =>
      peoplePage.default({ searchParams: Promise.resolve(q) } as never),
  person:
    (q: Record<string, string> = {}) =>
    () =>
      personPage.default({
        params: Promise.resolve({ id: PERSON }),
        searchParams: Promise.resolve(q),
      } as never),
};

describe("CRM-1 company list", () => {
  it("shows companies with place, owner and site, and the create button for managers", async () => {
    reads.set(ADMIN_CRM_COMPANIES_API, LIST);
    const html = await render(page.list(), "en");
    expect(html).toContain("Acme Lubricants B.V.");
    expect(html).toContain("Rotterdam · Netherlands · NL851234567B01");
    expect(html).toContain("Sanne Visser");
    expect(html).toContain("No account owner");
    expect(html).toContain('href="/crm/companies/new"');
    expect(html).toContain(`href="/crm/companies/${ACME}"`);
    expect(html).toContain("2 shown");
    // CRM-3: people and last activity; no people count without lead:read on the site.
    expect(html).toContain("People: 3");
    expect(html).toContain("Last activity");
    expect(html.match(/People: /g)).toHaveLength(1);
    const tr = await render(page.list(), "tr");
    expect(tr).toContain("Yeni firma");
    expect(tr).toContain("Müşteri sorumlusu yok");
    expect(tr).toContain("Rotterdam · Hollanda · NL851234567B01");
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

describe("CRM-2 people and history of a company", () => {
  const withPeople = () => {
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL());
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/people`, PEOPLE);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/activities`, HISTORY);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/activities?kind=NOTE`, {
      items: HISTORY.items.slice(0, 1),
      nextCursor: null,
    });
  };

  it("shows the people with their leads, the history and the note form for managers", async () => {
    withPeople();
    const people = await render(page.detail({ tab: "people" }), "en");
    for (const text of [
      "People",
      "Ann Jansen",
      "ann@acme.example",
      "Anonymised lead",
      "Contacted",
      "Last request",
      "Remove from company",
      "Add a person",
    ]) {
      expect(people, text).toContain(text);
    }
    expect(people).toContain(`href="/leads/${LEAD_A}"`);
    expect(people).not.toContain(`href="/leads/${LEAD_B}"`);
    // CRM-3: each person opens its profile; the people list filters by the company.
    expect(people).toContain(`href="/crm/people/${PERSON}"`);
    expect(people).toContain(`href="/crm/people?company=${ACME}"`);
    const history = await render(page.detail({ tab: "activity" }), "en");
    for (const text of [
      "History",
      "Sanne Visser added a note",
      "Visited the plant.\nFollow up in Q1.",
      "Sanne Visser linked Ann Jansen &lt;ann@acme.example&gt; to Ann Jansen",
      "Jan de Vries added Ann Jansen to the company",
      "Jan de Vries made Sanne Visser the account owner",
      "Jan de Vries created the company",
      "Older entries",
    ]) {
      expect(history, text).toContain(text);
    }
    expect(history).toContain(`href="/crm/companies/${ACME}?tab=activity&amp;history=MTIz"`);
    const notes = await render(page.detail({ tab: "notes" }), "en");
    for (const text of ["Add note", "Visited the plant.", "Prefers quarterly calls."]) {
      expect(notes, text).toContain(text);
    }
    expect(notes).not.toContain("Jan de Vries created the company");
    const tr = await render(page.detail({ tab: "people" }), "tr");
    for (const text of ["Kişiler", "Anonimleştirilmiş talep", "Firmadan çıkar"]) {
      expect(tr, text).toContain(text);
    }
    const trHistory = await render(page.detail({ tab: "activity" }), "tr");
    for (const text of ["Geçmiş", "not ekledi"]) expect(trHistory, text).toContain(text);
  });

  it("pages the history and is read-only without crm:manage", async () => {
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL({ canManage: false, owners: [] }));
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/people`, { ...PEOPLE, canManage: false });
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/activities?cursor=MTIz`, {
      ...HISTORY,
      nextCursor: null,
    });
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/activities?kind=NOTE`, {
      items: [],
      nextCursor: null,
    });
    const html = await render(page.detail({ tab: "activity", history: "MTIz" }), "en");
    expect(html).toContain("Newest entries");
    expect(html).not.toContain("Older entries");
    const people = await render(page.detail({ tab: "people" }), "en");
    expect(people).not.toContain("Remove from company");
    expect(people).not.toContain("Add a person");
    const notes = await render(page.detail({ tab: "notes" }), "en");
    expect(notes).not.toContain("Add note");
  });

  it("leaves the panels out when the CRM side cannot be read", async () => {
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL());
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/people`, FORBIDDEN);
    const html = await render(page.detail({ tab: "people" }), "en");
    expect(html).not.toContain("Ann Jansen");
    expect(html).not.toContain('role="alert"');
    // The overview tab reads the company only.
    const overview = await render(page.detail(), "en");
    expect(overview).toContain("NL851234567B01");
    expect(overview).not.toContain(">History<");
  });
});

describe("CRM-3 the company's 360° tabs", () => {
  beforeEach(() => {
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL());
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/leads`, RECORDS);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/contacts`, CONTACTS);
  });

  it("has one tab per section, each with its own address", async () => {
    const html = await render(page.detail(), "en");
    for (const [key, label] of [
      ["people", "People"],
      ["leads", "Leads and requests"],
      ["notes", "Notes"],
      ["contacts", "Contact history"],
      ["activity", "Recent activity"],
    ] as const) {
      expect(html).toContain(`href="/crm/companies/${ACME}?tab=${key}"`);
      expect(html).toContain(label);
    }
    expect(html).toMatch(/aria-current="page"[^>]*>Overview/);
    expect(html).toContain("Account owner: Sanne Visser");
  });

  it("lists the people's leads with their document requests and messages", async () => {
    const html = await render(page.detail({ tab: "leads" }), "en");
    for (const text of [
      "Ann Jansen",
      "Person: Ann Jansen",
      "Typed company: Acme",
      "Document request",
      "DP-4T-10W40 · Dream Moto 4T 10W-40",
      "Technical data sheet",
      "Price for 200 drums",
      "Assigned to Sanne Visser",
      "Anonymised lead",
      "Not assigned",
      "No requests.",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain(`href="/leads/${LEAD_A}"`);
    expect(html).not.toContain(`href="/leads/${LEAD_B}"`);
    expect(html).toContain(`href="/crm/people/${PERSON}"`);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/leads`, { leads: [], truncated: false });
    expect(await render(page.detail({ tab: "leads" }), "en")).toContain("No leads yet");
  });

  it("shows the contact history: form messages and logged contacts", async () => {
    const html = await render(page.detail({ tab: "contacts" }), "en");
    for (const text of [
      "Contact form",
      "Message from Ann Jansen &lt;ann@acme.example&gt;",
      "Please send a quote for 200 drums.",
      "Phone: +31 6 1234 5678",
      "Sanne Visser logged a contact with Ann Jansen &lt;ann@acme.example&gt;",
      "Called about delivery dates.",
    ]) {
      expect(html, text).toContain(text);
    }
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/contacts`, { items: [], truncated: true });
    const empty = await render(page.detail({ tab: "contacts" }), "en");
    expect(empty).toContain("No contacts yet");
    expect(empty).toContain("Only the newest 100 are shown.");
  });
});

describe("CRM-3 overview, people and a person", () => {
  it("shows real counts that open the filtered lists, and the recent companies", async () => {
    reads.set(ADMIN_CRM_OVERVIEW_API, OVERVIEW);
    const html = await render(page.overview(), "en");
    for (const text of ["CRM overview", "Companies I own", "People without a company"]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('href="/crm/companies?owner=me"');
    expect(html).toContain('href="/crm/companies?owner=none"');
    expect(html).toContain('href="/crm/people?company=none"');
    expect(html).toContain(`href="/crm/companies/${ACME}"`);
    expect(html).toMatch(/>27<\/span>/);
    // Without lead:read the people counts are left out (null), never shown as 0.
    reads.set(ADMIN_CRM_OVERVIEW_API, {
      ...OVERVIEW,
      counts: { ...OVERVIEW.counts, people: null, peopleWithoutCompany: null },
    });
    const noPeople = await render(page.overview(), "en");
    expect(noPeople).not.toContain("People without a company");
    reads.set(ADMIN_CRM_OVERVIEW_API, FORBIDDEN);
    expect(await render(page.overview(), "en")).toContain("No access to the CRM");
  });

  it("marks the open CRM section", () => {
    ui.pathname = "/crm/people/x";
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en">
        <CrmNav />
      </LocaleProvider>,
    );
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/crm/people"');
    ui.pathname = "/crm";
  });

  it("lists people with company, owner and lead status, and sends safe filters", async () => {
    reads.set(`${ADMIN_CRM_PEOPLE_API}?company=none&status=NEW`, PEOPLE_LIST);
    const html = await render(page.people({ company: "none", status: "new", owner: "x" }), "en");
    for (const text of [
      "Ann Jansen",
      "ann@acme.example · Leads: 2",
      "Acme Lubricants B.V.",
      "Account owner: Sanne Visser",
      "Contacted",
      "Next page",
      "Clear filters",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain(`href="/crm/people/${PERSON}"`);
    expect(html).toContain('href="/crm/people?company=none&amp;status=NEW&amp;cursor=bmV4dA"');
    reads.set(ADMIN_CRM_PEOPLE_API, { items: [], nextCursor: null, sites: [BV] });
    expect(await render(page.people(), "en")).toContain("No people yet");
    reads.set(ADMIN_CRM_PEOPLE_API, FORBIDDEN);
    expect(await render(page.people(), "en")).toContain("No access to the CRM");
  });

  it("shows a person's profile: contact, company, leads, contacts, notes, activity", async () => {
    reads.set(`${ADMIN_CRM_PEOPLE_API}/${PERSON}`, PROFILE());
    const overview = await render(page.person(), "en");
    for (const text of [
      "Ann Jansen",
      "Contact details",
      "ann@acme.example",
      "+31 6 1234 5678",
      "Acme Lubricants B.V.",
      "Sanne Visser",
    ]) {
      expect(overview, text).toContain(text);
    }
    expect(overview).toContain('href="mailto:ann@acme.example"');
    expect(overview).toContain('href="tel:+31612345678"');
    expect(overview).toContain(`href="/crm/companies/${ACME}"`);
    const leads = await render(page.person({ tab: "leads" }), "en");
    expect(leads).toContain("Technical data sheet");
    expect(leads).not.toContain("Person: Ann Jansen");
    const contacts = await render(page.person({ tab: "contacts" }), "en");
    expect(contacts).toContain("Called about delivery dates.");
    const notes = await render(page.person({ tab: "notes" }), "en");
    expect(notes).toContain("Wants samples before ordering.");
    expect(notes).toContain("Jan de Vries on Ann Jansen &lt;ann@acme.example&gt;");
    const activity = await render(page.person({ tab: "activity" }), "en");
    expect(activity).toContain("Sanne Visser set Ann Jansen &lt;ann@acme.example&gt; to Contacted");
    expect(activity).toContain("Jan de Vries added Ann Jansen to Acme Lubricants B.V.");
    reads.set(
      `${ADMIN_CRM_PEOPLE_API}/${PERSON}`,
      PROFILE({ company: null, phone: null, notes: [] }),
    );
    expect(await render(page.person(), "en")).toContain("Not linked to a company.");
    expect(await render(page.person({ tab: "notes" }), "en")).toContain("No notes yet.");
    reads.delete(`${ADMIN_CRM_PEOPLE_API}/${PERSON}`);
    expect(await render(page.person(), "en")).toContain("Person not found");
  });
});

describe("CRM-2 the CRM panel of a lead", () => {
  const panel = (over: Partial<Parameters<typeof LeadPerson>[0]> = {}) =>
    function Panel() {
      return (
        <LeadPerson
          leadId={LEAD_B}
          siteId={BV.id}
          person={PEOPLE.people[0]!}
          canManage
          anonymised={false}
          {...over}
        />
      );
    };

  it("shows the company and the same person's other leads, with the link actions", async () => {
    const html = await render(panel(), "en");
    expect(html).toContain(`href="/crm/companies/${ACME}"`);
    expect(html).toContain(`href="/leads/${LEAD_A}"`);
    for (const text of [
      "Remove from company",
      "Separate this lead",
      "Search companies",
      "Find the same person",
    ]) {
      expect(html, text).toContain(text);
    }
    const tr = await render(panel(), "tr");
    expect(tr).toContain("Bu talebi ayır");
  });

  it("is read-only without crm:manage and for an anonymised lead; explains a lead without a person", async () => {
    expect(await render(panel({ canManage: false }), "en")).toContain("You can view this.");
    expect(await render(panel({ anonymised: true }), "en")).toContain("This lead is anonymised");
    const none = await render(panel({ person: null }), "en");
    expect(none).toContain("This lead is not linked to a person or a company yet.");
    expect(none).not.toContain("Separate this lead");
  });
});

describe("CRM-2 browser client", () => {
  it("calls the people, lead and note routes", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: String(init.method),
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ person: null, items: [] }), { status: 200 });
    });
    await client.companyCandidates(ACME, "");
    await client.companyCandidates(ACME, "ann jansen");
    await client.addPersonToCompany(ACME, { leadId: LEAD_A, confirmMove: true });
    await client.setPersonCompany(PERSON, { companyId: null, version: 1 });
    await client.leadCandidates(LEAD_B, "ann");
    await client.setLeadPerson(LEAD_B, { samePersonAsLeadId: LEAD_A });
    await client.searchCompanies(BV.id, "acme");
    await client.addCompanyNote(ACME, "Called.");
    expect(calls).toEqual([
      { url: `${ADMIN_CRM_COMPANIES_API}/${ACME}/candidates`, method: "GET", body: null },
      {
        url: `${ADMIN_CRM_COMPANIES_API}/${ACME}/candidates?q=ann+jansen`,
        method: "GET",
        body: null,
      },
      {
        url: `${ADMIN_CRM_COMPANIES_API}/${ACME}/people`,
        method: "POST",
        body: { leadId: LEAD_A, confirmMove: true },
      },
      {
        url: `${ADMIN_CRM_PEOPLE_API}/${PERSON}/company`,
        method: "POST",
        body: { companyId: null, version: 1 },
      },
      { url: `${ADMIN_CRM_LEADS_API}/${LEAD_B}/candidates?q=ann`, method: "GET", body: null },
      {
        url: `${ADMIN_CRM_LEADS_API}/${LEAD_B}/person`,
        method: "POST",
        body: { samePersonAsLeadId: LEAD_A },
      },
      { url: `${ADMIN_CRM_COMPANIES_API}?siteId=${BV.id}&q=acme`, method: "GET", body: null },
      {
        url: `${ADMIN_CRM_COMPANIES_API}/${ACME}/notes`,
        method: "POST",
        body: { body: "Called." },
      },
    ]);
  });

  it("maps the link refusals to their messages", () => {
    const t = createTranslator("tr");
    const err = (rule: string, path = "leadId") => ({
      error: { code: "CONFLICT_STATE", message: "x", requestId: "r", details: [{ path, rule }] },
    });
    expect(client.crmErrorMessage(err("other_company"), t, "linkFailed").message).toBe(
      "Bu kişi başka bir firmada çalışıyor.",
    );
    expect(client.crmErrorMessage(err("lead_anonymised"), t).rule).toBe("lead_anonymised");
    expect(
      client.crmErrorMessage(err("duplicate_registration", "registrationId"), t),
    ).toMatchObject({
      field: "registrationId",
      rule: "duplicate_registration",
    });
    expect(client.crmErrorMessage(null, t, "linkFailed").message).toBe("Değişiklik kaydedilemedi.");
  });
});

describe("CRM-1 Turkish", () => {
  it("leaves no English UI text on any screen", async () => {
    reads.set(ADMIN_CRM_COMPANIES_API, LIST);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}`, DETAIL());
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/people`, PEOPLE);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/activities`, HISTORY);
    reads.set(ADMIN_CRM_OWNERS_API, OWNERS);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/activities?kind=NOTE`, HISTORY);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/leads`, RECORDS);
    reads.set(`${ADMIN_CRM_COMPANIES_API}/${ACME}/contacts`, CONTACTS);
    reads.set(ADMIN_CRM_OVERVIEW_API, OVERVIEW);
    reads.set(ADMIN_CRM_PEOPLE_API, PEOPLE_LIST);
    reads.set(`${ADMIN_CRM_PEOPLE_API}/${PERSON}`, PROFILE());
    const tabs = ["people", "leads", "notes", "contacts", "activity"];
    const personTabs = ["leads", "contacts", "notes", "activity"];
    for (const make of [
      page.list(),
      page.detail(),
      ...tabs.map((tab) => page.detail({ tab })),
      page.create(),
      page.overview(),
      page.people(),
      page.person(),
      ...personTabs.map((tab) => page.person({ tab })),
    ]) {
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
      client.crmErrorMessage(
        err("CONFLICT_STATE", [{ path: "name", rule: "possible_duplicate" }]),
        t,
      ),
    ).toEqual({
      message: expect.stringMatching(/^Another company of this site has this name\./),
      field: "name",
      rule: "possible_duplicate",
    });
    expect(
      client.crmErrorMessage(err("CONFLICT_STATE", [{ path: "version", rule: "stale" }]), t)
        .message,
    ).toMatch(/Someone else changed this company/);
    expect(
      client.crmErrorMessage(err("VALIDATION_FAILED", [{ path: "website", rule: "invalid" }]), t),
    ).toEqual({ message: "Check this field: Website.", field: "website", rule: null });
    expect(
      client.crmErrorMessage(
        err("VALIDATION_FAILED", [{ path: "ownerUserId", rule: "owner_not_eligible" }]),
        createTranslator("tr"),
      ),
    ).toEqual({
      message: "Bu kişi bu sitenin firmalarına sorumlu olamaz.",
      field: "ownerUserId",
      rule: "owner_not_eligible",
    });
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
    // CRM-2 adds the people, history, note and lead panels (4 components); CRM-3 the layout,
    // the people list and profile, the section bar, tabs, lead records and contact history (7).
    expect(files.length).toBe(18);
    expect(scanFiles(ROOT, files)).toEqual([]);
  });
});
