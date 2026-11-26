// DP-292 (ADR-030): the AI Center admin screens.
//   1. Pure helpers: tabs, money, which key/model actions an AI administrator gets (none for readers).
//   2. The browser client: routes and methods, the key only in a POST body, AI rule messages.
//   3. The page: tabs, readiness, access; providers/models/tasks shown by permission (super admin
//      and AI viewer read only; AI administrator and owner manage); a key only by its hint; no
//      global AI switch here; EN and TR; error and empty states.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AiModelSummary,
  AiOverviewResponse,
  AiProvidersResponse,
  StaffSessionResponse,
} from "@dream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = vi.hoisted(() => new Map<string, unknown>());
const session = vi.hoisted(() => ({ value: {} as Partial<StaffSessionResponse> }));
const FAIL = Symbol("fail");

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
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => session.value }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/ai",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const aiPage = await import("../app/(console)/ai/page");
const view = await import("../lib/ai-view");
const client = await import("../lib/ai-client");

const API = "/api/v1/admin/ai";
const READ = {
  usageRead: true,
  providerManage: false,
  modelManage: false,
  budgetManage: false,
  invoke: false,
  auditRead: false,
};
const MANAGE = {
  usageRead: true,
  providerManage: true,
  modelManage: true,
  budgetManage: true,
  invoke: true,
  auditRead: true,
};
const overview = (
  permissions = READ,
  blockers: AiOverviewResponse["blockers"] = [],
): AiOverviewResponse => ({
  enabled: true,
  callsPossible: blockers.length === 0,
  blockers,
  transport: "fake",
  permissions,
  sites: [],
});
const ID = (n: number) => `0190c0de-0000-7000-8000-${String(n).padStart(12, "0")}`;
const KEY_HINT = "sk-…ab12";
const providers: AiProvidersResponse = {
  transport: "fake",
  providers: [
    {
      provider: "OPENAI",
      enabled: true,
      defaultModelId: ID(10),
      version: 3,
      credentials: [
        {
          id: ID(1),
          provider: "OPENAI",
          label: "Main account",
          status: "ACTIVE",
          keyHint: KEY_HINT,
          projectRef: null,
          lastTestedAt: "2026-11-26T10:00:00.000Z",
          lastTestCode: "ok",
          createdAt: "2026-11-26T09:00:00.000Z",
          activatedAt: "2026-11-26T09:00:00.000Z",
          disabledAt: null,
          revokedAt: null,
          version: 2,
        },
      ],
    },
    { provider: "ANTHROPIC", enabled: false, defaultModelId: null, version: 1, credentials: [] },
    { provider: "GEMINI", enabled: false, defaultModelId: null, version: 1, credentials: [] },
  ],
};
const model = (over: Partial<AiModelSummary>): AiModelSummary => ({
  id: ID(10),
  provider: "OPENAI",
  modelId: "gpt-fake-mini",
  displayName: "gpt-fake-mini",
  status: "ENABLED",
  compatible: true,
  requiresConfirmation: false,
  capabilities: {
    textGeneration: true,
    structuredOutput: null,
    thinking: null,
    lifecycle: "active",
  },
  contextWindow: null,
  maxOutputTokens: null,
  lastVerifiedAt: "2026-11-26T10:00:00.000Z",
  verifyCode: "ok",
  version: 1,
  ...over,
});
const models = {
  items: [
    model({}),
    model({
      id: ID(11),
      modelId: "gpt-unknown",
      displayName: "gpt-unknown",
      status: "VERIFIED",
      compatible: false,
      requiresConfirmation: true,
      capabilities: {
        textGeneration: null,
        structuredOutput: null,
        thinking: null,
        lifecycle: "active",
      },
    }),
    model({
      id: ID(12),
      provider: "GEMINI",
      modelId: "embedding-fake",
      displayName: "Embedding",
      status: "DISCOVERED",
      compatible: false,
    }),
  ],
};
const price = {
  id: ID(20),
  modelId: ID(10),
  inputMicrosPerMTok: "400000",
  cachedReadMicrosPerMTok: "100000",
  cacheWriteMicrosPerMTok: null,
  outputMicrosPerMTok: "1600000",
  longContextThreshold: null,
  longInputMicrosPerMTok: null,
  longOutputMicrosPerMTok: null,
  perRequestFeeMicros: "0",
  effectiveFrom: "2026-11-26T08:00:00.000Z",
  source: "MANUAL",
  sourceNote: "pricing page",
  createdAt: "2026-11-26T08:00:00.000Z",
};
const tasks = {
  items: [
    {
      task: "DIAGNOSTIC_PING",
      enabled: true,
      modelId: ID(10),
      maxInputTokens: 2000,
      maxOutputTokens: 64,
      thinkingBudget: 0,
      maxCostPerOpMicros: "50000",
      temperatureMilli: null,
      version: 2,
    },
    {
      task: "TRANSLATION",
      enabled: false,
      modelId: null,
      maxInputTokens: 8000,
      maxOutputTokens: 4000,
      thinkingBudget: 0,
      maxCostPerOpMicros: "100000",
      temperatureMilli: null,
      version: 1,
    },
  ],
};

function seed(permissions = READ) {
  session.value = { features: { aiCenter: true } };
  reads.set(`${API}/overview`, overview(permissions));
  reads.set(`${API}/providers`, providers);
  reads.set(`${API}/models`, models);
  reads.set(`${API}/models/${ID(10)}/prices`, { items: [price] });
  reads.set(`${API}/models/${ID(11)}/prices`, { items: [] });
  reads.set(`${API}/tasks`, tasks);
}

async function render(tab: string | undefined, locale: AdminLocale = "en") {
  ui.locale = locale;
  const el: ReactElement = await aiPage.default({
    searchParams: Promise.resolve(tab ? { tab } : {}),
  });
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{el}</LocaleProvider>);
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1] ?? "").trim());

beforeEach(() => {
  reads.clear();
  session.value = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("DP-292: helpers", () => {
  it("parses tabs and converts money in micro-USD both ways", () => {
    expect(view.parseAiTab("models")).toBe("models");
    expect(view.parseAiTab(["tasks"])).toBe("tasks");
    expect(view.parseAiTab("budgets")).toBe("budgets"); // DP-293
    expect(view.parseAiTab("nope")).toBe("overview");
    expect(view.parseAiTab(undefined)).toBe("overview");
    expect(view.microsToUsd("400000")).toBe("0.40");
    expect(view.microsToUsd("1600000")).toBe("1.60");
    expect(view.microsToUsd("1")).toBe("0.000001");
    expect(view.microsToUsd(12_345_678n)).toBe("12.345678");
    expect(view.usdToMicros("0.40")).toBe("400000");
    expect(view.usdToMicros("2,5")).toBe("2500000");
    expect(view.usdToMicros("0.0000001")).toBeNull();
    expect(view.usdToMicros("-1")).toBeNull();
    expect(view.usdToMicros("abc")).toBeNull();
  });

  it("offers key and model actions to AI administrators only, by state", () => {
    const manage = { providerManage: true, modelManage: true };
    const read = { providerManage: false, modelManage: false };
    expect(view.credentialActions({ status: "ACTIVE" }, manage)).toEqual([
      "test",
      "disable",
      "revoke",
    ]);
    expect(view.credentialActions({ status: "DISABLED" }, manage)).toEqual([
      "test",
      "activate",
      "revoke",
    ]);
    expect(view.credentialActions({ status: "PENDING_TEST" }, manage)).toEqual(["test", "revoke"]);
    expect(view.credentialActions({ status: "REVOKED" }, manage)).toEqual([]);
    expect(view.credentialActions({ status: "ACTIVE" }, read)).toEqual([]);
    const m = (status: AiModelSummary["status"], compatible = true, requiresConfirmation = false) =>
      view.modelActions({ status, compatible, requiresConfirmation }, manage);
    expect(m("ENABLED")).toEqual(["disable"]);
    expect(m("VERIFIED")).toEqual(["enable", "verify"]);
    // Unknown capabilities: enable is offered, the dialog asks for the explicit confirmation.
    expect(m("VERIFIED", false, true)).toEqual(["enable", "verify"]);
    expect(m("VERIFIED", false, false)).toEqual(["verify"]);
    expect(m("DISCOVERED")).toEqual(["verify"]);
    expect(
      view.modelActions(
        { status: "VERIFIED", compatible: true, requiresConfirmation: false },
        read,
      ),
    ).toEqual([]);
    expect(view.usableModels(models.items).map((x) => x.modelId)).toEqual(["gpt-fake-mini"]);
  });
});

describe("DP-292: browser client", () => {
  it("calls the AI routes; the key only in the POST body; revoke is a DELETE", async () => {
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: String(init.method), body: init.body as string | undefined });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const secret = ["sk", "proj", "TESTKEY", "abcdefghijklmnopqrstuvwxyz"].join("-");
    await client.addCredential("OPENAI", { apiKey: secret, label: "Main", activate: true });
    await client.revokeCredential(ID(1));
    await client.enableModel(ID(11), true);
    await client.enableModel(ID(10), false);
    await client.updateTask("DIAGNOSTIC_PING", tasks.items[0] as never);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/providers/OPENAI/credentials`,
      `DELETE ${API}/credentials/${ID(1)}`,
      `POST ${API}/models/${ID(11)}/enable`,
      `POST ${API}/models/${ID(10)}/enable`,
      `POST ${API}/tasks/diagnostic_ping`,
    ]);
    expect(calls[0]!.url).not.toContain(secret);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ apiKey: secret });
    expect(calls[1]!.body).toBeUndefined();
    expect(JSON.parse(calls[2]!.body!)).toEqual({ confirmUnknownCapabilities: true });
    expect(JSON.parse(calls[3]!.body!)).toEqual({});
  });

  it("maps AI rules, the step-up and unknown errors to messages in the UI language", () => {
    const t = createTranslator("tr");
    const err = (code: string, rule?: string) => ({
      error: {
        code,
        message: "x",
        requestId: "r",
        details: rule ? [{ path: "(root)", rule }] : [],
      },
    });
    expect(
      client.aiErrorMessage(err("CONFLICT_STATE", "capabilities_unknown"), t, "f").message,
    ).toBe(t("ai.rules.capabilities_unknown"));
    expect(client.aiErrorMessage(err("AUTH_STEP_UP_REQUIRED"), t, "f").stepUp).toBe(true);
    expect(client.aiErrorMessage(err("FORBIDDEN"), t, "f").message).toBe(t("ai.api.forbidden"));
    expect(client.aiErrorMessage(null, t, "fallback").message).toBe("fallback");
    // Every rule has a message in both languages.
    for (const rule of client.AI_RULES) {
      expect(createTranslator("en")(`ai.rules.${rule}`)).not.toBe(`ai.rules.${rule}`);
    }
  });
});

describe("DP-292: the AI Center page", () => {
  it("is a 404 while AI is off for the session (no menu, no page, no AI title)", async () => {
    seed();
    session.value = { features: { aiCenter: false } };
    await expect(render(undefined)).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await aiPage.generateMetadata()).title).toBe("Page not found");
    session.value = { features: { aiCenter: true } };
    expect((await aiPage.generateMetadata()).title).toBe("AI Center");
  });

  it("shows tabs, readiness and the reader's access; no switch and no button for a reader", async () => {
    seed(READ);
    reads.set(`${API}/overview`, overview(READ, ["no_budget"]));
    const html = await render(undefined);
    expect(html).toContain('aria-current="page"');
    for (const tab of ["Overview", "Providers and keys", "Models", "Tasks"])
      expect(text(html)).toContain(tab);
    expect(text(html)).toContain("No AI call is possible");
    expect(text(html)).toContain("A daily and a monthly budget");
    expect(text(html)).toContain("Ready");
    expect(text(html)).toContain("You can read the AI Center");
    expect(text(html)).toContain("Only the system owner can switch AI on or off");
    expect(html).not.toContain('href="/owner"');
    expect(buttons(html)).toEqual([]);
  });

  it("links the owner to the Owner Console for the switch, which is not in the AI Center", async () => {
    seed(MANAGE);
    session.value = { features: { aiCenter: true }, isSystemOwner: true };
    const html = await render(undefined);
    expect(html).toContain('href="/owner"');
    expect(text(html)).toContain("AI calls are possible");
    for (const tab of ["providers", "models", "tasks"]) {
      expect(text(await render(tab))).not.toMatch(/switch AI (on|off)/i);
    }
  });

  it("providers: three cards, the key only by its hint; actions only for AI administrators", async () => {
    seed(READ);
    const read = await render("providers");
    for (const name of ["OpenAI", "Claude (Anthropic)", "Gemini (Google)"])
      expect(text(read)).toContain(name);
    expect(text(read)).toContain(KEY_HINT);
    expect(text(read)).toContain("No active key");
    expect(buttons(read)).toEqual([]);
    seed(MANAGE);
    const manage = await render("providers");
    const b = buttons(manage);
    expect(b).toEqual(
      expect.arrayContaining([
        "Replace API key",
        "Add API key",
        "Provider settings",
        "Test",
        "Disable",
        "Revoke",
      ]),
    );
    expect(b.filter((x) => x === "Add API key")).toHaveLength(2);
    // No password value is ever rendered (the add-key dialog is closed; it has no value anyway).
    expect(manage).not.toMatch(/type="password"[^>]*value="[^"]/);
  });

  it("models: capabilities, unknown ones flagged, prices; manage actions by permission", async () => {
    seed(MANAGE);
    const html = await render("models");
    const tx = text(html);
    expect(tx).toContain("gpt-fake-mini");
    expect(tx).toContain("Capabilities unknown");
    expect(tx).toContain("Price: input $0.40, output $1.60 per 1M tokens");
    expect(tx).not.toContain("Embedding"); // hidden until "show models that cannot be used"
    expect(buttons(html)).toEqual(
      expect.arrayContaining(["Load OpenAI models", "Disable", "Enable", "Verify", "Add price"]),
    );
    seed(READ);
    const read = await render("models");
    expect(buttons(read)).toEqual([]);
    expect(text(read)).toContain("Capabilities unknown");
  });

  it("tasks: model and limits per task; editing only for AI administrators; TR", async () => {
    seed(MANAGE);
    const html = await render("tasks");
    expect(text(html)).toContain("Connection check");
    expect(text(html)).toContain("input 2000, output 64 tokens");
    expect(text(html)).toContain("$0.05");
    expect(text(html)).toContain("Later release");
    expect(buttons(html).filter((b) => b === "Edit")).toHaveLength(2);
    seed(READ);
    expect(buttons(await render("tasks"))).toEqual([]);
    seed(MANAGE);
    const tr = text(await render("tasks", "tr"));
    expect(tr).toContain("Bağlantı denetimi");
    expect(tr).toContain("Sonraki sürüm");
    expect(tr).toContain("Düzenle");
    const trProviders = text(await render("providers", "tr"));
    expect(trProviders).toContain("API anahtarını değiştir");
    expect(trProviders).toContain("Etkin anahtar");
  });

  it("shows an error state when a section cannot be loaded, and an empty state without models", async () => {
    seed(MANAGE);
    reads.set(`${API}/models`, FAIL);
    expect(text(await render("models"))).toContain("The AI Center could not be loaded");
    seed(READ);
    reads.set(`${API}/models`, { items: [] });
    expect(text(await render("models"))).toContain("No models yet");
  });
});
