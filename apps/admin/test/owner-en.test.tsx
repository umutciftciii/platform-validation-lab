// ML-12e (DP-243) EN regression of the system owner area (DP-108/DP-110, ADR-018): Admin > Owner
// console (system owner panel, optional module switches per site with every state, core modules,
// the protected audit chain), Owner > Protected audit trail (load, step-up, empty, filled, older
// pages) and Owner > Confirm designation (no link, malformed link, the form, every refusal of the
// API, the step-up prompt and the success notice) plus the owner client's messages. Every render
// goes through support/en-baseline-render: it is compared with the HTML recorded on private main
// 10dec17 (before ML-12e) in fixtures/catalog-en/owner-en.json.gz (record with ML12E_RECORD_EN=1,
// this file only).
//
// The system owner is not the platform super admin: every owner route answers 404 to anyone but
// the designated owner (a super admin included), so the owner pages call notFound() and the
// owner console is missing from the navigation of everybody else.
//
// The client parts keep their state in useState. A static render shows only the first state, so
// `react`'s useState is replaced here by a queue: a test lists the states the next components start
// in (in render order; KEEP = the component's own initial value). The confirmation link is read from
// the URL fragment with useSyncExternalStore; `hash` replaces it (KEEP = the server snapshot, null).
import type {
  OwnerChainStatus,
  OwnerOverviewResponse,
  ProtectedAuditEvent,
} from "@dream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "./support/en-baseline-render";

const KEEP = Symbol("keep");
const queue: unknown[] = [];
let hash: unknown = KEEP;
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const initial = typeof init === "function" ? (init as () => unknown)() : init;
    const next = queue.length ? queue.shift() : KEEP;
    return [next === KEEP ? initial : next, () => undefined];
  };
  const useSyncExternalStore = (...args: Parameters<typeof react.useSyncExternalStore>) =>
    hash === KEEP ? react.useSyncExternalStore(...args) : hash;
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
  cookies: async () => ({ get: () => undefined, has: () => false }),
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
const { default: NotFound } = await import("../app/not-found");
const { ChainStatus, ConfirmDesignation, ModuleSwitch, ProtectedAuditLog } =
  await import("../components/owner/owner-actions");
const client = await import("../lib/owner-client");
const { stepUp } = await import("../lib/staff-client");
const { navGroupsFor } = await import("../lib/navigation");

// --- fixtures -------------------------------------------------------------------------------------

const OVERVIEW_PATH = "/api/v1/admin/owner/overview";
const BV = { id: "11111111-1111-4111-8111-111111111111", key: "BV", name: "Dream Petroleum BV" };
const CORP = {
  id: "22222222-2222-4222-8222-222222222222",
  key: "CORPORATE",
  name: "Dream Petroleum Corporate",
};
const SITES = [BV, CORP] as OwnerOverviewResponse["sites"];
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
  core("leads", "Leads", "Contact and document-request leads"),
  {
    key: "crm",
    name: "CRM",
    description: "Sales pipeline on top of leads (optional)",
    isCore: false,
    // On for BV after a change; never switched on Corporate.
    sites: [state(BV.id, true, "Pilot of the sales pipeline for BV"), state(CORP.id, false)],
  },
  {
    key: "automation",
    name: "Automation",
    description: "Rule-based follow-ups and notifications (optional)",
    isCore: false,
    // Switched off again on BV; on for Corporate.
    sites: [state(BV.id, false, "Paused until the DPO review"), state(CORP.id, true, "Go-live")],
  },
  {
    key: "integrations",
    name: "Integrations",
    description: "Outbound integrations and webhooks (optional)",
    isCore: false,
    // No state row for Corporate at all: shown as off.
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
const CHAIN_EMPTY: OwnerChainStatus = {
  events: 0,
  intact: true,
  firstBrokenSeq: null,
  headSeq: 0,
  headHash: null,
  checkedAt: "2026-11-24T08:15:42.000Z",
};
const overview = (over: Partial<OwnerOverviewResponse> = {}): OwnerOverviewResponse => ({
  owner: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "owner@dreampetroleum.example",
    displayName: "Eda Owner",
    designatedAt: "2026-11-12T23:10:00.000Z",
  },
  sites: SITES,
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
    occurredAt: `2026-11-2${seq % 4}T1${seq % 10}:0${seq % 6}:3${seq % 10}.000Z`,
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
    action: "owner.access_denied",
    actorLabel: "admin@dreampetroleum.example",
    actorUserId: "55555555-5555-4555-8555-555555555555",
    resourceType: "owner_console",
    resourceId: null,
    scopeType: "PLATFORM",
    siteId: null,
    outcome: "DENIED",
    reason: "not_owner",
  }),
  event({
    action: "owner.designated",
    resourceType: "user",
    resourceId: "33333333-3333-4333-8333-333333333333",
    scopeType: "PLATFORM",
    siteId: null,
  }),
  event({
    action: "owner.designation_denied",
    actorLabel: null,
    resourceType: "user",
    resourceId: "33333333-3333-4333-8333-333333333333",
    scopeType: "PLATFORM",
    siteId: null,
    outcome: "DENIED",
    reason: "wrong_password",
  }),
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
    action: "iam.login_succeeded",
    resourceType: "session",
    resourceId: null,
    scopeType: "PLATFORM",
    siteId: null,
  }),
  event({
    action: "iam.mfa_challenge_failed",
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

const TOKEN = "A".repeat(20) + "b_c-" + "9".repeat(19); // 43 characters, as the operator CLI prints
const RETRY = async () => undefined;

/** One API answer for the browser client: a JSON error body, a JSON body, or offline. */
type Answer =
  | { status: number; code: string; rule?: string }
  | { status: number; body: unknown }
  | { status: number; text: string }
  | "offline";
const respond = (a: Answer) => {
  if (a === "offline") return Promise.reject(new TypeError("Failed to fetch"));
  if ("text" in a) return Promise.resolve(new Response(a.text, { status: a.status }));
  const body =
    "body" in a
      ? a.body
      : {
          error: {
            code: a.code,
            message: "x",
            requestId: "r",
            details: a.rule ? [{ path: "enabled", rule: a.rule }] : [],
          },
        };
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: a.status,
      headers: { "content-type": "application/json" },
    }),
  );
};
async function call<T>(answer: Answer, fn: () => Promise<T>): Promise<T> {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => respond(answer)),
  );
  try {
    return await fn();
  } finally {
    vi.unstubAllGlobals();
  }
}
const message = async (answer: Answer, fn: () => Promise<{ ok: boolean }>) => {
  const res = (await call(answer, fn)) as { ok: true } | { ok: false; message: string };
  return res.ok ? "ok" : res.message;
};

const record = (value: unknown) =>
  renderToStaticMarkup(<pre>{JSON.stringify(value, null, 1)}</pre>);

const owner = async () => renderToStaticMarkup(await ownerPage.default());
const audit = async () => renderToStaticMarkup(await auditPage.default());

beforeEach(() => {
  reads.clear();
  queue.length = 0;
  hash = KEEP;
});
afterEach(() => vi.unstubAllGlobals());

// --- Owner console ----------------------------------------------------------------------------------

describe("Owner console (EN)", () => {
  it("shows the system owner, the module switches per site and the audit chain", async () => {
    reads.set(OVERVIEW_PATH, overview());
    const html = await owner();
    expect(html).toContain("Owner console");
    expect(html).toContain("Not transferable");
    expect(html).toContain("Last reason: Pilot of the sales pipeline for BV");
    expect(html).toContain("Always on (core): Roles and access, Audit trail");
    expect(html).toContain("Protected audit chain");
  });

  it("an owner without a display name, a broken chain and an empty chain", async () => {
    reads.set(
      OVERVIEW_PATH,
      overview({
        owner: { ...overview().owner, displayName: null },
        chain: CHAIN_BROKEN,
      }),
    );
    expect(await owner()).toContain("Broken at #57");
    reads.set(OVERVIEW_PATH, overview({ chain: CHAIN_EMPTY }));
    expect(await owner()).toContain("Head hash (#0)");
  });

  it("only core modules, and only one site", async () => {
    reads.set(OVERVIEW_PATH, overview({ modules: MODULES.filter((m) => m.isCore) }));
    await owner();
    reads.set(
      OVERVIEW_PATH,
      overview({
        sites: [BV] as OwnerOverviewResponse["sites"],
        modules: MODULES.map((m) => ({ ...m, sites: m.sites.filter((s) => s.siteId === BV.id) })),
      }),
    );
    await owner();
  });

  it("a load error (500)", async () => {
    reads.set(OVERVIEW_PATH, FAIL);
    expect(await owner()).toContain("The owner console could not be loaded");
  });

  it("does not exist for anyone but the owner, a platform super admin included (403/404)", async () => {
    // The API answers 404 to every other staff member, the platform super admin included.
    await expect(ownerPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
    reads.set(OVERVIEW_PATH, FORBIDDEN);
    await expect(ownerPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
    // …so the super admin sees the ordinary not-found page.
    expect(renderToStaticMarkup(await NotFound())).toContain("404");
    // The owner console is in the navigation of the owner only.
    // ML-13b (DP-244): Translations is the one entry added since the recording, for everyone.
    const hrefs = (owner: boolean) =>
      navGroupsFor(owner).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(true)).toContain("/translations");
    expect(hrefs(false)).toContain("/translations");
    const recorded = (owner: boolean) => hrefs(owner).filter((h) => h !== "/translations");
    record({ owner: recorded(true), superAdmin: recorded(false) });
  });

  it("page titles", async () => {
    // ML-12e: `metadata` became `generateMetadata()` (UI language); the English titles are the same.
    record({
      owner: (await ownerPage.generateMetadata()).title,
      audit: (await auditPage.generateMetadata()).title,
      confirm: (await confirmPage.generateMetadata()).title,
    });
  });
});

// --- Module switch states ---------------------------------------------------------------------------

describe("Module switch states (EN)", () => {
  const crm = MODULES.find((m) => m.key === "crm")!;
  const sw = (enabled: boolean, mod: Parameters<typeof ModuleSwitch>[0]["module"] = crm) =>
    renderToStaticMarkup(<ModuleSwitch module={mod} site={BV as never} enabled={enabled} />);
  // ModuleSwitch: step-up pending, open, reason, busy, message; then the step-up prompt: code, busy, error.
  const states = (
    s: Partial<Record<"pending" | "open" | "reason" | "busy" | "message", unknown>>,
  ) => [s.pending ?? KEEP, s.open ?? KEEP, s.reason ?? KEEP, s.busy ?? KEEP, s.message ?? KEEP];

  it("on, off and a core module", () => {
    sw(true);
    sw(false);
    expect(sw(true, { key: "audit", name: "Audit trail", isCore: true })).toContain("Always on");
  });

  it("the reason form for switching off and on, empty, filled and busy", () => {
    for (const [enabled, s] of [
      [true, { open: true }],
      [false, { open: true }],
      [true, { open: true, reason: "Pause during the audit" }],
      [false, { open: true, reason: "ok" }],
      [false, { open: true, reason: "Pilot for BV", busy: true }],
    ] as const) {
      queue.push(...states(s));
      sw(enabled);
    }
  });

  it("refusals of the API in the reason form", async () => {
    const change = () => client.changeModule("crm", BV.id, false, "Pause");
    for (const answer of [
      { status: 400, code: "VALIDATION_FAILED", rule: "core_module" },
      { status: 400, code: "VALIDATION_FAILED", rule: "reason_required" },
      { status: 400, code: "VALIDATION_FAILED", rule: "unknown_module" },
      { status: 404, code: "NOT_FOUND" },
      { status: 403, code: "FORBIDDEN" },
      { status: 429, code: "RATE_LIMITED" },
      "offline",
    ] as const) {
      const text = await message(answer, change);
      queue.push(...states({ open: true, reason: "Pause", message: { kind: "error", text } }));
      sw(true);
    }
  });

  it("asks for the authenticator (step-up), filled, busy and with an error", async () => {
    const wrong = await message({ status: 400, code: "AUTH_MFA_INVALID" }, () => stepUp("000000"));
    const throttled = await message({ status: 429, code: "RATE_LIMITED" }, () => stepUp("000000"));
    for (const prompt of [
      [KEEP, KEEP, KEEP],
      ["123 456", KEEP, KEEP],
      ["123456", true, KEEP],
      ["000000", KEEP, wrong],
      ["000000", KEEP, throttled],
    ]) {
      queue.push(...states({ pending: RETRY, open: true, reason: "Pilot for BV" }), ...prompt);
      sw(false);
    }
    // The prompt also shows when the form is closed again.
    queue.push(...states({ pending: RETRY }));
    sw(true);
  });
});

// --- Chain verification -----------------------------------------------------------------------------

describe("Audit chain states (EN)", () => {
  // ChainStatus: status, busy, error, step-up pending; then the step-up prompt.
  const chain = (initial: OwnerChainStatus = CHAIN_INTACT) =>
    renderToStaticMarkup(<ChainStatus initial={initial} />);

  it("intact, broken and empty", () => {
    chain();
    chain(CHAIN_BROKEN);
    chain(CHAIN_EMPTY);
  });

  it("verifying, a failed verification and the step-up", async () => {
    queue.push(KEEP, true);
    chain();
    for (const answer of [
      { status: 429, code: "RATE_LIMITED" },
      { status: 404, code: "NOT_FOUND" },
      { status: 500, text: "not json" },
      "offline",
    ] as const) {
      const text = await message(answer, client.verifyChain);
      queue.push(KEEP, KEEP, text);
      chain();
    }
    queue.push(KEEP, KEEP, KEEP, RETRY);
    chain();
    // A fresh result after verifying: broken.
    queue.push(CHAIN_BROKEN);
    chain();
  });
});

// --- Protected audit trail --------------------------------------------------------------------------

describe("Protected audit trail (EN)", () => {
  // ProtectedAuditLog: items, next, loaded, busy, error, step-up pending; then the step-up prompt.
  const log = () => renderToStaticMarkup(<ProtectedAuditLog />);

  it("the page for the owner, and 403/404/500 for everyone else", async () => {
    reads.set(OVERVIEW_PATH, overview());
    const html = await audit();
    expect(html).toContain("Protected audit trail");
    expect(html).toContain("Load protected events");
    for (const v of [FORBIDDEN, FAIL]) {
      reads.set(OVERVIEW_PATH, v);
      await expect(auditPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    reads.delete(OVERVIEW_PATH);
    await expect(auditPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("before loading, loading, asking for the authenticator and an error", async () => {
    log();
    queue.push(KEEP, KEEP, KEEP, true);
    log();
    queue.push(KEEP, KEEP, KEEP, KEEP, KEEP, RETRY);
    log();
    queue.push(KEEP, KEEP, KEEP, KEEP, KEEP, RETRY, "123456", true);
    log();
    for (const answer of [
      { status: 400, code: "VALIDATION_FAILED", rule: "range" },
      { status: 404, code: "NOT_FOUND" },
      { status: 429, code: "RATE_LIMITED" },
      "offline",
    ] as const) {
      const text = await message(answer, () => client.protectedAudit());
      queue.push(KEEP, KEEP, KEEP, KEEP, text);
      log();
    }
  });

  it("empty, filled, with older events and loading them", () => {
    queue.push([], null, true);
    expect(log()).toContain("No protected events yet.");
    queue.push(EVENTS, 190, true);
    expect(log()).toContain("Older events");
    queue.push(EVENTS, 190, true, true);
    log();
    queue.push(EVENTS.slice(0, 3), null, true);
    log();
    // A failed older page keeps the list.
    queue.push(EVENTS.slice(0, 2), 198, true, KEEP, "Too many attempts. Please try again later.");
    log();
  });
});

// --- Designation confirmation -----------------------------------------------------------------------

describe("Owner designation confirmation (EN)", () => {
  // ConfirmDesignation: step-up pending, password, busy, message; then the step-up prompt.
  const confirm = () => renderToStaticMarkup(<ConfirmDesignation />);

  it("the page, waiting for the link in the browser", async () => {
    const html = renderToStaticMarkup(await confirmPage.default());
    expect(html).toContain("Confirm owner designation");
    confirm();
  });

  it("without a link and with a malformed link", () => {
    for (const h of ["", "#", "#t=short", "#x=1", `#t=${TOKEN}x`]) {
      hash = h;
      expect(confirm()).toContain("needs the confirmation link from the operator");
    }
  });

  it("the form, empty, filled and busy, also with more in the fragment", () => {
    for (const h of [`#t=${TOKEN}`, `#a=1&t=${TOKEN}&b=2`]) {
      hash = h;
      confirm();
    }
    hash = `#t=${TOKEN}`;
    queue.push(KEEP, "secret");
    confirm();
    queue.push(KEEP, "secret", true);
    confirm();
  });

  it("every refusal: wrong password, invalid or expired link, already designated, not eligible", async () => {
    hash = `#t=${TOKEN}`;
    const confirmCall = () => client.confirmDesignation(TOKEN, "secret");
    for (const answer of [
      { status: 401, code: "AUTH_INVALID_CREDENTIALS" },
      // Expired, used, invalidated after five attempts or not issued for this account: one answer.
      { status: 400, code: "AUTH_TOKEN_INVALID" },
      { status: 409, code: "CONFLICT_STATE", rule: "already_designated" },
      { status: 409, code: "CONFLICT_STATE", rule: "not_eligible" },
      { status: 409, code: "CONFLICT_STATE", rule: "unknown" },
      { status: 429, code: "RATE_LIMITED" },
      { status: 403, code: "FORBIDDEN" },
      { status: 500, text: "not json" },
      "offline",
    ] as const) {
      const text = await message(answer, confirmCall);
      queue.push(KEEP, KEEP, KEEP, { kind: "error", text });
      confirm();
    }
  });

  it("asks for the authenticator (step-up)", async () => {
    hash = `#t=${TOKEN}`;
    queue.push(RETRY, "secret");
    confirm();
    const wrong = await message({ status: 400, code: "AUTH_MFA_INVALID" }, () => stepUp("1"));
    queue.push(RETRY, "secret", KEEP, KEEP, "111111", KEEP, wrong);
    confirm();
  });

  it("the success notice, after the token left the address bar", () => {
    for (const h of ["", `#t=${TOKEN}`, KEEP]) {
      hash = h;
      queue.push(KEEP, KEEP, KEEP, {
        kind: "success",
        text: "You are now the system owner. The owner console is in the navigation.",
      });
      expect(confirm()).toContain("You are now the system owner.");
    }
  });
});

// --- Client messages --------------------------------------------------------------------------------

describe("Owner client messages (EN)", () => {
  it("every answer of the owner API in plain words", async () => {
    const answers: Answer[] = [
      { status: 200, body: { ok: true } },
      { status: 400, code: "VALIDATION_FAILED", rule: "core_module" },
      { status: 400, code: "VALIDATION_FAILED", rule: "reason_required" },
      { status: 400, code: "VALIDATION_FAILED", rule: "unknown_module" },
      { status: 400, code: "VALIDATION_FAILED", rule: "range" },
      { status: 400, code: "VALIDATION_FAILED" },
      { status: 401, code: "AUTH_INVALID_CREDENTIALS" },
      { status: 400, code: "AUTH_TOKEN_INVALID" },
      { status: 400, code: "AUTH_MFA_INVALID" },
      { status: 401, code: "AUTH_SESSION_REQUIRED" },
      { status: 403, code: "AUTH_STEP_UP_REQUIRED" },
      { status: 403, code: "FORBIDDEN" },
      { status: 404, code: "NOT_FOUND" },
      { status: 409, code: "CONFLICT_STATE", rule: "already_designated" },
      { status: 409, code: "CONFLICT_STATE", rule: "not_eligible" },
      { status: 409, code: "CONFLICT_STATE", rule: "unknown" },
      { status: 429, code: "RATE_LIMITED" },
      { status: 500, code: "INTERNAL_ERROR" },
      { status: 500, code: "SOMETHING_NEW" },
      { status: 502, text: "not json" },
      "offline",
    ];
    const calls: [string, () => Promise<unknown>][] = [
      ["changeModule", () => client.changeModule("crm", BV.id, true, "Pilot")],
      ["verifyChain", client.verifyChain],
      ["protectedAudit", () => client.protectedAudit(42)],
      ["confirmDesignation", () => client.confirmDesignation(TOKEN, "secret")],
      ["stepUp", () => stepUp("123456")],
    ];
    const out: Record<string, string[]> = {};
    for (const [name, fn] of calls) {
      out[name] = [];
      for (const answer of answers) {
        const res = (await call(answer, fn)) as
          { ok: true } | { ok: false; status: number; message: string; stepUp: boolean };
        out[name].push(
          res.ok ? "ok" : `${res.status} ${res.message}${res.stepUp ? " [step-up]" : ""}`,
        );
      }
    }
    record(out);
  });
});
