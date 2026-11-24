// ML-12e (DP-243) EN regression of the Leads area: Admin > Leads (list with search, site, status,
// source, assignee and date filters, cursor pages, the CSV export bar, empty, refused and failed
// states), a lead (pipeline in every status, retention and consent badges, the sales workflow and
// activity forms, the history, contact-form messages with every notification status and reason,
// document requests with consent evidence, form language and downloads), Leads > Notifications
// (every mail transport, site settings and the recipient form) and the retired customer-data-access
// page, plus the view and client helpers' texts (labels, hints, reasons, export summaries and
// errors). Every render goes through support/en-baseline-render: it is compared with the HTML
// recorded on private main 10dec17 (before ML-12e) in fixtures/catalog-en/leads-en.json.gz (record
// with ML12E_RECORD_EN=1, this file only).
//
// The client parts keep their state in useState. A static render shows only the first state, so
// `react`'s useState is replaced here by a queue: a test lists the states the next components start
// in (in render order; KEEP = the component's own initial value). Nothing else of React changes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_TYPES,
  LEAD_CONTACT_CHANNELS,
  LEAD_NOTIFICATION_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
} from "@dream/contracts";
import { createTranslator } from "../lib/i18n/translate";
import { renderToStaticMarkup } from "./support/en-baseline-render";
import {
  AT,
  BV,
  FULL_LIST,
  FULL_PAGE,
  GONE,
  LEADS,
  LEADS_API,
  NOTIFICATIONS_API,
  OTHER,
  SUMMARY_API,
  VIEWER,
  detail,
  detailPath,
  id,
  list,
  notifications,
  siteSettings,
  summary,
} from "./support/leads-fixtures";

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
vi.mock("../lib/server-session", () => ({
  requireStaffSession: async () => ({ user: { id: "0190f3a0-0000-7000-8000-000000009100" } }),
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

const leadsPage = await import("../app/(console)/leads/page");
const leadPage = await import("../app/(console)/leads/[id]/page");
const notificationsPage = await import("../app/(console)/leads/notifications/page");
const { default: CustomerDataAccessPage } =
  await import("../app/(console)/customer-data-access/page");
const { LeadExport } = await import("../components/leads/lead-export");
const { LeadActivityForm, LeadWorkflowForm } = await import("../components/leads/lead-workflow");
const { NotificationSettingsForm } = await import("../components/leads/notification-settings");
const view = await import("../lib/leads-view");
const client = await import("../lib/leads-client");

const EN = createTranslator("en");
const NOW = new Date("2026-11-24T09:15:00.000Z");
const realTz = process.env["TZ"];
beforeAll(() => {
  // Local time only matters for the "when" field of a contact (datetime-local).
  process.env["TZ"] = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
  process.env["TZ"] = realTz;
});

beforeEach(() => {
  reads.clear();
  queue.length = 0;
});

/** The list page with these query parameters; list and summary read at their real API paths. */
async function leads(
  query: Record<string, string> = {},
  data: unknown = list(),
  sum: unknown = summary(),
) {
  const filters = view.readLeadFilters(query);
  reads.set(`${LEADS_API}${view.leadListQuery(filters)}`, data);
  reads.set(`${SUMMARY_API}${view.leadExportQuery(filters)}`, sum);
  return renderToStaticMarkup(
    await leadsPage.default({ searchParams: Promise.resolve(query) } as never),
  );
}

async function leadDetail(value: unknown, leadId = id(1)) {
  if (value !== undefined) reads.set(detailPath(leadId), value);
  return renderToStaticMarkup(
    await leadPage.default({ params: Promise.resolve({ id: leadId }) } as never),
  );
}

async function notificationSettings(value: unknown) {
  if (value !== undefined) reads.set(NOTIFICATIONS_API, value);
  return renderToStaticMarkup(await notificationsPage.default());
}

const record = (value: unknown) =>
  renderToStaticMarkup(<pre>{JSON.stringify(value, null, 1)}</pre>);

// --- Leads list -----------------------------------------------------------------------------------

describe("Leads list (EN)", () => {
  it("lists leads in every status, source, assignment and badge state", async () => {
    const html = await leads();
    expect(html).toContain("7 shown");
    expect(html).toContain("Anonymised lead");
    expect(html).toContain("(no longer has access)");
    expect(html).toContain("Marketing OK");
    expect(html).toContain("Free mail");
  });

  it("shows the next page, the first page and both", async () => {
    expect(await leads({}, list({ items: FULL_PAGE, nextCursor: "next_1" }))).toContain(
      "more on the next page",
    );
    await leads({ cursor: "next_1" }, list({ items: FULL_PAGE, nextCursor: "next_2" }));
    expect(await leads({ cursor: "next_2" }, list({ items: LEADS.slice(0, 2) }))).toContain(
      "First page",
    );
  });

  it("keeps every filter in the form and offers to clear them", async () => {
    // The site alone is not a filter: nothing to clear.
    expect(await leads({ site: BV }, list(), summary(3, true))).not.toContain("Clear filters");
    const queries: Record<string, string>[] = [
      { q: "acme" },
      { status: "QUALIFIED" },
      { source: "CONTACT_FORM" },
      { assignee: "me" },
      { assignee: "none" },
      { from: "2026-11-01", to: "2026-11-30" },
      {
        site: BV,
        q: "buyer",
        status: "NEW",
        source: "DOCUMENT_REQUEST",
        assignee: "me",
        from: "2026-10-01",
        to: "2026-11-24",
      },
    ];
    for (const query of queries) {
      expect(await leads(query, list(), summary(3, true))).toContain("Clear filters");
    }
  });

  it("shows an empty list, with and without filters", async () => {
    expect(await leads({}, list({ items: [] }), summary(0))).toContain("No leads yet");
    expect(await leads({ status: "CONVERTED" }, list({ items: [] }), summary(0))).toContain(
      "No matching leads",
    );
    await leads({}, list({ items: [], sites: [] }), summary(0, false));
  });

  it("shows every state of the export bar on the page", async () => {
    await leads({}, list(), summary(25_000, true));
    await leads({ q: "x" }, list(), summary(25_000, true));
    await leads({}, list(), summary(7, false));
    await leads({}, list(), summary(1, true));
    await leads({}, list(), FORBIDDEN);
    expect(await leads({}, list(), FAIL)).toContain("HTTP 500");
  });

  it("shows no access and a load error", async () => {
    expect(await leads({}, FORBIDDEN)).toContain("No access to leads");
    expect(await leads({}, FAIL)).toContain("The leads could not be loaded");
    reads.clear();
    await leads({ status: "NEW" }, FAIL);
  });
});

// --- Lead detail ----------------------------------------------------------------------------------

describe("Lead detail (EN)", () => {
  it("shows a managed lead with its history, messages and requests", async () => {
    const html = await leadDetail(detail());
    expect(html).toContain("English (not recorded, before ML-10)");
    expect(html).toContain("Dutch");
    expect(html).toContain("2026-11-13.en");
  });

  it("shows the pipeline and the workflow form in every status", async () => {
    for (const status of ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const)
      await leadDetail(detail({}, { status }));
  });

  it("shows retention holds, consent, free mail and assignment states", async () => {
    for (const leadOver of [
      { retentionHold: "CUSTOMER" as const, status: "CONVERTED" as const },
      { retentionHold: "OPEN_OPPORTUNITY" as const, freeMailDomain: true },
      { retentionHold: "LEGAL_HOLD" as const, marketingConsentAt: null },
      { assignedTo: null },
      { assignedTo: { id: GONE, displayName: "Former Colleague", active: false } },
      { source: "DOCUMENT_REQUEST" as const, requestCount: 1 },
    ])
      await leadDetail(detail({}, leadOver));
  });

  it("is read-only without lead:manage and once anonymised", async () => {
    expect(await leadDetail(detail({ canManage: false, assignees: [] }))).toContain(
      "needs a sales role for this site",
    );
    expect(
      await leadDetail(
        detail(
          { canManage: false, assignees: [] },
          {
            anonymisedAt: AT,
            fullName: "",
            company: "",
            email: "",
            status: "QUALIFIED",
            retentionHold: "LEGAL_HOLD",
          },
        ),
      ),
    ).toContain("This lead is anonymised");
  });

  it("shows a lead without history, messages or requests", async () => {
    const html = await leadDetail(
      detail({ activities: [], contactMessages: [], requests: [] }, { requestCount: 0 }),
    );
    expect(html).toContain("No sales activity yet.");
    expect(html).toContain("No message from the contact form.");
    expect(html).toContain("No document requests.");
  });

  it("shows no access, a load error and not found", async () => {
    expect(await leadDetail(FORBIDDEN)).toContain("No access to leads");
    await leadDetail(FAIL);
    await expect(leadDetail(undefined, id(404))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// --- Client states of the workflow and activity forms ---------------------------------------------

describe("Lead workflow forms (EN)", () => {
  const assignees = detail().assignees;
  const workflow = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <LeadWorkflowForm
        leadId={id(1)}
        status="NEW"
        assignedToId={null}
        version={2}
        assignees={assignees}
        viewerId={VIEWER}
        {...over}
      />,
    );

  it("the status and assignment form in its states", () => {
    // LeadWorkflowForm: to, assignee, note, busy, message.
    workflow();
    for (const status of ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const)
      workflow({ status });
    for (const to of ["CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "NEW"]) {
      queue.push(to);
      workflow({ status: "QUALIFIED" });
    }
    queue.push("CONTACTED", OTHER, "Agreed a call.", true, null);
    workflow();
    queue.push(KEEP, KEEP, KEEP, false, {
      kind: "error",
      text: "This action is not possible in the current state.",
    });
    workflow();
    queue.push(KEEP, KEEP, KEEP, false, {
      kind: "success",
      text: "Saved. The change is in the activity history.",
    });
    workflow();
  });

  it("assignees: the viewer, someone else, nobody, and one who lost access", () => {
    workflow({ assignedToId: VIEWER });
    workflow({ assignedToId: OTHER });
    workflow({ assignedToId: GONE });
    workflow({ assignees: [assignees[1]] });
    workflow({ assignees: [] });
  });

  it("the note and contact form in its states", () => {
    // LeadActivityForm: kind, body, channel, when, busy, message.
    const activity = () => renderToStaticMarkup(<LeadActivityForm leadId={id(1)} />);
    activity();
    queue.push("NOTE", "Call back", KEEP, KEEP, true, null);
    activity();
    for (const channel of ["EMAIL", "PHONE", "MEETING", "OTHER"]) {
      queue.push("CONTACT", "Discussed prices", channel, "2026-11-23T10:30");
      activity();
    }
    queue.push("CONTACT", "x", KEEP, "", false, {
      kind: "error",
      text: "Enter when the contact took place.",
    });
    activity();
    queue.push("NOTE", "", KEEP, KEEP, false, { kind: "success", text: "Note added." });
    activity();
    queue.push("CONTACT", "", KEEP, KEEP, false, { kind: "success", text: "Contact recorded." });
    activity();
    queue.push("CONTACT", "y", KEEP, KEEP, false, {
      kind: "error",
      text: "You are not allowed to do this.",
    });
    activity();
  });
});

// --- Client states of the CSV export --------------------------------------------------------------

describe("Lead export (EN)", () => {
  const exportBar = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <LeadExport
        count={7}
        maxRows={20000}
        canExport
        query="?source=CONTACT_FORM"
        filtered={false}
        {...over}
      />,
    );

  it("summaries before the click", () => {
    exportBar();
    exportBar({ filtered: true });
    exportBar({ count: 1 });
    exportBar({ count: 1, filtered: true });
    exportBar({ count: 0 });
    exportBar({ count: 0, filtered: true });
    exportBar({ count: 21_234 });
    exportBar({ count: 21_234, filtered: true });
    exportBar({ canExport: false });
    exportBar({ canExport: false, count: 0 });
  });

  it("separator choice, busy, step-up, error and done", () => {
    // LeadExport: separator, busy, needCode, code, error, done.
    queue.push(",");
    exportBar();
    queue.push(";", true);
    exportBar();
    queue.push(",", true, KEEP, KEEP);
    exportBar();
    queue.push(KEEP, false, true, "");
    exportBar();
    queue.push(KEEP, false, true, "123 456");
    exportBar();
    queue.push(KEEP, true, true, "123456");
    exportBar();
    queue.push(KEEP, false, true, "", "The verification code is incorrect.");
    exportBar();
    queue.push(
      KEEP,
      false,
      false,
      "",
      client.exportErrorMessage(403, {
        error: { code: "FORBIDDEN", message: "x", requestId: "req-403", details: [] },
      }),
    );
    exportBar();
    queue.push(
      KEEP,
      false,
      false,
      "",
      null,
      `Downloaded leads-2026-11-24.csv with ${view.leadCount(7, EN, "en")}.`,
    );
    exportBar();
    queue.push(
      ",",
      false,
      false,
      "",
      null,
      `Downloaded leads-2026-11-24.csv with ${view.leadCount(1, EN, "en")}.`,
    );
    exportBar({ count: 1 });
  });
});

// --- Notification settings ------------------------------------------------------------------------

describe("Lead notifications (EN)", () => {
  it("shows every mail transport with the site settings", async () => {
    for (const transport of ["smtp", "capture", "off"] as const) {
      const html = await notificationSettings(notifications({ transport }));
      expect(html).toContain("Last 30 days");
    }
    expect(await notificationSettings(notifications({ sites: [] }))).toContain(
      "Lead notifications",
    );
  });

  it("shows the refusal and a load error", async () => {
    expect(await notificationSettings(FORBIDDEN)).toContain(
      "Only lead managers change notifications",
    );
    expect(await notificationSettings(FAIL)).toContain("The settings could not be loaded");
    await notificationSettings(undefined);
  });

  it("the recipient form in its states", () => {
    // NotificationSettingsForm: enabled, chosen, busy, message, seenVersion.
    const form = (settings = siteSettings()) =>
      renderToStaticMarkup(<NotificationSettingsForm settings={settings} />);
    form();
    form(siteSettings({ enabled: false, recipients: [], candidates: [] }));
    form(siteSettings({ enabled: false, recipients: [] }));
    form(FULL_LIST);
    queue.push(false);
    form();
    queue.push(KEEP, [siteSettings().recipients[0]!.id, siteSettings().candidates[1]!.id]);
    form();
    queue.push(true, [], false, {
      kind: "error",
      text: "Choose at least one person, or switch the e-mail off.",
    });
    form();
    queue.push(false, KEEP, true, null);
    form();
    queue.push(KEEP, KEEP, false, {
      kind: "success",
      text: "Saved. New messages follow these settings.",
    });
    form();
    queue.push(KEEP, KEEP, false, { kind: "error", text: "You are not allowed to do this." });
    form();
  });
});

// --- Page titles and the retired page -------------------------------------------------------------

describe("Lead page titles (EN)", () => {
  it("names every page", async () => {
    // ML-12e: the titles come from generateMetadata() (UI language; English here).
    record([
      (await leadsPage.generateMetadata()).title,
      (await leadPage.generateMetadata()).title,
      (await notificationsPage.generateMetadata()).title,
    ]);
  });

  it("sends the retired customer-data-access page to Staff", () => {
    expect(() => CustomerDataAccessPage()).toThrow("NEXT_REDIRECT /staff");
  });
});

// --- View and client helpers ----------------------------------------------------------------------

describe("Lead texts (EN)", () => {
  it("labels, tones and hints of the view", () => {
    // ML-12e: the tables became t() lookups; the same JSON is rebuilt from them, code by code.
    const table = <K extends string>(codes: readonly K[], label: (k: K) => string | undefined) =>
      Object.fromEntries(codes.map((k) => [k, label(k)]));
    record({
      source: table(LEAD_SOURCES, (s) => view.sourceLabel(s, EN)),
      notification: table(LEAD_NOTIFICATION_STATUSES, (s) => view.notificationLabel(s, EN)),
      notificationTone: view.NOTIFICATION_TONE,
      reasons: table(view.NOTIFICATION_REASONS, (r) => view.notificationReason(r, EN)),
      status: table(LEAD_STATUSES, (s) => view.statusLabel(s, EN)),
      statusTone: view.STATUS_TONE,
      hints: table(LEAD_STATUSES, (s) => view.statusHint(s, EN)),
      channels: table(LEAD_CONTACT_CHANNELS, (c) => view.channelLabel(c, EN)),
      documents: table(DOCUMENT_TYPES, (d) => view.docTypeLabel(d, EN)),
    });
  });

  it("counts, export summaries and languages", () => {
    record({
      counts: [0, 1, 2, 1234, 20000].map((n) => view.leadCount(n, EN, "en")),
      summaries: [
        [0, 20000, false],
        [0, 20000, true],
        [1, 20000, false],
        [1, 20000, true],
        [5, 20000, false],
        [5, 20000, true],
        [20001, 20000, false],
        [21234, 20000, true],
      ].map(([c, m, f]) =>
        view.exportSummaryText(c as number, m as number, f as boolean, EN, "en"),
      ),
      formLanguage: [null, "en", "nl", "de", "fr"].map((l) => view.formLanguageLabel(l, EN)),
      textLanguage: ["2026-11-12.en", "2026-11-20.nl", "2026-11-11", "2026-11-20.tr"].map((v) =>
        view.textLanguageLabel(v, EN),
      ),
      countries: ["NL", "DE", "TR", "XK", "ZZ", "nl", "?"].map((c) => view.countryName(c, "en")),
    });
  });

  it("separator choices and file names of the export", () => {
    record({
      separators: client.exportSeparatorOptions(EN),
      queries: [
        client.exportQueryWithSeparator("", ";"),
        client.exportQueryWithSeparator("?source=CONTACT_FORM&separator=%2C", ";"),
        client.exportQueryWithSeparator("q=a", ","),
      ],
      filenames: [
        client.exportFilenameOf('attachment; filename="leads-2026-11-24-bv.csv"', NOW),
        client.exportFilenameOf(null, NOW),
        client.exportFilenameOf('attachment; filename="../x y.csv"', NOW),
      ],
      when: [
        client.nowLocalDateTime(NOW),
        client.localDateTimeToIso("2026-11-23T10:30"),
        client.localDateTimeToIso("yesterday"),
      ],
    });
  });

  it("every export error in plain words", () => {
    const body = (code: string, details: unknown[] = []) => ({
      error: { code, message: "x", requestId: `req-${code.toLowerCase()}`, details },
    });
    record([
      client.exportErrorMessage(0, null),
      client.exportErrorMessage(502, "not json"),
      client.exportErrorMessage(
        400,
        body("VALIDATION_FAILED", [{ path: "q", rule: "too_many_rows" }]),
      ),
      client.exportErrorMessage(
        400,
        body("VALIDATION_FAILED", [{ path: "to", rule: "before_from" }]),
      ),
      client.exportErrorMessage(
        400,
        body("VALIDATION_FAILED", [{ path: "separator", rule: "invalid" }]),
      ),
      client.exportErrorMessage(400, body("VALIDATION_FAILED", [{ path: "x", rule: "y" }])),
      client.exportErrorMessage(403, body("FORBIDDEN")),
      client.exportErrorMessage(401, body("AUTH_SESSION_REQUIRED")),
      client.exportErrorMessage(403, body("AUTH_STEP_UP_REQUIRED")),
      client.exportErrorMessage(429, body("RATE_LIMITED")),
      client.exportErrorMessage(500, body("INTERNAL_ERROR")),
      client.exportErrorMessage(503, body("BAD_GATEWAY")),
    ]);
  });

  it("answers of the export download", async () => {
    const real = globalThis.fetch;
    const json = (status: number, code: string, details: unknown[] = []) =>
      new Response(JSON.stringify({ error: { code, message: "x", requestId: "req-1", details } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    const answers: (() => Promise<Response>)[] = [
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve(json(403, "AUTH_STEP_UP_REQUIRED")),
      () => Promise.resolve(json(403, "FORBIDDEN")),
      () => Promise.resolve(json(400, "VALIDATION_FAILED", [{ path: "separator", rule: "x" }])),
      () => Promise.resolve(new Response("<html>", { status: 502 })),
      () =>
        Promise.resolve(
          new Response("a;b\n", {
            status: 200,
            headers: {
              "content-disposition": 'attachment; filename="leads-2026-11-24.csv"',
              "x-dp-export-rows": "1",
            },
          }),
        ),
      () => Promise.resolve(new Response("a;b\n", { status: 200 })),
    ];
    const results: unknown[] = [];
    for (const answer of answers) {
      globalThis.fetch = answer as never;
      const res = await client.downloadLeadExport("?q=a", ";");
      results.push(res.ok ? { filename: res.filename, rows: res.rows } : res);
    }
    globalThis.fetch = real;
    record(results);
  });

  it("list filters read from the address", () => {
    record(
      [
        {},
        { status: "converted", assignee: "NONE", source: "contact_form" },
        { from: "2026-11-30", to: "2026-11-01" },
        { from: "2026-02-30", to: "2026-03-01", q: "  acme  " },
        { site: BV, cursor: "abc" },
      ].map((q) => {
        const f = view.readLeadFilters(q);
        return [view.hasLeadFilters(f), view.leadListHref(f), view.leadExportQuery(f)];
      }),
    );
  });
});
