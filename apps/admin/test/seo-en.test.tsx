// ML-12d (DP-243) EN regression of the SEO area: Admin > SEO (overview of the BV site defaults and
// every page, article and product with its notes, filters and states) and Admin > SEO > Redirects
// (list, search and filters, pages, read-only and managing callers, the create/edit form, delete
// confirmation, history, the CSV import with its dry-run result, notices and errors) plus the view
// helpers' texts (API rule messages, warnings, history labels, the dry-run report CSV). Every render
// goes through support/en-baseline-render: it is compared with the HTML recorded on private main
// fb6687d (before ML-12d) in fixtures/catalog-en/seo-en.json.gz (record with ML12D_RECORD_EN=1,
// this file only).
//
// The client parts keep their state in useState. A static render shows only the first state, so
// `react`'s useState is replaced here by a queue: a test lists the states the next components start
// in (in render order; KEEP = the component's own initial value). Nothing else of React changes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../lib/i18n/translate";
import { renderToStaticMarkup } from "./support/en-baseline-render";
import {
  CMS_CONTEXT,
  CSV,
  HISTORY,
  IMPORT_RESULT,
  ITEMS,
  OVERVIEW,
  REDIRECTS,
  ROWS,
  bvContext,
  listData,
  overviewData,
} from "./support/seo-fixtures";

const KEEP = Symbol("keep");
const queue: unknown[] = [];
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const initial = typeof init === "function" ? (init as () => unknown)() : init;
    const next = queue.length ? queue.shift() : KEEP;
    return [next === KEEP ? initial : next, () => undefined];
  };
  return { ...react, default: { ...react, useState }, useState };
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
}));

const { default: SeoPage } = await import("../app/(console)/seo/page");
const { default: RedirectsPage } = await import("../app/(console)/seo/redirects/page");
const { RedirectManager } = await import("../components/seo/redirect-manager");
const { SeoTabs } = await import("../components/seo/seo-tabs");
const view = await import("../lib/redirects-view");
const overview = await import("../lib/seo-overview");
const client = await import("../lib/redirects-client");

const EN = createTranslator("en");
const seo = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(await SeoPage({ searchParams: Promise.resolve(query) } as never));

const redirects = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(await RedirectsPage({ searchParams: Promise.resolve(query) } as never));

beforeEach(() => {
  reads.clear();
  queue.length = 0;
  reads.set(CMS_CONTEXT, bvContext);
});

// --- SEO overview -----------------------------------------------------------------------------------

describe("SEO overview (EN)", () => {
  it("lists the site defaults and every row state", async () => {
    reads.set(OVERVIEW, overviewData());
    const html = await seo();
    expect(html).toContain("Site defaults");
    expect(html).toContain("Pages, articles and products");
  });

  it("shows every filter, including one with nothing to show", async () => {
    reads.set(OVERVIEW, overviewData());
    for (const filter of ["attention", "noindex", "pending", "products", "pages", "unknown"])
      await seo({ filter });
    reads.set(OVERVIEW, overviewData({ items: ITEMS.filter((i) => i.source === "cms") }));
    expect(await seo({ filter: "products" })).toContain("Nothing to show for this filter.");
  });

  it("shows every state of the site defaults", async () => {
    const settings = overviewData().settings;
    for (const s of [
      { ...settings, published: false },
      { ...settings, pendingChanges: true },
      { ...settings, draft: {} },
    ]) {
      reads.set(OVERVIEW, overviewData({ settings: s, liveSettings: null }));
      await seo();
    }
    reads.set(OVERVIEW, overviewData({ settings: null, liveSettings: null }));
    expect(await seo()).toContain("Built-in defaults");
    const readOnly = {
      ...overviewData().permissions,
      editPages: false,
      publishPages: false,
      editProducts: false,
    };
    reads.set(
      OVERVIEW,
      overviewData({ settings: null, liveSettings: null, permissions: readOnly }),
    );
    await seo();
    reads.set(OVERVIEW, overviewData({ permissions: readOnly }));
    expect(await seo()).toContain("View defaults");
    reads.set(OVERVIEW, overviewData({ items: [] }));
    await seo();
  });

  it("shows no access, a refusal and a load error", async () => {
    reads.delete(CMS_CONTEXT);
    expect(await seo()).toContain("No access to the BV site");
    reads.set(CMS_CONTEXT, bvContext);
    reads.set(OVERVIEW, FORBIDDEN);
    expect(await seo()).toContain("The SEO overview could not be loaded");
    reads.set(OVERVIEW, FAIL);
    await seo();
  });

  it("names the tabs of the SEO section", () => {
    renderToStaticMarkup(<SeoTabs current="overview" t={EN} />);
    renderToStaticMarkup(<SeoTabs current="redirects" t={EN} />);
  });
});

// --- Redirects page -------------------------------------------------------------------------------

describe("Redirects page (EN)", () => {
  it("lists manual, imported and protected slug-change redirects for a manager", async () => {
    reads.set(REDIRECTS, listData(true));
    const html = await redirects();
    expect(html).toContain("New redirect");
    expect(html).toContain("not available to you");
  });

  it("is read-only without content:publish", async () => {
    reads.set(REDIRECTS, listData(false));
    expect(await redirects()).toContain("needs the right to publish content");
  });

  it("passes search, filters, sort and pages, and shows the pagination", async () => {
    for (const [qs, query, page, total] of [
      [
        "?q=old&origin=IMPORT&status=302&active=false&sort=source&dir=asc&page=2",
        {
          q: "old",
          origin: "IMPORT",
          status: "302",
          active: "false",
          sort: "source",
          dir: "asc",
          page: "2",
        },
        2,
        160,
      ],
      [
        "?origin=MANUAL&status=301&active=true&sort=target",
        { origin: "MANUAL", status: "301", active: "true", sort: "target" },
        1,
        93,
      ],
      [
        "?origin=SLUG_CHANGE&sort=created&page=3",
        { origin: "SLUG_CHANGE", sort: "created", page: "3" },
        3,
        120,
      ],
    ] as const) {
      reads.set(`${REDIRECTS}${qs}`, listData(true, { page, total }));
      await redirects(query as Record<string, string>);
    }
  });

  it("counts one redirect and shows an empty list", async () => {
    reads.set(REDIRECTS, listData(true, { items: [ROWS[0]], total: 1 }));
    expect(await redirects()).toContain("1 redirect");
    reads.set(REDIRECTS, listData(true, { items: [], total: 0 }));
    expect(await redirects()).toContain("No redirects match.");
  });

  it("shows no access, a refusal and a load error", async () => {
    reads.delete(CMS_CONTEXT);
    expect(await redirects()).toContain("No access to the BV site");
    reads.set(CMS_CONTEXT, bvContext);
    reads.set(REDIRECTS, FORBIDDEN);
    expect(await redirects()).toContain("You are not allowed to read");
    reads.set(REDIRECTS, FAIL);
    expect(await redirects()).toContain("Try again in a moment.");
  });
});

// --- Client states of the redirect manager -------------------------------------------------------

describe("Redirect manager states (EN)", () => {
  const manager = (manage = true, data: Record<string, unknown> = {}) =>
    renderToStaticMarkup(<RedirectManager data={listData(manage, data) as never} />);
  // A row's states: confirm, pending, error, events, showHistory.
  const rowStates = (
    s: Partial<Record<"confirm" | "pending" | "error" | "events" | "show", unknown>>,
  ) => [s.confirm ?? KEEP, s.pending ?? KEEP, s.error ?? KEEP, s.events ?? KEEP, s.show ?? KEEP];
  const keepRows = (n: number) => Array.from({ length: n * 5 }, () => KEEP);

  it("notices after a change, with warnings", () => {
    for (const notice of [
      { text: "Redirect created. It is live on the site now.", warnings: ["target:not_live"] },
      { text: "Redirect saved.", warnings: ["source:draft_content", "other:warning"] },
      { text: "1 redirect imported. They are live on the site now.", warnings: [] },
      { text: "3 redirects imported. They are live on the site now.", warnings: [] },
      { text: "Redirect deleted. The old address answers 404 again.", warnings: [] },
    ]) {
      queue.push(KEEP, KEEP, notice);
      manager();
    }
  });

  it("the create form, empty and with an error", () => {
    queue.push({ mode: "create" }, KEEP, KEEP);
    manager();
    queue.push(
      { mode: "create" },
      KEEP,
      KEEP,
      "/old",
      "https://example.com/x",
      302,
      false,
      "n",
      true,
      null,
    );
    manager();
    queue.push({ mode: "create" }, KEEP, KEEP, "/old", "/old", KEEP, KEEP, KEEP, false, {
      message: "The old and the new address are the same: that would be a loop.",
      fields: ["target"],
    });
    manager();
  });

  it("the edit form of a manual and of a protected redirect", () => {
    for (const n of [0, 2]) {
      queue.push({ mode: "edit", item: ROWS[n] }, KEEP, KEEP, ...keepRows(n));
      manager();
    }
  });

  it("a row asking to delete, deleting, with an error and with its history", () => {
    for (const states of [
      { confirm: true },
      { confirm: true, pending: true },
      { error: "Your roles do not allow this change." },
      { show: true },
      { show: true, events: [] },
      { show: true, events: HISTORY },
    ]) {
      queue.push(KEEP, KEEP, KEEP, ...rowStates(states));
      manager();
    }
  });

  it("the import panel in every step", () => {
    // ImportPanel: csv, fileName, result, pending, error, onlyIssues.
    for (const states of [
      [null, "", null, false, null, true],
      [null, "", null, false, "The file is too large (at most 128 KB).", true],
      [CSV, "redirects.csv", null, false, null, true],
      [CSV, "one.csv", null, true, null, true],
      [CSV, "redirects.csv", IMPORT_RESULT, false, null, true],
      [CSV, "redirects.csv", IMPORT_RESULT, false, null, false],
      [
        CSV,
        "redirects.csv",
        {
          ...IMPORT_RESULT,
          summary: { ...IMPORT_RESULT.summary, error: 0 },
          rows: IMPORT_RESULT.rows.slice(0, 3),
        },
        false,
        "The redirects changed since the check. Check the file again and confirm the new result.",
        true,
      ],
      [
        "source,target\n/a,/b\n",
        "single.csv",
        {
          ...IMPORT_RESULT,
          summary: { rows: 1, create: 1, update: 0, unchanged: 0, error: 0 },
          rows: [{ ...IMPORT_RESULT.rows[0]!, warnings: [] }],
        },
        false,
        null,
        true,
      ],
      [
        CSV,
        "same.csv",
        {
          ...IMPORT_RESULT,
          summary: { rows: 1, create: 0, update: 0, unchanged: 1, error: 0 },
          rows: [IMPORT_RESULT.rows[2]!],
        },
        false,
        null,
        true,
      ],
    ]) {
      queue.push(KEEP, true, KEEP, ...states);
      manager();
    }
  });

  it("the read-only manager", () => {
    manager(false);
    manager(false, { items: [] });
  });
});

// --- View helpers ---------------------------------------------------------------------------------

describe("SEO and redirect texts (EN)", () => {
  const record = (value: unknown) =>
    renderToStaticMarkup(<pre>{JSON.stringify(value, null, 1)}</pre>);

  it("labels, filters and notes of the overview", () => {
    record({
      filters: overview.SEO_FILTERS.map((f) => overview.seoFilterLabel(f.id, EN)),
      kinds: Object.fromEntries(
        (["home", "page", "article", "product", "products", "news"] as const).map((k) => [
          k,
          overview.seoKindLabel(k, EN),
        ]),
      ),
      notes: ITEMS.map((i) => overview.seoNotes(i, EN)),
      attention: ITEMS.map((i) => overview.needsAttention(i)),
    });
  });

  it("labels of the redirect list", () => {
    record({
      origins: Object.fromEntries(
        (["MANUAL", "SLUG_CHANGE", "IMPORT"] as const).map((o) => [o, view.originLabel(o, EN)]),
      ),
      sorts: Object.fromEntries(
        (["updated", "created", "source", "target"] as const).map((o) => [
          o,
          view.sortLabel(o, EN),
        ]),
      ),
      actions: Object.fromEntries(
        ["create", "update", "unchanged", "error"].map((a) => [a, view.importActionLabel(a, EN)]),
      ),
      warnings: Object.fromEntries(
        ["target:not_live", "source:draft_content"].map((w) => [w, view.warningMessage(w, EN)]),
      ),
    });
  });

  it("every API rule in plain words", () => {
    const codes = [
      "source:required",
      "source:format",
      "source:reserved",
      "source:fragment",
      "source:query_format",
      "source:too_long",
      "source:live_content",
      "source:duplicate",
      "source:duplicate_in_file",
      "source:chain",
      "target:required",
      "target:format",
      "target:external",
      "target:reserved",
      "target:fragment",
      "target:query_format",
      "target:too_long",
      "target:self",
      "target:chain",
      "status:format",
      "active:format",
      "note:format",
      "redirect:protected",
      "version:stale",
      "import:has_errors",
      "import:changed",
      "csv:empty",
      "csv:header",
      "csv:quote",
      "csv.7:quote",
      "csv:too_large",
      "csv:too_many_rows",
      "csv:columns",
      "site:no_redirects",
      "weird:thing",
      "source:unknown_rule",
      ":",
      "",
    ];
    record(codes.map((c) => [c, view.ruleMessage(c, EN), view.knownRule(c)]));
  });

  it("history labels and summaries", () => {
    record(
      HISTORY.map((e) => [
        view.historyActionLabel(e.action, e.details, EN),
        view.historySummary(e.details, EN),
      ]),
    );
    record([
      view.historySummary({ active: true }, EN),
      view.historySummary({ statusCode: 301, changed: [] }, EN),
      view.historySummary({}, EN),
    ]);
  });

  it("refusals of the redirect API", async () => {
    const messages = [
      client.redirectErrorMessage(
        "CONFLICT_STATE",
        [
          { path: "source", rule: "duplicate" },
          { path: "target", rule: "chain" },
        ],
        EN,
      ),
      client.redirectErrorMessage("CONFLICT_STATE", [], EN),
      client.redirectErrorMessage("VALIDATION_FAILED", [{ path: "x", rule: "y" }], EN),
      client.redirectErrorMessage("PAYLOAD_TOO_LARGE", [], EN),
      client.redirectErrorMessage("SOMETHING_NEW", [], EN),
      client.redirectErrorMessage(null, [], EN),
    ];
    const real = globalThis.fetch;
    const answers: (() => Promise<Response>)[] = [
      () => Promise.reject(new Error("offline")),
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "FORBIDDEN", message: "x", details: [] } }),
            { status: 403 },
          ),
        ),
      () => Promise.resolve(new Response("not json", { status: 502 })),
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "CONFLICT_STATE",
                message: "x",
                details: [{ path: "version", rule: "stale" }],
              },
            }),
            { status: 409 },
          ),
        ),
    ];
    for (const answer of answers) {
      globalThis.fetch = answer as never;
      const res = await client.callRedirects("/x", { method: "GET" });
      messages.push(res.ok ? "ok" : `${res.status} ${res.message}`);
    }
    globalThis.fetch = real;
    record(messages);
  });

  it("the dry-run report (CSV)", () => {
    record(view.importReportCsv(IMPORT_RESULT));
  });
});
