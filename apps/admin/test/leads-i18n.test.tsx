// ML-12e (DP-243): the Leads screens (list, a lead, notifications) in Turkish. Every screen and
// state of leads-en.test.tsx is rendered twice on the server with the same fixtures — once in
// English, once with the `dp-admin-locale=tr` cookie — and compared:
//   1. no English UI text is left in Turkish: a visible text (text node, aria-label, title,
//      placeholder, alt) equal in both languages must be data from the fixtures (names, companies,
//      e-mail addresses, messages, document titles, site names, versions, hashes) or a fixed term;
//   2. the translation changes text only: the element structure, every link, query string, form
//      field, value and API value is identical;
//   3. consent evidence is never translated: versions, SHA-256 values and the stored form language
//      stay as stored, only the label of a missing language ("not recorded, before ML-10") is UI;
//   4. the CSV export request (path, query, separator, Accept header) and its file name are
//      byte-identical whatever the console's language; Turkish dates and numbers come from the
//      format module, plurals from the dictionary.
// English itself is covered byte for byte by the EN baseline (leads-en.test.tsx).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { en as EN_MESSAGES } from "../lib/i18n/messages/en";
import { tr as TR_MESSAGES } from "../lib/i18n/messages/tr";
import { createTranslator } from "../lib/i18n/translate";
import {
  AT,
  BV,
  FULL_LIST,
  FULL_PAGE,
  GONE,
  LEADS,
  LEADS_API,
  MESSAGES,
  NOTIFICATIONS_API,
  OTHER,
  REQUESTS,
  SHA,
  SHA2,
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

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const KEEP = Symbol("keep");
const queue = vi.hoisted(() => [] as unknown[]);
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
const { LeadExport } = await import("../components/leads/lead-export");
const { LeadActivityForm, LeadWorkflowForm } = await import("../components/leads/lead-workflow");
const { NotificationSettingsForm } = await import("../components/leads/notification-settings");
const view = await import("../lib/leads-view");
const client = await import("../lib/leads-client");

const EN = createTranslator("en");
const TR = createTranslator("tr");
const NOW = new Date("2026-11-24T09:15:00.000Z");

beforeAll(() => {
  process.env["TZ"] = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

beforeEach(() => {
  reads.clear();
  queue.length = 0;
});

/** Names, codes and technical terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "Dream Petroleum BV",
  "Dream Petroleum Corporate",
  "BV",
  "Corporate",
  "Site",
  "CSV",
  "CRM",
  "HTTP",
  // a country whose English name is its own (Intl region names)
  "Türkiye",
]);

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

/** Every string value of the fixtures and of the given states: data that is shown as it is. */
function fixtureData(states: unknown[] = []): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const v of reads.values()) walk(v);
  walk([LEADS, FULL_PAGE, MESSAGES, REQUESTS, detail(), notifications(), FULL_LIST, states]);
  return out;
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  if (data.some((d) => d === text || (text.length > 3 && d.includes(text)))) return true;
  // a multi-line text (note, message) with its line breaks collapsed
  if (data.some((d) => d.replace(/\s+/g, " ").trim() === text)) return true;
  // the first 12 characters of a stored SHA-256 (consent text, stamped PDF)
  if (/^[0-9a-f]{12}…$/.test(text)) return true;
  const rest = text
    .split(/\s*(?:·|,|\/|—|–|:|;|\(|\)|\||→|\?|=)\s*/)
    .filter((p) => /[A-Za-z]{2,}/.test(p));
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

/** The list page: list and export summary at their real API paths. */
const leadsList =
  (query: Record<string, string> = {}, data: unknown = list(), sum: unknown = summary()): Render =>
  () => {
    const filters = view.readLeadFilters(query);
    reads.set(`${LEADS_API}${view.leadListQuery(filters)}`, data);
    reads.set(`${SUMMARY_API}${view.leadExportQuery(filters)}`, sum);
    return leadsPage.default({
      searchParams: Promise.resolve(query),
    } as never) as Promise<ReactElement>;
  };
const lead =
  (value: unknown, leadId = id(1)): Render =>
  () => {
    if (value !== undefined) reads.set(detailPath(leadId), value);
    return leadPage.default({
      params: Promise.resolve({ id: leadId }),
    } as never) as Promise<ReactElement>;
  };
const settingsPage =
  (value: unknown): Render =>
  () => {
    if (value !== undefined) reads.set(NOTIFICATIONS_API, value);
    return notificationsPage.default() as Promise<ReactElement>;
  };
const workflow = (over: Record<string, unknown> = {}): Render =>
  function WorkflowScreen() {
    return (
      <LeadWorkflowForm
        leadId={id(1)}
        status="NEW"
        assignedToId={null}
        version={2}
        assignees={detail().assignees}
        viewerId={VIEWER}
        {...over}
      />
    );
  };
const activityForm: Render = function ActivityScreen() {
  return <LeadActivityForm leadId={id(1)} />;
};
const exportBar = (over: Record<string, unknown> = {}): Render =>
  function ExportScreen() {
    return (
      <LeadExport
        count={7}
        maxRows={20000}
        canExport
        query="?source=CONTACT_FORM"
        filtered={false}
        {...over}
      />
    );
  };
const recipients = (settings = siteSettings()): Render =>
  function RecipientsScreen() {
    return <NotificationSettingsForm settings={settings} />;
  };

describe("Leads in Turkish: every screen and state", () => {
  const screens: [string, Render, unknown[]?][] = [
    ["list", leadsList()],
    ["list, next page", leadsList({}, list({ items: FULL_PAGE, nextCursor: "next_1" }))],
    [
      "list, second page",
      leadsList({ cursor: "next_1" }, list({ items: FULL_PAGE, nextCursor: "next_2" })),
    ],
    [
      "list, every filter",
      leadsList(
        {
          site: BV,
          q: "buyer",
          status: "NEW",
          source: "DOCUMENT_REQUEST",
          assignee: "me",
          from: "2026-10-01",
          to: "2026-11-24",
        },
        list(),
        summary(3),
      ),
    ],
    ["list, empty", leadsList({}, list({ items: [] }), summary(0))],
    ["list, no match", leadsList({ status: "CONVERTED" }, list({ items: [] }), summary(0))],
    ["list, export too large", leadsList({}, list(), summary(25_000))],
    ["list, export not allowed", leadsList({}, list(), summary(7, false))],
    ["list, one lead to export", leadsList({}, list(), summary(1))],
    ["list, export count failed", leadsList({}, list(), FAIL)],
    ["list, no access", leadsList({}, FORBIDDEN)],
    ["list, load error", leadsList({}, FAIL)],
    ["lead", lead(detail())],
    ...(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"] as const).map(
      (status): [string, Render] => [`lead, ${status}`, lead(detail({}, { status }))],
    ),
    [
      "lead, customer on hold",
      lead(detail({}, { retentionHold: "CUSTOMER", status: "CONVERTED" })),
    ],
    [
      "lead, open opportunity, free mail",
      lead(detail({}, { retentionHold: "OPEN_OPPORTUNITY", freeMailDomain: true })),
    ],
    [
      "lead, legal hold, no consent",
      lead(detail({}, { retentionHold: "LEGAL_HOLD", marketingConsentAt: null })),
    ],
    ["lead, unassigned", lead(detail({}, { assignedTo: null }))],
    [
      "lead, assignee lost access",
      lead(
        detail({}, { assignedTo: { id: GONE, displayName: "Former Colleague", active: false } }),
      ),
    ],
    ["lead, read only", lead(detail({ canManage: false, assignees: [] }))],
    [
      "lead, anonymised",
      lead(
        detail(
          { canManage: false, assignees: [] },
          { anonymisedAt: AT, fullName: "", company: "", email: "", status: "QUALIFIED" },
        ),
      ),
    ],
    [
      "lead, nothing yet",
      lead(detail({ activities: [], contactMessages: [], requests: [] }, { requestCount: 0 })),
    ],
    ["lead, no access", lead(FORBIDDEN)],
    ["lead, load error", lead(FAIL)],
    ["workflow form", workflow()],
    ["workflow form, final", workflow({ status: "CONVERTED" })],
    ["workflow form, assignee lost access", workflow({ assignedToId: GONE })],
    ["workflow form, assigned to someone else", workflow({ assignedToId: OTHER })],
    ["workflow form, move chosen", workflow({ status: "QUALIFIED" }), ["CONVERTED"]],
    ["workflow form, saving", workflow(), ["CONTACTED", OTHER, "Agreed a call.", true, null]],
    [
      "workflow form, saved",
      workflow(),
      [KEEP, KEEP, KEEP, false, { kind: "success", text: TR("leads.workflow.saved") }],
    ],
    ["activity form", activityForm],
    ["activity form, contact", activityForm, ["CONTACT", "x", "MEETING", "2026-11-23T10:30"]],
    [
      "activity form, missing time",
      activityForm,
      [
        "CONTACT",
        "x",
        KEEP,
        "",
        false,
        { kind: "error", text: TR("leads.workflow.activity.whenRequired") },
      ],
    ],
    [
      "activity form, note added",
      activityForm,
      [
        "NOTE",
        "",
        KEEP,
        KEEP,
        false,
        { kind: "success", text: TR("leads.workflow.activity.noteAdded") },
      ],
    ],
    ["export", exportBar()],
    ["export, filtered", exportBar({ filtered: true })],
    ["export, nothing", exportBar({ count: 0 })],
    ["export, nothing filtered", exportBar({ count: 0, filtered: true })],
    ["export, too many", exportBar({ count: 21_234 })],
    ["export, not allowed", exportBar({ canExport: false })],
    ["export, comma", exportBar(), [","]],
    ["export, busy", exportBar(), [";", true]],
    ["export, step-up", exportBar(), [KEEP, false, true, "123 456"]],
    [
      "export, done",
      exportBar(),
      [
        KEEP,
        false,
        false,
        "",
        null,
        TR("leads.export.done", {
          file: "leads-2026-11-24.csv",
          leads: view.leadCount(7, TR, "tr"),
        }),
      ],
    ],
    ["notifications", settingsPage(notifications())],
    ["notifications, capture", settingsPage(notifications({ transport: "capture" }))],
    ["notifications, off", settingsPage(notifications({ transport: "off" }))],
    ["notifications, refused", settingsPage(FORBIDDEN)],
    ["notifications, load error", settingsPage(FAIL)],
    ["recipients", recipients()],
    [
      "recipients, nobody",
      recipients(siteSettings({ enabled: false, recipients: [], candidates: [] })),
    ],
    ["recipients, full list", recipients(FULL_LIST)],
    ["recipients, changed", recipients(), [false]],
    [
      "recipients, error",
      recipients(),
      [true, [], false, { kind: "error", text: TR("leads.notifications.form.chooseOne") }],
    ],
  ];

  for (const [name, make, states] of screens) {
    it(name, async () => {
      const { en, tr, left } = await compare(make, states);
      expect(left, `English left in Turkish (${name})`).toEqual([]);
      expect(structure(tr), `markup changed (${name})`).toBe(structure(en));
      expect(tr).not.toBe(en);
    });
  }

  it("throws notFound for an unknown lead in both languages", async () => {
    await expect(render(lead(undefined, id(404)), "tr")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("names every page in Turkish", async () => {
    ui.locale = "tr";
    expect((await leadsPage.generateMetadata()).title).toBe("Talepler");
    expect((await leadPage.generateMetadata()).title).toBe("Talep");
    expect((await notificationsPage.generateMetadata()).title).toBe("Talep bildirimleri");
    ui.locale = "en";
    expect((await notificationsPage.generateMetadata()).title).toBe("Lead notifications");
  });
});

describe("Leads in Turkish: labels, evidence, dates and the export", () => {
  it("labels every status, source, notification, channel and document type", () => {
    expect(view.statusLabel("CONVERTED", TR)).toBe("Müşteriye dönüştü");
    expect(view.statusHint("UNQUALIFIED", TR)).toBe("Uygun değil. Yeniden açılabilir.");
    expect(view.sourceLabel("DOCUMENT_REQUEST", TR)).toBe("Belge talebi");
    expect(view.notificationLabel("FAILED", TR)).toBe("E-posta gönderilemedi");
    expect(view.channelLabel("MEETING", TR)).toBe("Toplantı");
    expect(view.docTypeLabel("COA", TR)).toBe("Analiz sertifikası");
    for (const r of view.NOTIFICATION_REASONS)
      expect(view.notificationReason(r, TR)).not.toBe(view.notificationReason(r, EN));
    // an unknown or missing reason code has no words: the screen shows the code
    expect(view.notificationReason("new_reason", TR)).toBeUndefined();
    expect(view.notificationReason(null, TR)).toBeUndefined();
    expect(view.notificationReason("toString", TR)).toBeUndefined();
  });

  it("counts in Turkish (number format, singular noun after a number)", () => {
    expect(view.leadCount(1, TR, "tr")).toBe("1 talep");
    expect(view.leadCount(1234, TR, "tr")).toBe("1.234 talep");
    expect(view.exportSummaryText(21_234, 20_000, false, TR, "tr")).toBe(
      "21.234 talep uyuyor. Bir dışa aktarma en fazla 20.000 talep içerir; dışa aktarmak için filtreleri (örneğin tarihleri) daraltın.",
    );
    expect(view.exportSummaryText(3, 20_000, true, TR, "tr")).toBe(
      "Bu filtrelere uyan 3 talep dışa aktarılacak.",
    );
    expect(TR("leads.detail.messages.sent", { count: 3, date: "x" })).toBe(
      "x tarihinde 3 kişiye gönderildi",
    );
    expect(TR("leads.list.documentRequests", { count: 3 })).toBe("3 belge talebi");
  });

  it("translates only the label of a form language; tags, versions and hashes stay", async () => {
    expect(view.formLanguageLabel(null, TR)).toBe("İngilizce (kaydedilmedi, ML-10 öncesi)");
    expect(view.formLanguageLabel("nl", TR)).toBe("Felemenkçe");
    expect(view.formLanguageLabel("de", TR)).toBe("de");
    expect(view.textLanguageLabel("2026-11-11", TR)).toBe("İngilizce");
    const tr = await render(lead(detail()), "tr");
    for (const evidence of [
      "sürüm 2026-11-13.en (İngilizce)",
      "sürüm 2026-11-11 (İngilizce)",
      "sürüm 2026-11-20.nl (Felemenkçe)",
      "verildi (sürüm 2026-11-12.en, İngilizce)",
      "verildi (sürüm null)",
      `title="${SHA}"`,
      `title="${SHA2}"`,
      `${SHA.slice(0, 12)}…`,
      "İngilizce (kaydedilmedi, ML-10 öncesi)",
      "Jan Buyer 1",
      "Message 1: please send prices for SN 500.",
      "Question 2 about base oils",
      "Product data 1",
      "DP-REQ-1001",
      "+31 10 123 45 67",
      "weird_code",
    ])
      expect(tr, evidence).toContain(evidence);
    expect(tr).not.toContain("English (not recorded");
  });

  it("formats dates, sizes and countries in Turkish", async () => {
    const tr = await render(lead(detail()), "tr");
    expect(tr).toContain("18 Kas 2026 13:00");
    expect(tr).toContain("2,5 MB");
    expect(tr).toContain("Hollanda");
    expect(view.countryName("NL", "tr")).toBe("Hollanda");
    expect(view.countryName("ZZ", "tr")).toBe(view.countryName("ZZ", "tr"));
    expect(view.countryName("not-a-code", "tr")).toBe("not-a-code");
    const en = await render(lead(detail()), "en");
    expect(en).toContain("2.5 MB");
    expect(en).toContain("Netherlands");
  });

  it("keeps links, query strings and form values the same in Turkish", async () => {
    const make = leadsList(
      { cursor: "next_1", status: "NEW" },
      list({ items: FULL_PAGE, nextCursor: "n2" }),
    );
    const tr = await render(make, "tr");
    expect(tr).toContain('href="/leads?status=NEW&amp;cursor=n2"');
    expect(tr).toContain('href="/leads?status=NEW"');
    expect(tr).toContain('value="CONTACT_FORM"');
    expect(tr).toContain('<option value=";" selected="">Noktalı virgül (;)</option>');
  });

  it("sends the same export request and keeps the file name in every language", async () => {
    const real = globalThis.fetch;
    const calls: unknown[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response("a;b\n", {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="leads-2026-11-24.csv"',
          "x-dp-export-rows": "1",
        },
      });
    }) as never;
    const en = await client.downloadLeadExport("?q=a&separator=%2C", ";", "en");
    const tr = await client.downloadLeadExport("?q=a&separator=%2C", ";", "tr");
    globalThis.fetch = real;
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]).toEqual([
      "/api/v1/admin/leads/export.csv?q=a&separator=%3B",
      {
        method: "GET",
        headers: { Accept: "text/csv, application/json" },
        credentials: "same-origin",
        cache: "no-store",
      },
    ]);
    expect(en.ok && tr.ok && [en.filename, tr.filename]).toEqual([
      "leads-2026-11-24.csv",
      "leads-2026-11-24.csv",
    ]);
    expect(client.exportFilenameOf(null, NOW)).toBe("leads-2026-11-24.csv");
    expect(client.exportSeparatorOptions(TR).map((o) => o.value)).toEqual(
      client.exportSeparatorOptions(EN).map((o) => o.value),
    );
  });

  it("explains a refused export in Turkish; codes and request ids stay", () => {
    const body = (code: string, details: unknown[] = []) => ({
      error: { code, message: "x", requestId: "req-7", details },
    });
    expect(client.exportErrorMessage(403, body("FORBIDDEN"), "tr")).toBe(
      `${TR_MESSAGES.leads.export.errors.forbidden} (HTTP 403, FORBIDDEN, istek req-7)`,
    );
    expect(
      client.exportErrorMessage(
        400,
        body("VALIDATION_FAILED", [{ path: "q", rule: "too_many_rows" }]),
        "tr",
      ),
    ).toBe(
      "Tek bir dosya için çok fazla talep var (en fazla 20.000). Filtreleri, örneğin tarihe göre, daraltın. (HTTP 400, VALIDATION_FAILED, istek req-7)",
    );
    expect(client.exportErrorMessage(429, body("RATE_LIMITED"), "tr")).toBe(
      `${TR_MESSAGES.errors.RATE_LIMITED} (HTTP 429, RATE_LIMITED, istek req-7)`,
    );
    expect(client.exportErrorMessage(0, null, "tr")).toBe(
      TR_MESSAGES.leads.export.errors.unreachable,
    );
    expect(client.exportErrorMessage(502, "x", "tr")).toBe(
      "Dışa aktarma başarısız oldu (HTTP 502). Biraz sonra tekrar deneyin.",
    );
    // English stays the English of before ML-12e
    expect(client.exportErrorMessage(403, body("FORBIDDEN"), "en")).toBe(
      `${EN_MESSAGES.leads.export.errors.forbidden} (HTTP 403, FORBIDDEN, request req-7)`,
    );
  });
});
