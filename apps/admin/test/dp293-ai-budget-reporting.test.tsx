// DP-293 (ADR-030 D6, D7): the AI Center's budget, usage and reporting screens.
//   1. Pure helpers: display rounding of exact micro-USD (half away from zero, integers only),
//      currency in EN/TR, shares, the budget bar (reserved never counted as spent), chart scale,
//      the usage query from the URL (UTC days, defaults, invalid values dropped), visible tabs.
//   2. The browser client: budget, settings and provider-figure routes (POST bodies in µ$ strings).
//   3. The page: budgets with UTC + local period times, actual/assumed/reserved apart, buttons only
//      for budget managers; alerts; usage report with filters, chart and breakdowns; empty and error
//      states; operations list and detail (ledger, audit only with audit:read, no text); price list
//      with missing prices; reconciliation; audit tab only with audit:read; TR; 404 while AI is off.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AiBudget,
  AiOperation,
  AiOverviewResponse,
  AiUsageReport,
  AiUsageTotals,
  StaffSessionResponse,
} from "@dream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = vi.hoisted(() => new Map<string, unknown>());
const asked = vi.hoisted(() => [] as string[]);
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
    asked.push(path);
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
const NOW = new Date("2026-11-26T15:30:00.000Z"); // 16:30 in Amsterdam
const ID = (n: number) => `0190c0de-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SITE = ID(90);
const READ = {
  usageRead: true,
  providerManage: false,
  modelManage: false,
  budgetManage: false,
  invoke: false,
  auditRead: false,
};
const MANAGE = {
  ...READ,
  providerManage: true,
  modelManage: true,
  budgetManage: true,
  invoke: true,
};
const overview = (permissions = READ): AiOverviewResponse => ({
  enabled: true,
  callsPossible: true,
  blockers: [],
  transport: "fake",
  permissions,
  sites: [{ id: SITE, key: "BV", name: "Dream Petroleum BV" }],
});

const totals = (over: Partial<AiUsageTotals> = {}): AiUsageTotals => ({
  operations: 0,
  outcomes: { succeeded: 0, failed: 0, cancelled: 0, unknown: 0, discarded: 0, open: 0 },
  estimatedMicros: "0",
  reservedMicros: "0",
  actualMicros: "0",
  assumedMicros: "0",
  settledEstimateMicros: "0",
  overruns: 0,
  inputTokens: 0,
  cachedReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...over,
});
const busy = totals({
  operations: 4,
  outcomes: { succeeded: 2, failed: 0, cancelled: 0, unknown: 1, discarded: 0, open: 1 },
  estimatedMicros: "90000",
  reservedMicros: "20000",
  actualMicros: "12345",
  assumedMicros: "30000",
  settledEstimateMicros: "40000",
  overruns: 1,
  inputTokens: 1200,
  outputTokens: 80,
  reasoningTokens: 10,
});

const budget = (over: Partial<AiBudget> = {}): AiBudget => ({
  id: ID(1),
  scope: "PLATFORM",
  siteId: null,
  period: "DAILY",
  limitMicros: "1000000",
  effectiveLimitMicros: "1000000",
  warnPct: 80,
  active: true,
  version: 3,
  current: {
    periodStart: "2026-11-26T00:00:00.000Z",
    reservedMicros: "100000",
    committedMicros: "250000",
    assumedMicros: "50000",
    warning: false,
  },
  ...over,
});
const budgets = {
  items: [
    budget(),
    budget({
      id: ID(2),
      period: "MONTHLY",
      limitMicros: "5000000",
      effectiveLimitMicros: "5000000",
      current: {
        periodStart: "2026-11-01T00:00:00.000Z",
        reservedMicros: "0",
        committedMicros: "5000000",
        assumedMicros: "0",
        warning: true,
      },
    }),
    budget({
      id: ID(3),
      scope: "SITE",
      siteId: SITE,
      limitMicros: "200000",
      effectiveLimitMicros: "200000",
    }),
  ],
  localCap: { dailyMicros: "1000000", monthlyMicros: "5000000" },
};
const settings = { maxConcurrency: 2, reservationTtlSec: 120, safetyMarginPct: 10, version: 1 };
const alerts = {
  generatedAt: NOW.toISOString(),
  dayStart: "2026-11-26T00:00:00.000Z",
  monthStart: "2026-11-01T00:00:00.000Z",
  items: [
    {
      code: "budget_exceeded",
      severity: "critical",
      budgetId: ID(2),
      siteId: null,
      period: "MONTHLY",
      provider: null,
      modelId: null,
      day: null,
      count: null,
      amountMicros: "5000000",
      limitMicros: "5000000",
      permille: 1000,
    },
    {
      code: "unknown_operations",
      severity: "warning",
      budgetId: null,
      siteId: null,
      period: null,
      provider: "GEMINI",
      modelId: null,
      day: null,
      count: 1,
      amountMicros: "30000",
      limitMicros: null,
      permille: null,
    },
  ],
};
const models = {
  items: [
    {
      id: ID(10),
      provider: "OPENAI",
      modelId: "gpt-fake-mini",
      displayName: "gpt-fake-mini",
      status: "ENABLED",
      compatible: true,
      requiresConfirmation: false,
      capabilities: {
        textGeneration: true,
        structuredOutput: true,
        thinking: false,
        lifecycle: "active",
      },
      contextWindow: 128000,
      maxOutputTokens: 16000,
      lastVerifiedAt: null,
      verifyCode: null,
      version: 1,
    },
  ],
};
const report = (t: AiUsageTotals): AiUsageReport => ({
  from: "2026-10-28",
  to: "2026-11-26",
  granularity: "day",
  totals: t,
  series: [
    { bucket: "2026-11-25", totals: totals() },
    { bucket: "2026-11-26", totals: t },
  ],
  byProvider: t.operations ? [{ provider: "OPENAI", totals: t }] : [],
  byModel: t.operations
    ? [
        {
          provider: "OPENAI",
          modelId: ID(10),
          modelKey: "gpt-fake-mini",
          displayName: "gpt-fake-mini",
          totals: t,
        },
      ]
    : [],
  byTask: t.operations ? [{ task: "DIAGNOSTIC_PING", totals: t }] : [],
  bySite: t.operations ? [{ siteId: null, totals: t }] : [],
});
const op = (over: Partial<AiOperation> = {}): AiOperation => ({
  id: ID(50),
  task: "DIAGNOSTIC_PING",
  siteId: null,
  provider: "GEMINI",
  modelId: ID(10),
  status: "UNKNOWN",
  estInputTokens: 40,
  estOutputTokens: 16,
  reservedMicros: "30000",
  actualMicros: "30000",
  costBasis: "ASSUMED",
  inputTokens: null,
  cachedReadTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  errorCode: "timeout",
  reservedAt: "2026-11-26T15:00:00.000Z",
  finishedAt: "2026-11-26T15:00:45.000Z",
  ...over,
});

const USAGE_DEFAULT = `${API}/usage?from=2026-10-28&to=2026-11-26&granularity=day`;
function seed(permissions = READ) {
  session.value = { features: { aiCenter: true } };
  reads.set(`${API}/overview`, overview(permissions));
  reads.set(`${API}/budgets`, budgets);
  reads.set(`${API}/settings`, settings);
  reads.set(`${API}/alerts`, alerts);
  reads.set(`${API}/models`, models);
  reads.set(USAGE_DEFAULT, report(busy));
  reads.set(`${API}/usage?from=2026-11-01&to=2026-11-26&granularity=month`, {
    ...report(busy),
    granularity: "month",
    series: [{ bucket: "2026-11", totals: busy }],
  });
}

async function render(sp: Record<string, string> = {}, locale: AdminLocale = "en") {
  ui.locale = locale;
  const el: ReactElement = await aiPage.default({ searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{el}</LocaleProvider>);
}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1] ?? "").trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  reads.clear();
  asked.length = 0;
  session.value = {};
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DP-293: helpers", () => {
  it("rounds exact micro-USD for display only: half away from zero, integers only", () => {
    expect(view.roundMicros("1234567", 2)).toBe("1.23");
    expect(view.roundMicros("1235000", 2)).toBe("1.24");
    expect(view.roundMicros("1234999", 2)).toBe("1.23");
    expect(view.roundMicros("-5000", 2)).toBe("-0.01");
    expect(view.roundMicros("-4999", 2)).toBe("0.00");
    expect(view.roundMicros("999999999999999", 2)).toBe("1000000000.00");
    expect(view.roundMicros("21", 6)).toBe("0.000021");
    expect(view.roundMicros(150n, 4)).toBe("0.0002");
    expect(view.roundMicros("7", 0)).toBe("0");
  });

  it("shows cents from one cent up and more decimals below, in the UI language", () => {
    expect(view.displayDecimals("0")).toBe(2);
    expect(view.displayDecimals("10000")).toBe(2);
    expect(view.displayDecimals("9999")).toBe(6);
    expect(view.formatUsd("250", "en")).toBe("US$0.000250");
    expect(view.displayDecimals("21")).toBe(6);
    expect(view.formatUsd("1234567890", "en")).toBe("US$1,234.57");
    expect(view.formatUsd("21", "en")).toBe("US$0.000021");
    expect(view.formatUsd("0", "en")).toBe("US$0.00");
    expect(view.formatUsd("1234567890", "tr")).toBe("$1.234,57");
    expect(view.formatUsd("-12345", "en")).toBe("-US$0.01");
    expect(view.formatPermille(123, "en")).toBe("12.3%");
    expect(view.formatPermille(1000, "tr")).toBe("%100,0");
  });

  it("budget bar: reserved is shown apart and never counted as used", () => {
    const bar = view.budgetBar({
      committedMicros: "250000",
      assumedMicros: "50000",
      reservedMicros: "100000",
      limitMicros: "1000000",
    });
    expect(bar).toMatchObject({
      committed: 0.25,
      assumed: 0.05,
      reserved: 0.1,
      over: false,
      usedPermille: 300,
      remainingMicros: "600000",
    });
    const over = view.budgetBar({
      committedMicros: "900000",
      assumedMicros: "0",
      reservedMicros: "300000",
      limitMicros: "1000000",
    });
    expect(over.over).toBe(true);
    expect(over.committed + over.reserved).toBeCloseTo(1, 4);
    expect(over.remainingMicros).toBe("0");
    expect(view.permilleOf("1", "3")).toBe(333);
    expect(view.permilleOf("5", "0")).toBe(0);
    expect(view.scaleSeries([0n, 5n, 10n])).toEqual([0, 0.5, 1]);
    expect(view.scaleSeries([0n, 0n])).toEqual([0, 0]);
  });

  it("UTC period bounds of a day and a month (month lengths, year end)", () => {
    const d = view.periodBounds("2026-11-26T00:00:00.000Z", "DAILY");
    expect(d.end.toISOString()).toBe("2026-11-27T00:00:00.000Z");
    const m = view.periodBounds("2026-12-01T00:00:00.000Z", "MONTHLY");
    expect(m.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(view.periodBounds("2028-02-01T00:00:00.000Z", "MONTHLY").end.toISOString()).toBe(
      "2028-03-01T00:00:00.000Z",
    );
  });

  it("reads the usage query from the URL: UTC defaults, invalid values dropped, never guessed", () => {
    expect(view.parseUsageParams({}, NOW)).toMatchObject({
      from: "2026-10-28",
      to: "2026-11-26",
      granularity: "day",
      provider: null,
    });
    expect(view.parseUsageParams({ granularity: "month" }, NOW)).toMatchObject({
      from: "2025-12-01",
      to: "2026-11-26",
    });
    const p = view.parseUsageParams(
      {
        from: "2026-11-01",
        to: "2026-11-10",
        provider: "gemini",
        task: "seo_meta",
        siteId: "platform",
        outcome: "unknown",
        modelId: ID(10).toUpperCase(),
      },
      NOW,
    );
    expect(p).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-10",
      provider: "GEMINI",
      task: "SEO_META",
      siteId: "platform",
      outcome: "unknown",
      modelId: ID(10),
    });
    for (const bad of [
      { from: "2026-11-10", to: "2026-11-01" },
      { from: "2025-01-01", to: "2026-11-01" },
      { from: "2026-02-30", to: "2026-03-01" },
    ])
      expect(view.parseUsageParams(bad, NOW).from).toBe("2026-10-28");
    expect(
      view.parseUsageParams({ provider: "mistral", outcome: "SUCCEEDED", siteId: "x" }, NOW),
    ).toMatchObject({ provider: null, outcome: null, siteId: null });
    expect(view.usageQuery(p)).toBe(
      `from=2026-11-01&to=2026-11-10&granularity=day&provider=GEMINI&modelId=${ID(10)}&task=SEO_META&siteId=platform&outcome=unknown`,
    );
  });

  it("tabs by permission: usage needs ai_usage:read, the audit trail also audit:read", () => {
    expect(view.visibleTabs({ usageRead: true, auditRead: true })).toContain("audit");
    expect(view.visibleTabs({ usageRead: true, auditRead: false })).not.toContain("audit");
    const none = view.visibleTabs({ usageRead: false, auditRead: true });
    for (const tab of ["usage", "operations", "reconciliation", "audit"] as const)
      expect(none).not.toContain(tab);
    expect(none).toContain("budgets");
  });
});

describe("DP-293: browser client", () => {
  it("budgets, settings and provider figures: POST routes with micro-USD strings", async () => {
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: String(init.method), body: init.body as string | undefined });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    await client.createBudget({
      scope: "SITE",
      siteId: SITE,
      period: "DAILY",
      limitMicros: "500000",
      warnPct: 80,
    });
    await client.updateBudget(ID(1), { limitMicros: "1", warnPct: 50, active: false, version: 3 });
    await client.updateSettings(settings);
    await client.recordProviderFigure({
      provider: "GEMINI",
      day: "2026-11-25",
      providerAmountMicros: "1234",
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/budgets`,
      `POST ${API}/budgets/${ID(1)}`,
      `POST ${API}/settings`,
      `POST ${API}/reconciliation`,
    ]);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ limitMicros: "500000", siteId: SITE });
    expect(JSON.parse(calls[3]!.body!)).toMatchObject({ providerAmountMicros: "1234" });
  });

  it("maps the new API rules to messages", () => {
    const t = (k: string) => k;
    for (const rule of ["budget_exists", "already_recorded", "too_many_operations", "future"]) {
      const body = {
        error: {
          code: "CONFLICT_STATE",
          message: "x",
          requestId: "r",
          details: [{ path: "(root)", rule }],
        },
      };
      expect(client.aiErrorMessage(body, t as never, "fallback").message).toBe(`ai.rules.${rule}`);
    }
  });
});

describe("DP-293: the AI Center page", () => {
  it("is a 404 while AI is off, for every new tab", async () => {
    session.value = { features: { aiCenter: false } };
    for (const tab of ["budgets", "usage", "operations", "prices", "reconciliation", "audit"])
      await expect(render({ tab })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(asked).toEqual([]);
  });

  it("overview: alerts, platform budgets and this month's amounts, apart", async () => {
    seed();
    const html = text(await render());
    expect(html).toContain("Alerts");
    expect(html).toContain("Budget exhausted");
    expect(html).toContain("1 operation(s) with unknown outcome this month at Gemini (Google)");
    expect(html).toContain("Platform budgets");
    expect(html).toContain("This month");
    for (const label of [
      "Actual (local calculation)",
      "Assumed spent",
      "Reserved (not spent)",
      "Estimated (upper bound)",
    ])
      expect(html).toContain(label);
    expect(html).toContain("Audit trail: no");
    expect(buttons(await render())).toEqual([]);
  });

  it("budgets: UTC and Amsterdam period times, the three amounts, no change for a reader", async () => {
    seed();
    const raw = await render({ tab: "budgets" });
    const html = text(raw);
    expect(html).toContain("Period: 26 Nov 2026, 00:00 – 27 Nov 2026, 00:00 UTC");
    expect(html).toContain("Amsterdam time: 26 Nov 2026, 01:00 – 27 Nov 2026, 01:00");
    expect(html).toContain("Platform (all sites) · Daily");
    expect(html).toContain("Dream Petroleum BV · Daily");
    expect(html).toContain("Exhausted");
    expect(raw).toContain('aria-label="30.0% of US$1.00 used"'); // committed + assumed, not reserved
    expect(raw).toContain('title="100000 µ$"'); // exact value kept next to the rounded one
    expect(html).toContain("caps every limit at US$1.00 per day and US$5.00 per month");
    expect(html).toContain("enforced by the database");
    expect(html).toContain("Reservation settings");
    expect(buttons(raw)).toEqual([]);
  });

  it("budgets: managers get new, edit and settings buttons; the API decides again", async () => {
    seed(MANAGE);
    const b = buttons(await render({ tab: "budgets" }));
    expect(b).toContain("New budget");
    expect(b.filter((x) => /^Edit : /.test(x))).toHaveLength(3);
    expect(b).toContain("Edit settings");
  });

  it("usage: filters, figures, chart with a table, breakdowns; not an invoice", async () => {
    seed();
    const raw = await render({ tab: "usage" });
    const html = text(raw);
    expect(asked).toContain(USAGE_DEFAULT);
    expect(raw).toContain('name="from" value="2026-10-28"');
    expect(raw).toContain('role="img"');
    expect(html).toContain("Spend per UTC day, 2026-10-28 – 2026-11-26");
    expect(html).toContain("Show the figures as a table");
    for (const s of [
      "By provider",
      "By model",
      "By task",
      "By site",
      "not the providers' invoices",
    ])
      expect(html).toContain(s);
    expect(html).toContain("1 operation above its estimate");
    expect(html).toContain("30.8%"); // 12345 / 40000 actual vs estimate
  });

  it("usage: passes valid filters to the API and shows the empty and the error state", async () => {
    seed();
    const q = `${API}/usage?from=2026-11-01&to=2026-11-02&granularity=day&provider=GEMINI&outcome=unknown`;
    reads.set(q, report(totals()));
    const html = text(
      await render({
        tab: "usage",
        from: "2026-11-01",
        to: "2026-11-02",
        provider: "gemini",
        outcome: "unknown",
      }),
    );
    expect(asked).toContain(q);
    expect(html).toContain("No AI operations in this range");
    reads.set(USAGE_DEFAULT, FAIL);
    expect(text(await render({ tab: "usage" }))).toContain("The report could not be loaded");
  });

  it("operations: list and detail — assumed cost, ledger; audit only with audit:read; never a text", async () => {
    seed();
    reads.set(`${API}/operations?limit=50`, {
      items: [op()],
      nextBefore: "2026-11-26T15:00:00.000Z",
    });
    const list = text(await render({ tab: "operations" }));
    expect(list).toContain("Unknown (counted as spent)");
    expect(list).toContain("assumed spent (outcome unknown)");
    expect(list).toContain("Older");
    reads.set(`${API}/operations/${ID(50)}`, {
      operation: op(),
      own: false,
      runner: "none",
      result: null,
    });
    reads.set(`${API}/operations/${ID(50)}/history`, {
      operationId: ID(50),
      ledger: [
        {
          id: ID(60),
          at: "2026-11-26T15:00:00.000Z",
          kind: "RESERVE",
          budgetId: ID(1),
          scope: "PLATFORM",
          siteId: null,
          period: "DAILY",
          periodStart: "2026-11-26T00:00:00.000Z",
          deltaReservedMicros: "30000",
          deltaCommittedMicros: "0",
          deltaAssumedMicros: "0",
        },
      ],
      audit: null,
    });
    const detail = text(await render({ tab: "operations", op: ID(50) }));
    expect(detail).toContain("Budget ledger");
    expect(detail).toContain("RESERVE");
    expect(detail).toContain("counted as spent and it is never repeated automatically");
    expect(detail).toContain("Audit events need the audit permission.");
    expect(detail).toContain("Prompts and answers are never stored or shown here.");
  });

  it("prices: every dated price with its state; missing prices; add only for model managers", async () => {
    const priceList = {
      items: [
        {
          price: {
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
            effectiveFrom: "2026-11-20T08:00:00.000Z",
            source: "MANUAL",
            sourceNote: "pricing page 2026-11-20",
            createdAt: "2026-11-20T08:00:00.000Z",
          },
          provider: "OPENAI",
          modelKey: "gpt-fake-mini",
          displayName: "gpt-fake-mini",
          modelStatus: "ENABLED",
          state: "in_force",
        },
      ],
      missing: [
        {
          modelId: ID(11),
          provider: "GEMINI",
          modelKey: "gemini-x",
          displayName: "Gemini X",
          tasks: ["DIAGNOSTIC_PING"],
        },
      ],
    };
    seed();
    reads.set(`${API}/prices`, priceList);
    const html = await render({ tab: "prices" });
    expect(text(html)).toContain("In force");
    expect(text(html)).toContain("Models without a price in force");
    expect(text(html)).toContain("used by: Connection check");
    expect(buttons(html)).toEqual([]);
    seed(MANAGE);
    reads.set(`${API}/prices`, priceList);
    expect(buttons(await render({ tab: "prices" }))).toEqual([
      "Add price : Gemini X",
      "Add price : gpt-fake-mini",
    ]);
  });

  it("reconciliation: actual, assumed, the provider's figure and the signed difference", async () => {
    seed(MANAGE);
    reads.set(`${API}/reconciliation?from=2026-10-28&to=2026-11-26`, {
      items: [
        {
          provider: "GEMINI",
          day: "2026-11-26",
          localMicros: "12345",
          assumedMicros: "30000",
          providerMicros: "40000",
          differenceMicros: "-2345",
        },
        {
          provider: "OPENAI",
          day: "2026-11-26",
          localMicros: "5",
          assumedMicros: "0",
          providerMicros: null,
          differenceMicros: null,
        },
      ],
    });
    const raw = await render({ tab: "reconciliation" });
    const html = text(raw);
    expect(html).toContain("-US$0.002345");
    expect(html).toContain("not entered");
    expect(buttons(raw)).toContain("Enter provider figure");
    // Its dialog has a form of its own: the button never sits inside the GET filter form (E2E).
    for (const f of raw.match(/<form method="get"[\s\S]*?<\/form>/g) ?? [])
      expect(f).not.toContain("Enter provider figure");
  });

  it("audit: hidden without audit:read (the overview is shown instead); listed with it", async () => {
    seed();
    const hidden = await render({ tab: "audit" });
    expect(asked.some((p) => p.startsWith(`${API}/audit`))).toBe(false);
    expect(text(hidden)).not.toContain("Audit trail AI events");
    seed({ ...READ, auditRead: true });
    reads.set(`${API}/audit?limit=50`, {
      items: [
        {
          id: ID(70),
          occurredAt: "2026-11-26T15:00:00.000Z",
          action: "ai.operation.denied",
          outcome: "DENIED",
          actor: "ai-admin",
          resourceType: "ai_operation",
          resourceId: null,
          reason: "budget_exceeded",
          details: { task: "DIAGNOSTIC_PING" },
        },
      ],
      nextBefore: null,
    });
    const html = text(await render({ tab: "audit" }));
    expect(html).toContain("ai.operation.denied");
    expect(html).toContain("budget_exceeded");
    expect(html).toContain("by ai-admin");
  });

  it("usage tab is not offered without ai_usage:read", async () => {
    seed({ ...READ, usageRead: false });
    const html = await render({ tab: "usage" });
    expect(asked.some((p) => p.startsWith(`${API}/usage`))).toBe(false);
    expect(asked.some((p) => p.startsWith(`${API}/alerts`))).toBe(false);
    expect(html).not.toContain("?tab=usage");
  });

  it("speaks Turkish", async () => {
    seed(MANAGE);
    const html = text(await render({ tab: "budgets" }, "tr"));
    expect(html).toContain("Bütçeler");
    expect(html).toContain("Gerçekleşen (yerel hesap)");
    expect(html).toContain("Harcanmış kabul edilen");
    expect(html).toContain("Rezerve (harcanmadı)");
    expect(html).toContain("Dönem: 26 Kas 2026 00:00 – 27 Kas 2026 00:00 UTC");
    expect(html).toContain("Yeni bütçe");
    const usage = text(await render({ tab: "usage" }, "tr"));
    expect(usage).toContain("Sağlayıcıya göre");
    expect(usage).toContain("sağlayıcı faturası değildir");
  });
});
