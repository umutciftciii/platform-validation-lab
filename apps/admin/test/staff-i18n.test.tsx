// ML-12e (DP-243): Admin > Staff and access in Turkish. Every screen and state of staff-en.test.tsx
// is rendered twice on the server with the same fixtures — once in English, once with the
// `dp-admin-locale=tr` cookie — and compared:
//   1. no English UI text is left in Turkish: a visible text (text node, aria-label, title,
//      placeholder, alt) equal in both languages must be data from the fixtures (people, e-mail
//      addresses, site names, the enrolment link) or a fixed term (SAME_IN_BOTH); role names are
//      NOT data here: a known role must show its Turkish name;
//   2. the translation changes text only: the element structure, every form field, option value
//      (role keys, site and person ids) and attribute is identical;
//   3. role names and descriptions are translated by role key, and only while the API sends the
//      dictionary's English text: a renamed or unknown role shows the API's own text;
//   4. the browser helpers (lib/staff-client.ts) answer in the page's language (cookie), by API
//      rule and code; RULE_MESSAGES stays English, the request paths and bodies stay the API's.
// English itself is covered byte for byte by the EN baseline (staff-en.test.tsx).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES, type AssignableRole, type StaffMember } from "@dream/contracts";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { dateTimeFormat } from "../lib/i18n/format";
import { en as EN_MESSAGES } from "../lib/i18n/messages/en";
import { tr as TR_MESSAGES } from "../lib/i18n/messages/tr";
import { createTranslator } from "../lib/i18n/translate";
import {
  BV,
  CORP,
  NOW,
  ROLES,
  SITES,
  STAFF,
  STAFF_API,
  VIEWER,
  id,
  list,
} from "./support/staff-fixtures";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const KEEP = Symbol("keep");
const queue = vi.hoisted(() => [] as unknown[]);
const sets = vi.hoisted(() => [] as unknown[]);
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const initial = typeof init === "function" ? (init as () => unknown)() : init;
    const next = queue.length ? queue.shift() : KEEP;
    return [next === KEEP ? initial : next, (v: unknown) => void sets.push(v)];
  };
  return { ...react, default: { ...react, useState }, useState };
});

const reads = new Map<string, unknown>();
const FAIL = Symbol("fail");
const FORBIDDEN = Symbol("forbidden");
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dp-admin-locale" ? { value: ui.locale } : undefined),
    has: () => false,
  }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(path);
    if (v === FAIL) return { ok: false, status: 500, code: "INTERNAL_ERROR" };
    if (v === FORBIDDEN) return { ok: false, status: 403, code: "FORBIDDEN" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const pageModule = await import("../app/(console)/staff/page");
const { AssignRoleForm, InviteForm, RemoveRoleButton } =
  await import("../components/staff/staff-actions");
const client = await import("../lib/staff-client");

const TR = createTranslator("tr");
const LINK = "https://admin.fixture.invalid/enrol#token=abc123";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  reads.clear();
  queue.length = 0;
  sets.length = 0;
  reads.set(STAFF_API, list());
});
afterEach(() => vi.unstubAllGlobals());

/** Names and terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set(["Dream Petroleum BV", "Dream Petroleum", "Corporate", "Site", "CRM"]);

/** The dictionary's English role names and descriptions: shown translated, never as data. */
const EN_ROLE_TEXTS = new Set<string>(
  Object.values(EN_MESSAGES.staff.roles).flatMap((r) => [r.name, r.description]),
);

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");

/** Visible texts: text nodes and the attributes people read or hear. */
function texts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of html.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

/** Every string value of the fixtures and states, except the role texts the dictionary knows. */
function fixtureData(states: unknown[] = []): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const v of reads.values()) walk(v);
  walk([STAFF, SITES, states, LINK]);
  return out.filter((s) => !EN_ROLE_TEXTS.has(s));
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  if (data.includes(text)) return true;
  const rest = text.split(/\s*(?:·|,|\(|\)|:)\s*/).filter((p) => /[A-Za-z]{2,}/.test(p));
  return rest.length > 0 && rest.every((p) => SAME_IN_BOTH.has(p) || data.includes(p));
}

/** The markup without any visible text: tags and every attribute people do not read. */
function structure(html: string): string {
  return html
    .replace(/\s(?:aria-label|title|placeholder|alt)="[^"]*"/g, "")
    .replace(/>[^<]*</g, "><")
    .replace(/<!-- -->/g, "");
}

type Render = () => Promise<ReactElement> | ReactElement;

async function render(make: Render, locale: AdminLocale, states: unknown[] = []): Promise<string> {
  ui.locale = locale;
  queue.length = 0;
  queue.push(...states);
  const tree = await make();
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
}

async function compare(make: Render, states: unknown[] = []) {
  const en = await render(make, "en", states);
  const tr = await render(make, "tr", states);
  const enTexts = new Set(texts(en));
  const data = fixtureData(states);
  const left = [...new Set(texts(tr))].filter((t) => enTexts.has(t) && !isData(t, data));
  return { en, tr, left };
}

const page: Render = () => pageModule.default() as Promise<ReactElement>;
const assign = (over: Record<string, unknown> = {}): Render =>
  function AssignScreen() {
    return <AssignRoleForm staff={STAFF} roles={ROLES} sites={SITES} viewerId={VIEWER} {...over} />;
  };
const invite = (over: Record<string, unknown> = {}): Render =>
  function InviteScreen() {
    return <InviteForm sites={SITES} roles={ROLES} {...over} />;
  };
const remove: Render = function RemoveScreen() {
  return <RemoveRoleButton assignmentId={id(104)} label="Sales / CRM User from Sam Sales" />;
};
const none = () => undefined;
const PERSON = "new.person@fixture.invalid";
const readOnly = () =>
  reads.set(
    STAFF_API,
    list({
      roles: [ROLES[4] as AssignableRole],
      staff: STAFF.map((p) => ({ ...p, roles: p.roles.map((r) => ({ ...r, canRevoke: false })) })),
    }),
  );

describe("Staff in Turkish: every screen and state", () => {
  const screens: [string, () => void, Render, unknown[]?][] = [
    ["page", none, page],
    ["page, read only", readOnly, page],
    [
      "page, one account",
      () => reads.set(STAFF_API, list({ staff: [STAFF[0] as StaffMember] })),
      page,
    ],
    ["page, empty", () => reads.set(STAFF_API, list({ staff: [], roles: [], sites: [] })), page],
    ["page, refused", () => reads.set(STAFF_API, FORBIDDEN), page],
    ["page, load error", () => reads.set(STAFF_API, FAIL), page],
    ["page, missing route", () => reads.delete(STAFF_API), page],
    ["give a role", none, assign()],
    ["give a role, nothing to give", none, assign({ roles: [] })],
    ["give a role, platform role", none, assign(), [id(3), "platform_super_admin", KEEP, KEEP]],
    ["give a role, site role", none, assign(), [id(3), "site_admin", CORP, "2027-01-31"]],
    ["give a role, lead data role", none, assign(), [id(3), "sales_crm_user"]],
    ["give a role, busy", none, assign(), [id(3), "site_admin", BV, KEEP, true]],
    [
      "give a role, error",
      none,
      assign(),
      [
        id(3),
        "site_admin",
        BV,
        KEEP,
        KEEP,
        { kind: "error", text: TR("staff.api.rules.already_assigned") },
      ],
    ],
    [
      "give a role, success",
      none,
      assign(),
      [
        id(3),
        "site_admin",
        BV,
        KEEP,
        KEEP,
        {
          kind: "success",
          text: TR("staff.assign.success", { name: "Sam Sales", role: "Site yöneticisi" }),
        },
      ],
    ],
    ["remove", none, remove],
    ["remove, confirming", none, remove, [true]],
    ["remove, busy", none, remove, [true, true]],
    ["remove, error", none, remove, [true, KEEP, TR("staff.api.rules.db_guard")]],
    ["invite", none, invite()],
    ["invite, filled", none, invite(), [PERSON, "New Person", CORP, "site_admin"]],
    ["invite, no sites", none, invite({ sites: [], roles: [] })],
    ["invite, code asked", none, invite(), [PERSON, "New Person", BV, KEEP, KEEP, true]],
    ["invite, code entered", none, invite(), [PERSON, "New Person", BV, KEEP, "123 456", true]],
    ["invite, busy", none, invite(), [PERSON, "New Person", BV, KEEP, KEEP, KEEP, true]],
    [
      "invite, error",
      none,
      invite(),
      [KEEP, KEEP, KEEP, KEEP, KEEP, true, KEEP, TR("errors.AUTH_MFA_INVALID")],
    ],
    ["invite, link", none, invite(), [KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, LINK]],
  ];

  for (const [name, setup, make, states] of screens) {
    it(name, async () => {
      setup();
      const { en, tr, left } = await compare(make, states);
      expect(left, `English left in Turkish (${name})`).toEqual([]);
      expect(structure(tr), `markup changed (${name})`).toBe(structure(en));
      expect(tr).not.toBe(en);
    });
  }

  it("names the page in Turkish", async () => {
    ui.locale = "tr";
    expect(await pageModule.generateMetadata()).toEqual({ title: "Personel ve erişim" });
  });
});

describe("Staff in Turkish: labels, plurals, dates and data", () => {
  it("translates status, membership and role labels; data and keys stay", async () => {
    const tr = decode(await render(page, "tr"));
    for (const label of ["Etkin", "Davet edildi", "Askıya alındı", "Kapatıldı", "Siz", "Rol yok."])
      expect(tr).toContain(label);
    expect(tr).toContain("Siteler: Dream Petroleum BV, Corporate (askıya alındı)");
    expect(tr).toContain("Siteler: Corporate (askıya alındı), Site");
    expect(tr).toContain("Siteler: Dream Petroleum BV (geri alındı)");
    expect(tr).toContain("· Tüm siteler");
    for (const name of [
      "Sistem sahibi",
      "Platform süper yöneticisi",
      "Platform ürün yöneticisi",
      "Satış / CRM kullanıcısı",
      "Site yöneticisi",
      "İçerik editörü",
      "Teknik inceleyici",
    ])
      expect(tr).toContain(name);
    for (const en of ["Platform Super Admin", "System Owner", "Sales / CRM User", "Ends soon"])
      expect(tr).not.toContain(en);
    expect(tr).toContain("Yakında bitiyor");
    expect(tr).toContain(" · veren: Ada Admin");
    // people, e-mail addresses, site names and the role keys of the form are data
    for (const p of STAFF) {
      expect(tr).toContain(p.displayName);
      expect(tr).toContain(p.email);
    }
    for (const r of ROLES.filter((x) => x.platform || x.siteIds.length))
      expect(tr).toContain(`value="${r.key}"`);
    expect(tr).toContain('aria-label="Kaldır: Sam Sales kişisinden Satış / CRM kullanıcısı rolü"');
  });

  it("counts staff accounts with the Turkish plural (singular noun after a number)", async () => {
    expect(await render(page, "tr")).toContain("7 personel hesabı");
    reads.set(STAFF_API, list({ staff: [STAFF[0] as StaffMember] }));
    expect(await render(page, "tr")).toContain("1 personel hesabı");
  });

  it("formats end dates in Turkish, in the company's time zone", async () => {
    const opts: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Amsterdam",
    };
    const date = dateTimeFormat("tr", opts).format(new Date("2026-12-01T23:59:00.000Z"));
    expect(date).toBe("2 Ara 2026");
    expect(decode(await render(page, "tr"))).toContain(` · ${date} tarihine kadar`);
  });

  it("shows the API's text for a renamed or unknown role, in both languages", async () => {
    const custom: AssignableRole = {
      key: "custom_role",
      name: "Custom Role",
      description: "Something new.",
      scopeType: "PLATFORM",
      customerData: false,
      siteIds: [],
      platform: true,
    };
    const renamed: AssignableRole = {
      ...(ROLES[2] as AssignableRole),
      name: "Site Administrator",
      description: "Renamed in the database.",
    };
    const staff = STAFF.map((p) =>
      p.id === id(3)
        ? {
            ...p,
            roles: [
              {
                ...(p.roles[0] as StaffMember["roles"][number]),
                roleKey: "custom_role",
                roleName: "Custom Role",
              },
              { ...(p.roles[1] as StaffMember["roles"][number]), roleName: "Site Administrator" },
            ],
          }
        : p,
    );
    reads.set(STAFF_API, list({ staff, roles: [custom, renamed] }));
    const tr = await render(page, "tr");
    expect(tr).toContain("Custom Role");
    expect(tr).toContain("Site Administrator");
    expect(tr).not.toContain("Site yöneticisi");
    const form = await render(assign({ roles: [custom, renamed] }), "tr", [id(3), "custom_role"]);
    expect(form).toContain("Something new.");
    const form2 = await render(assign({ roles: [custom, renamed] }), "tr", [id(3), "site_admin"]);
    expect(form2).toContain("Renamed in the database.");
    const known = await render(assign(), "tr", [id(3), "site_admin"]);
    expect(known).toContain(TR("staff.roles.site_admin.description"));
  });

  it("words the success message the submit sets in Turkish", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ assignment: {}, replacedAssignmentId: null }), {
            status: 201,
          }),
      ),
    );
    const got: unknown[] = [];
    for (const person of [id(3), VIEWER]) {
      let submit: ((e: { preventDefault(): void }) => Promise<void>) | null = null;
      function Grab() {
        const form = AssignRoleForm({
          staff: STAFF,
          roles: ROLES,
          sites: SITES,
          viewerId: VIEWER,
        }) as ReactElement<{ onSubmit: typeof submit }>;
        submit = form.props.onSubmit;
        return null;
      }
      await render(() => <Grab />, "tr", [person, "site_admin"]);
      sets.length = 0;
      await (submit as unknown as (e: { preventDefault(): void }) => Promise<void>)({
        preventDefault: () => undefined,
      });
      got.push(sets.find((v) => typeof v === "object" && v !== null && "kind" in v));
    }
    expect(got).toEqual([
      { kind: "success", text: "Sam Sales artık Site yöneticisi rolüne sahip." },
      { kind: "success", text: "Kişi artık Site yöneticisi rolüne sahip." },
    ]);
  });
});

describe("Staff in Turkish: the browser helpers' messages", () => {
  const errorReply = (status: number, code: string, rule?: string) =>
    new Response(
      JSON.stringify({
        error: {
          code,
          message: "x",
          requestId: "r",
          details: rule ? [{ path: "(root)", rule }] : [],
        },
      }),
      { status, headers: { "content-type": "application/json" } },
    );

  it("answers in the page's language (cookie), by rule and code; paths stay", async () => {
    vi.stubGlobal("document", { cookie: "theme=dark; dp-admin-locale=tr" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const rules = Object.keys(
      EN_MESSAGES.staff.api.rules,
    ) as (keyof typeof EN_MESSAGES.staff.api.rules)[];
    for (const rule of rules) {
      fetchMock.mockResolvedValueOnce(errorReply(409, "CONFLICT_STATE", rule));
      const res = await client.assignRole(id(3), { roleKey: "site_admin", siteId: BV });
      expect(res).toEqual({
        ok: false,
        status: 409,
        message: TR_MESSAGES.staff.api.rules[rule],
        stepUp: false,
      });
    }
    for (const code of ERROR_CODES.filter((c) => c !== "FORBIDDEN")) {
      fetchMock.mockResolvedValueOnce(errorReply(400, code));
      const res = await client.revokeRole(id(104));
      expect(!res.ok && res.message).toBe(TR_MESSAGES.errors[code]);
    }
    fetchMock.mockResolvedValueOnce(errorReply(403, "FORBIDDEN"));
    expect(await client.revokeRole(id(104))).toMatchObject({
      message: TR_MESSAGES.staff.api.forbidden,
    });
    fetchMock.mockResolvedValueOnce(errorReply(403, "AUTH_STEP_UP_REQUIRED"));
    expect(
      await client.inviteStaff({ email: "x@fixture.invalid", displayName: "X", siteId: BV }),
    ).toMatchObject({ stepUp: true, message: TR_MESSAGES.errors.AUTH_STEP_UP_REQUIRED });
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await client.stepUp("000000")).toMatchObject({
      message: TR_MESSAGES.staff.api.saveFailed,
    });
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect(await client.revokeRole(id(104))).toMatchObject({
      status: 0,
      message: TR_MESSAGES.staff.api.unreachable,
    });
    // request paths and bodies are the API's, whatever the language
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/admin/staff/${id(3)}/roles`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      roleKey: "site_admin",
      siteId: BV,
    });
    // the exported English table is unchanged
    expect(client.RULE_MESSAGES["already_assigned"]).toBe(
      "This person already has this role there.",
    );
  });

  it("has a Turkish text for every Staff key, different from English except names and terms", () => {
    const flat = (o: unknown, p = ""): [string, string][] =>
      typeof o === "string"
        ? [[p, o]]
        : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
            flat(v, p ? `${p}.${k}` : k),
          );
    const en = flat(EN_MESSAGES.staff);
    const tr = new Map(flat(TR_MESSAGES.staff));
    expect([...tr.keys()].sort()).toEqual(en.map(([k]) => k).sort());
    const same = en.filter(([k, v]) => tr.get(k) === v).map(([k]) => k);
    expect(same.sort()).toEqual([
      "assign.site",
      "invite.site",
      "page.membershipNotActive",
      "page.roleSite",
      "page.unknownSite",
    ]);
  });
});
