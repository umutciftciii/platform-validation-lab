// ML-12e (DP-243): the system owner area (owner console, protected audit trail, designation
// confirmation) in Turkish. Every screen and state is rendered twice on the server with the same
// fixtures — once in English, once with the `dp-admin-locale=tr` cookie — and compared:
//   1. no English UI text is left in Turkish: a text equal in both languages must be data from the
//      fixtures (owner e-mail, reasons, site names, audit event codes, resource types, hashes) or a
//      fixed term (SAME_IN_BOTH: CRM, SHA-256, God Mode …);
//   2. the translation changes text only: the element structure, links, form fields and values are
//      identical;
//   3. module names follow the module KEY (an unknown key keeps the API's text); audit event codes,
//      chain numbers, hashes, e-mail addresses and IDs stay as they are; outcome and actor type are
//      labelled by their code;
//   4. the owner client's messages follow the UI language (codes and request paths unchanged);
//   5. the system owner is not the platform super admin: in Turkish too, every owner page is a 404
//      for anyone else and the owner console is in the owner's navigation only.
// English itself is covered byte for byte by the EN baseline (owner-en.test.tsx).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  OwnerChainStatus,
  OwnerOverviewResponse,
  ProtectedAuditEvent,
} from "@dream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";
import { owner as OWNER_EN } from "../lib/i18n/messages/owner/en";
import { owner as OWNER_TR } from "../lib/i18n/messages/owner/tr";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const KEEP = Symbol("keep");
const queue = vi.hoisted(() => [] as unknown[]);
const frag = vi.hoisted(() => ({ hash: undefined as unknown }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const initial = typeof init === "function" ? (init as () => unknown)() : init;
    const next = queue.length ? queue.shift() : KEEP;
    return [next === KEEP ? initial : next, () => undefined];
  };
  const useSyncExternalStore = (...args: Parameters<typeof react.useSyncExternalStore>) =>
    frag.hash === undefined ? react.useSyncExternalStore(...args) : frag.hash;
  return {
    ...react,
    default: { ...react, useState, useSyncExternalStore },
    useState,
    useSyncExternalStore,
  };
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
  usePathname: () => "/owner",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const ownerPage = await import("../app/(console)/owner/page");
const auditPage = await import("../app/(console)/owner/audit/page");
const confirmPage = await import("../app/(console)/owner/confirm/page");
const { ChainStatus, ConfirmDesignation, ModuleSwitch, ProtectedAuditLog } =
  await import("../components/owner/owner-actions");
const client = await import("../lib/owner-client");
const { stepUp } = await import("../lib/staff-client");
const { navGroupsFor } = await import("../lib/navigation");

const EN = createTranslator("en");
const TR = createTranslator("tr");

// --- fixtures (as owner-en.test.tsx) ----------------------------------------------------------------

const OVERVIEW_PATH = "/api/v1/admin/owner/overview";
const BV = { id: "11111111-1111-4111-8111-111111111111", key: "BV", name: "Dream Petroleum BV" };
const CORP = {
  id: "22222222-2222-4222-8222-222222222222",
  key: "CORPORATE",
  name: "Dream Petroleum Corporate",
};
const state = (siteId: string, enabled: boolean, reason: string | null = null) => ({
  siteId,
  enabled,
  reason,
  updatedAt: reason ? "2026-11-12T09:30:00.000Z" : null,
});
const core = (key: string, name: string, description: string) => ({
  key,
  name,
  description,
  isCore: true,
  sites: [state(BV.id, true), state(CORP.id, true)],
});
const MODULES: OwnerOverviewResponse["modules"] = [
  core("rbac", "Roles and access", "RBAC, site scope, users and role assignments"),
  core("audit", "Audit trail", "Append-only audit events"),
  core("mfa", "Multi-factor authentication", "MFA enrolment, step-up and recovery"),
  core("platform", "Platform administration", "Sites and the God Mode module catalogue"),
  core("cms", "Content management", "Pages, sections, media and publishing"),
  core("catalog", "Product catalogue", "Products, technical data and documents"),
  core("leads", "Leads", "Contact and document-request leads"),
  core("membership", "Membership", "Member accounts and member-only technical data"),
  {
    key: "crm",
    name: "CRM",
    description: "Sales pipeline on top of leads (optional)",
    isCore: false,
    sites: [state(BV.id, true, "Pilot of the sales pipeline for BV"), state(CORP.id, false)],
  },
  {
    key: "automation",
    name: "Automation",
    description: "Rule-based follow-ups and notifications (optional)",
    isCore: false,
    sites: [state(BV.id, false, "Paused until the DPO review"), state(CORP.id, true, "Go-live")],
  },
  {
    key: "integrations",
    name: "Integrations",
    description: "Outbound integrations and webhooks (optional)",
    isCore: false,
    sites: [state(BV.id, false)],
  },
  {
    // A module the console has no text for yet: the API's name and description are shown.
    key: "billing",
    name: "Billing experiments",
    description: "Invoices and payment links (optional)",
    isCore: false,
    sites: [state(BV.id, false)],
  },
];
const HASH = "9f2c4e1ab37d5f60c8e2a14b7d93f0e6a5c1b8d4e7f20a3c6b9d1e4f7a0c3b6d";
const CHAIN_INTACT: OwnerChainStatus = {
  events: 128,
  intact: true,
  firstBrokenSeq: null,
  headSeq: 128,
  headHash: HASH,
  checkedAt: "2026-11-24T08:15:42.000Z",
};
const CHAIN_BROKEN: OwnerChainStatus = { ...CHAIN_INTACT, intact: false, firstBrokenSeq: 57 };
const CHAIN_EMPTY: OwnerChainStatus = { ...CHAIN_INTACT, events: 0, headSeq: 0, headHash: null };
const OWNER_EMAIL = "owner@dreampetroleum.example";
const overview = (over: Partial<OwnerOverviewResponse> = {}): OwnerOverviewResponse => ({
  owner: {
    id: "33333333-3333-4333-8333-333333333333",
    email: OWNER_EMAIL,
    displayName: "Eda Owner",
    designatedAt: "2026-11-12T23:10:00.000Z",
  },
  sites: [BV, CORP] as OwnerOverviewResponse["sites"],
  modules: MODULES,
  chain: CHAIN_INTACT,
  ...over,
});

let seq = 0;
const event = (over: Partial<ProtectedAuditEvent>): ProtectedAuditEvent => {
  seq += 1;
  return {
    id: `44444444-4444-4444-8444-${String(seq).padStart(12, "0")}`,
    chainSeq: 200 - seq,
    occurredAt: "2026-11-23T14:05:09.000Z",
    actorType: "USER",
    actorUserId: "33333333-3333-4333-8333-333333333333",
    actorLabel: "System owner",
    action: "owner.module_changed",
    resourceType: "feature_module",
    resourceId: "crm",
    scopeType: "SITE",
    siteId: BV.id,
    outcome: "SUCCESS",
    reason: null,
    metadata: {},
    rowHash: HASH,
    ...over,
  };
};
const EVENTS: ProtectedAuditEvent[] = [
  event({ reason: "Pilot of the sales pipeline for BV" }),
  event({ resourceId: "audit", outcome: "DENIED", reason: "core_module" }),
  event({ action: "owner.audit_chain_verified", resourceType: "audit_chain", resourceId: null }),
  event({
    action: "owner.recovery_issued",
    actorType: "SYSTEM",
    actorUserId: null,
    actorLabel: null,
    resourceType: "user",
    scopeType: "PLATFORM",
    siteId: null,
  }),
  event({
    action: "iam.mfa_challenge_failed",
    actorLabel: null,
    resourceType: "session",
    resourceId: null,
    scopeType: "PLATFORM",
    siteId: null,
    outcome: "FAILURE",
    reason: "invalid_code",
  }),
  event({
    action: "iam.bootstrap_admin",
    actorType: "BOOTSTRAP",
    actorUserId: null,
    actorLabel: null,
    resourceType: "user",
    scopeType: "PLATFORM",
    siteId: null,
  }),
];
const TOKEN = "A".repeat(20) + "b_c-" + "9".repeat(19);
const RETRY = async () => undefined;

// --- comparison helpers (as seo-i18n.test.tsx) ------------------------------------------------------

/** Names, codes and technical terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "CRM",
  // CRM-1: the module's name (a product name, the same in both languages).
  "CRM 360°",
  "SHA-256",
  "God Mode",
  "RBAC",
  "MFA",
  "Dream Petroleum BV",
  "Corporate",
]);

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");

function texts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of html.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

function fixtureData(states: unknown[] = []): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const v of reads.values()) walk(v);
  walk([EVENTS, BV, CORP, states]);
  // "resource type id" as an audit line shows it
  for (const e of EVENTS) if (e.resourceId) out.push(`${e.resourceType} ${e.resourceId}`);
  return out;
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  if (data.includes(text)) return true;
  // an audit line: actor · resource type id · reason, all from the event
  const parts = text.split(/\s*·\s*/).filter((p) => /[A-Za-z]{2,}/.test(p));
  return parts.length > 0 && parts.every((p) => SAME_IN_BOTH.has(p) || data.some((d) => d === p));
}

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

const ownerScreen: Render = () => ownerPage.default() as Promise<ReactElement>;
const auditScreen: Render = () => auditPage.default() as Promise<ReactElement>;
const confirmScreen: Render = () => confirmPage.default() as Promise<ReactElement>;
const crm = MODULES.find((m) => m.key === "crm")!;
const sw = (enabled: boolean, mod: Parameters<typeof ModuleSwitch>[0]["module"] = crm): Render =>
  function Switch() {
    return <ModuleSwitch module={mod} site={BV as never} enabled={enabled} />;
  };
const chain = (initial: OwnerChainStatus = CHAIN_INTACT): Render =>
  function Chain() {
    return <ChainStatus initial={initial} />;
  };
const log: Render = function Log() {
  return <ProtectedAuditLog />;
};
const confirm: Render = function Confirm() {
  return <ConfirmDesignation />;
};
const none = () => undefined;
const sws = (s: Partial<Record<"pending" | "open" | "reason" | "busy" | "message", unknown>>) => [
  s.pending ?? KEEP,
  s.open ?? KEEP,
  s.reason ?? KEEP,
  s.busy ?? KEEP,
  s.message ?? KEEP,
];

beforeEach(() => {
  reads.clear();
  queue.length = 0;
  frag.hash = undefined;
  reads.set(OVERVIEW_PATH, overview());
});
afterEach(() => vi.unstubAllGlobals());

// --- every screen and state -------------------------------------------------------------------------

describe("Owner area in Turkish: every screen and state", () => {
  const screens: [string, () => void, Render, unknown[]?][] = [
    ["owner console", none, ownerScreen],
    [
      "owner console, no display name, broken chain",
      () =>
        reads.set(
          OVERVIEW_PATH,
          overview({ owner: { ...overview().owner, displayName: null }, chain: CHAIN_BROKEN }),
        ),
      ownerScreen,
    ],
    [
      "owner console, empty chain",
      () => reads.set(OVERVIEW_PATH, overview({ chain: CHAIN_EMPTY })),
      ownerScreen,
    ],
    ["owner console, load error", () => reads.set(OVERVIEW_PATH, FAIL), ownerScreen],
    ["switch on", none, sw(true)],
    ["switch off", none, sw(false)],
    ["core module", none, sw(true, { key: "audit", name: "Audit trail", isCore: true })],
    ["switch-off form", none, sw(true), sws({ open: true })],
    [
      "switch-on form, filled, busy",
      none,
      sw(false),
      sws({ open: true, reason: "Pilot", busy: true }),
    ],
    [
      "switch form with an error",
      none,
      sw(true),
      sws({
        open: true,
        reason: "Pause",
        message: { kind: "error", text: TR("staff.api.rules.core_module") },
      }),
    ],
    [
      "switch step-up",
      none,
      sw(false),
      [...sws({ pending: RETRY, open: true, reason: "Pilot" }), "123456", true],
    ],
    ["chain intact", none, chain()],
    ["chain broken", none, chain(CHAIN_BROKEN)],
    ["chain empty", none, chain(CHAIN_EMPTY)],
    ["chain verifying", none, chain(), [KEEP, true]],
    ["chain step-up", none, chain(), [KEEP, KEEP, KEEP, RETRY]],
    ["audit page", none, auditScreen],
    ["audit before loading", none, log],
    ["audit loading", none, log, [KEEP, KEEP, KEEP, true]],
    ["audit step-up", none, log, [KEEP, KEEP, KEEP, KEEP, KEEP, RETRY]],
    ["audit empty", none, log, [[], null, true]],
    ["audit filled, older events", none, log, [EVENTS, 190, true]],
    ["confirm page", none, confirmScreen],
    ["confirm, no link", () => (frag.hash = ""), confirm],
    ["confirm, form", () => (frag.hash = `#t=${TOKEN}`), confirm],
    ["confirm, filled, busy", () => (frag.hash = `#t=${TOKEN}`), confirm, [KEEP, "secret", true]],
    ["confirm, step-up", () => (frag.hash = `#t=${TOKEN}`), confirm, [RETRY, "secret"]],
  ];

  it.each(screens)("%s", async (_name, setup, make, states = []) => {
    setup();
    const { en, tr, left } = await compare(make, states);
    expect(left, "English UI text left in Turkish").toEqual([]);
    expect(structure(tr)).toBe(structure(en));
    expect(tr).not.toBe(en);
  });
});

// --- details ---------------------------------------------------------------------------------------

describe("Owner area in Turkish: terms, data and formats", () => {
  it("translates module names by key and keeps an unknown module's API text", async () => {
    const tr = await render(ownerScreen, "tr");
    expect(tr).toContain("Sistem sahibi konsolu");
    expect(tr).toContain("Otomasyon");
    expect(tr).toContain("Entegrasyonlar");
    expect(tr).toContain("Her zaman açık (çekirdek): Roller ve erişim, Denetim kaydı");
    expect(tr).toContain("Billing experiments");
    expect(tr).toContain("Invoices and payment links (optional)");
    expect(tr).toContain("Son gerekçe: Pilot of the sales pipeline for BV");
    expect(tr).toContain("Devredilemez");
    // data stays as it is
    expect(tr).toContain(OWNER_EMAIL);
    expect(tr).toContain("Eda Owner");
    expect(tr).toContain(HASH);
    expect(tr).toContain("Dream Petroleum BV");
    // Turkish date in the company's time zone (13 Nov 00:10 in Amsterdam)
    expect(tr).toContain("13 Kas 2026");
    expect(await render(ownerScreen, "en")).toContain("13 Nov 2026");
  });

  it("names the switch with the translated module and the site's own name", async () => {
    const tr = await render(sw(true), "tr");
    expect(tr).toContain('aria-label="CRM 360° modülünü Dream Petroleum BV sitesinde kapat"');
    const form = await render(
      sw(
        false,
        MODULES.find((m) => m.key === "automation")!,
      ),
      "tr",
      sws({ open: true }),
    );
    expect(form).toContain('aria-label="Otomasyon modülünü değiştir"');
    expect(form).toContain("Korumalı denetim kaydına yazılır.");
  });

  it("keeps chain numbers and hashes, and formats the check time in Turkish", async () => {
    expect(await render(chain(CHAIN_BROKEN), "tr")).toContain("#57 numarada kırık");
    const tr = await render(chain(), "tr");
    expect(tr).toContain("Son hash (#128)");
    expect(tr).toContain(">128<");
    expect(tr).toContain("24 Kas 2026 09:15:42");
  });

  it("shows audit event codes unchanged and labels outcome and actor by code", async () => {
    const tr = await render(log, "tr", [EVENTS, 190, true]);
    for (const code of [
      "owner.module_changed",
      "owner.audit_chain_verified",
      "owner.recovery_issued",
      "iam.mfa_challenge_failed",
      "iam.bootstrap_admin",
      "feature_module",
      "core_module",
    ])
      expect(tr).toContain(code);
    for (const label of [
      "başarılı",
      "reddedildi",
      "başarısız",
      "sistem · user",
      "ilk kurulum · user",
      "kullanıcı · session",
    ])
      expect(tr).toContain(label);
    expect(tr).toContain("System owner · feature_module crm");
    expect(tr).toContain("Daha eski olaylar");
    expect(await render(log, "tr", [[], null, true])).toContain("Henüz korumalı olay yok.");
    expect(TR("owner.audit.outcome.DENIED")).toBe("reddedildi");
    expect(EN("owner.audit.actor.BOOTSTRAP")).toBe("bootstrap");
  });

  it("the designation confirmation: no link, success and refusals", async () => {
    frag.hash = "";
    expect(await render(confirm, "tr")).toContain("operatörden gelen onay bağlantısını");
    frag.hash = `#t=${TOKEN}`;
    const success = { kind: "success", text: TR("owner.confirm.success") };
    expect(await render(confirm, "tr", [KEEP, KEEP, KEEP, success])).toContain(
      "Artık sistem sahibisiniz.",
    );
    const form = await render(confirm, "tr");
    expect(form).toContain("Mevcut parolanız");
    expect(form).toContain("Atamayı onayla");
  });

  it("the owner client answers in the UI language; codes and paths stay the API's", async () => {
    const reply = (status: number, code: string, rule?: string) =>
      new Response(
        JSON.stringify({
          error: {
            code,
            message: "x",
            requestId: "r",
            details: rule ? [{ path: "enabled", rule }] : [],
          },
        }),
        { status, headers: { "content-type": "application/json" } },
      );
    vi.stubGlobal("document", { cookie: "dp-admin-locale=tr" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(400, "VALIDATION_FAILED", "core_module"))
      .mockResolvedValueOnce(reply(403, "AUTH_STEP_UP_REQUIRED"))
      .mockResolvedValueOnce(reply(404, "NOT_FOUND"))
      .mockResolvedValueOnce(new Response("not json", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(reply(400, "AUTH_TOKEN_INVALID"))
      .mockResolvedValueOnce(reply(409, "CONFLICT_STATE", "already_designated"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client.changeModule("crm", BV.id, false, "x")).toMatchObject({
      message: TR("staff.api.rules.core_module"),
    });
    expect(await client.verifyChain()).toMatchObject({
      stepUp: true,
      message: TR("errors.AUTH_STEP_UP_REQUIRED"),
    });
    expect(await client.protectedAudit(42)).toMatchObject({ message: TR("errors.NOT_FOUND") });
    expect(await client.protectedAudit()).toMatchObject({
      status: 502,
      message: "İstek başarısız oldu. Biraz sonra tekrar deneyin.",
    });
    expect(await client.verifyChain()).toMatchObject({
      status: 0,
      message: "Yönetim API'sine ulaşılamıyor.",
    });
    expect(await client.confirmDesignation(TOKEN, "p")).toMatchObject({
      message: TR("errors.AUTH_TOKEN_INVALID"),
    });
    expect(await client.confirmDesignation(TOKEN, "p")).toMatchObject({
      message: TR("staff.api.rules.already_designated"),
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `/api/v1/admin/owner/modules/crm/sites/${BV.id}`,
      "/api/v1/admin/owner/audit/verify",
      "/api/v1/admin/owner/audit?limit=50&before=42",
      "/api/v1/admin/owner/audit?limit=50",
      "/api/v1/admin/owner/audit/verify",
      "/api/v1/admin/owner/designation/confirm",
      "/api/v1/admin/owner/designation/confirm",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      token: TOKEN,
      password: "p",
    });
    // stepUp (staff-client) in Turkish too
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(400, "AUTH_MFA_INVALID")));
    expect(await stepUp("1")).toMatchObject({ message: TR("errors.AUTH_MFA_INVALID") });
  });

  it("the system owner is not the platform super admin, in Turkish too", async () => {
    ui.locale = "tr";
    for (const v of [FORBIDDEN, undefined]) {
      if (v) reads.set(OVERVIEW_PATH, v);
      else reads.delete(OVERVIEW_PATH);
      await expect(ownerPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(auditPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(navGroupsFor(true).flatMap((g) => g.items.map((i) => i.href))).toContain("/owner");
    expect(navGroupsFor(false).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/owner");
    // The confirmation page is open to the named staff member (the API decides who may confirm).
    expect(await render(confirmScreen, "tr")).toContain("Sistem sahibi atamasını onaylayın");
  });

  it("page titles in both languages", async () => {
    for (const [locale, expected] of [
      ["en", ["Owner console", "Protected audit trail", "Confirm owner designation"]],
      [
        "tr",
        ["Sistem sahibi konsolu", "Korumalı denetim kaydı", "Sistem sahibi atamasını onaylayın"],
      ],
    ] as const) {
      ui.locale = locale;
      expect([
        (await ownerPage.generateMetadata()).title,
        (await auditPage.generateMetadata()).title,
        (await confirmPage.generateMetadata()).title,
      ]).toEqual(expected);
    }
  });

  it("EN and TR dictionaries have the same keys", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "string" ? [`${p}${k}`] : keys(v as object, `${p}${k}.`),
      );
    expect(keys(OWNER_TR).sort()).toEqual(keys(OWNER_EN).sort());
    expect(keys(OWNER_EN).length).toBeGreaterThan(80);
  });
});
