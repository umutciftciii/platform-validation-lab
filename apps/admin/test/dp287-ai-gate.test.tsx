// DP-287 (ADR-030 D1, D2): the global AI switch in the Owner Console and the AI Center route.
//   1. The Owner Console lists the AI Center under "Platform modules" with ONE platform-wide
//      switch (no per-site column), in English and Turkish.
//   2. The AI Center page exists only while the session's `features.aiCenter` is on; otherwise
//      (and when the API answers 404 or 403) it is the console's 404. It has no button.
//   3. The owner client calls the platform route.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerOverviewResponse, StaffSessionResponse } from "@dream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = vi.hoisted(() => new Map<string, unknown>());
const session = vi.hoisted(() => ({ value: {} as Partial<StaffSessionResponse> }));
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
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => session.value }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/owner",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const ownerPage = await import("../app/(console)/owner/page");
const aiPage = await import("../app/(console)/ai/page");
const client = await import("../lib/owner-client");

const BV = { id: "11111111-1111-4111-8111-111111111111", key: "BV", name: "Dream Petroleum BV" };
const CORP = {
  id: "22222222-2222-4222-8222-222222222222",
  key: "CORPORATE",
  name: "Dream Petroleum Corporate",
};
const OVERVIEW_PATH = "/api/v1/admin/owner/overview";
const AI_PATH = "/api/v1/admin/ai/overview";

function overview(aiEnabled: boolean): OwnerOverviewResponse {
  return {
    owner: {
      id: "33333333-3333-4333-8333-333333333333",
      email: "owner@example.test",
      displayName: "Owner",
      designatedAt: "2026-11-12T08:51:00.000Z",
    },
    sites: [BV, CORP] as OwnerOverviewResponse["sites"],
    modules: [
      {
        key: "cms",
        name: "Content management",
        description: "Pages, sections, media and publishing",
        isCore: true,
        sites: [BV.id, CORP.id].map((siteId) => ({
          siteId,
          enabled: true,
          reason: null,
          updatedAt: null,
        })),
      },
      {
        key: "crm",
        name: "CRM",
        description: "Sales pipeline on top of leads (optional)",
        isCore: false,
        sites: [BV.id, CORP.id].map((siteId) => ({
          siteId,
          enabled: false,
          reason: null,
          updatedAt: null,
        })),
      },
      {
        key: "ai",
        name: "AI Center",
        description: "AI providers, models, budgets and usage",
        isCore: false,
        scope: "PLATFORM",
        platform: {
          enabled: aiEnabled,
          reason: aiEnabled ? "Pilot of the AI Center" : "DP-287: off by default (ADR-030 D1)",
          updatedAt: "2026-11-26T10:00:00.000Z",
          version: aiEnabled ? 2 : 1,
        },
        sites: [],
      },
    ],
    chain: {
      events: 3,
      intact: true,
      firstBrokenSeq: null,
      headSeq: 3,
      headHash: "a".repeat(64),
      checkedAt: "2026-11-26T10:00:00.000Z",
    },
  };
}

async function render(page: () => Promise<ReactElement>, locale: AdminLocale = "en") {
  ui.locale = locale;
  const el = await page();
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{el}</LocaleProvider>);
}

/** The text of the panel with this id: up to the next panel (Panel renders a <section>). */
function panel(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const end = html.indexOf("<section", start);
  return html
    .slice(start, end === -1 ? undefined : end)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

beforeEach(() => {
  reads.clear();
  session.value = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("DP-287: the AI switch in the Owner Console", () => {
  it("shows the AI Center once, under Platform modules, off by default, with a platform-wide switch", async () => {
    reads.set(OVERVIEW_PATH, overview(false));
    const html = await render(() => ownerPage.default());
    const platform = panel(html, "platform-modules");
    expect(platform).toContain("Platform modules");
    expect(platform).toContain("AI Center");
    expect(platform).toContain("Platform-wide");
    expect(platform).toContain("Off");
    expect(platform).toContain("Switch on");
    expect(platform).not.toContain("Dream Petroleum");
    expect(html).toContain('aria-label="Switch on AI Center for the whole platform"');
    // Not in the per-site table.
    expect(panel(html, "modules")).not.toContain("AI Center");
  });

  it("shows the state the owner set, in English and Turkish", async () => {
    reads.set(OVERVIEW_PATH, overview(true));
    const en = await render(() => ownerPage.default());
    expect(panel(en, "platform-modules")).toContain("Last reason: Pilot of the AI Center");
    expect(en).toContain('aria-label="Switch off AI Center for the whole platform"');
    const tr = await render(() => ownerPage.default(), "tr");
    const trPanel = panel(tr, "platform-modules");
    expect(trPanel).toContain("Platform modülleri");
    expect(trPanel).toContain("Yapay Zekâ Merkezi");
    expect(trPanel).toContain("Tüm platform");
    expect(tr).toContain('aria-label="Yapay Zekâ Merkezi modülünü tüm platformda kapat"');
  });

  it("posts the platform switch to the platform route", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ module: overview(true).modules[2], changed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await client.changePlatformModule("ai", true, "Pilot of the AI Center");
    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      {
        url: "/api/v1/admin/owner/modules/ai/platform",
        body: { enabled: true, reason: "Pilot of the AI Center" },
      },
    ]);
  });
});

describe("DP-287: the AI Center route", () => {
  const OVERVIEW = {
    enabled: true,
    callsPossible: false,
    blockers: ["no_provider_key", "no_enabled_model", "no_budget"],
  };

  it("is a 404 while the session's aiCenter feature is off or missing, without asking the API", async () => {
    reads.set(AI_PATH, OVERVIEW);
    for (const value of [{}, { features: { aiCenter: false } }]) {
      session.value = value;
      await expect(render(() => aiPage.default())).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("is a 404 when the API answers 404 (AI went off) or 403", async () => {
    session.value = { features: { aiCenter: true } };
    await expect(render(() => aiPage.default())).rejects.toThrow("NEXT_NOT_FOUND");
    reads.set(AI_PATH, FORBIDDEN);
    await expect(render(() => aiPage.default())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the state and why no AI call is possible, with no button (EN, TR)", async () => {
    session.value = { features: { aiCenter: true } };
    reads.set(AI_PATH, OVERVIEW);
    const en = await render(() => aiPage.default());
    expect(en).not.toContain("<button");
    const calls = panel(en, "ai-calls");
    expect(calls).toContain("No AI call is possible");
    expect(calls).toContain("OpenAI, Claude or Gemini");
    expect(calls).toContain("A daily and a monthly budget");
    expect(panel(en, "ai-state")).toContain("AI is on");
    const tr = await render(() => aiPage.default(), "tr");
    expect(panel(tr, "ai-calls")).toContain("Yapay zekâ çağrısı yapılamaz");
    expect(panel(tr, "ai-calls")).toContain("Günlük ve aylık bütçe");
    expect(tr).not.toContain("<button");
  });

  it("shows an error state when the API fails", async () => {
    session.value = { features: { aiCenter: true } };
    reads.set(AI_PATH, FAIL);
    const html = await render(() => aiPage.default());
    expect(html).toContain("The AI Center could not be loaded");
  });
});
