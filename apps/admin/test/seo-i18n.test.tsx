// ML-12d (DP-243): the SEO screens (overview, redirects) in Turkish. Every screen and state of
// seo-en.test.tsx is rendered twice on the server with the same fixtures — once in English, once
// with the `dp-admin-locale=tr` cookie — and compared:
//   1. no English UI text is left in Turkish: a visible text (text node, aria-label, title,
//      placeholder, alt) equal in both languages must be data from the fixtures (page names,
//      addresses, notes, people) or a fixed term (SAME_IN_BOTH: SEO, Noindex, CSV, 301/302 …);
//   2. the translation changes text only: the element structure, every link, query string, form
//      field, value, data-* attribute and API value is identical;
//   3. every API rule, warning and history action has a Turkish message, while the codes, request
//      paths and query strings stay the API's;
//   4. the dry-run report and the sample file stay byte-identical (English, BOM, columns, order)
//      whatever the console's language; Turkish dates come from the format module.
// English itself is covered byte for byte by the EN baseline (seo-en.test.tsx).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SEO_REDIRECT_CSV_SAMPLE } from "@dream/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { en as EN_MESSAGES } from "../lib/i18n/messages/en";
import { tr as TR_MESSAGES } from "../lib/i18n/messages/tr";
import { createTranslator } from "../lib/i18n/translate";
import {
  BV,
  CMS_CONTEXT,
  CSV,
  HISTORY,
  IMPORT_RESULT,
  ITEMS,
  OVERVIEW,
  REDIRECTS,
  ROWS,
  bvContext,
  id,
  listData,
  overviewData,
} from "./support/seo-fixtures";

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
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const seoModule = await import("../app/(console)/seo/page");
const redirectsModule = await import("../app/(console)/seo/redirects/page");
const { RedirectManager } = await import("../components/seo/redirect-manager");
const view = await import("../lib/redirects-view");
const overview = await import("../lib/seo-overview");
const client = await import("../lib/redirects-client");

const EN = createTranslator("en");
const TR = createTranslator("tr");

beforeEach(() => {
  reads.clear();
  queue.length = 0;
  reads.set(CMS_CONTEXT, bvContext);
  reads.set(OVERVIEW, overviewData());
  reads.set(REDIRECTS, listData(true));
});

/** Names, codes and technical terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "Dream Petroleum BV",
  "BV",
  "SEO",
  "Noindex",
  "CSV",
  "CMS",
  "URL",
  "KB",
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
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  for (const m of body.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of body.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
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
  walk([ITEMS, ROWS, HISTORY, IMPORT_RESULT, CSV.split("\n"), states]);
  return out;
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  if (data.some((d) => d === text || (text.length > 3 && d.includes(text)))) return true;
  // only addresses, codes and punctuation, e.g. "/c → /about-us (302)"
  if (!/[A-Za-z]{2,}/.test(text.replace(/\/[\w./?=&-]*/g, ""))) return true;
  // a file's first lines in the preview: its line breaks collapsed
  if (data.some((d) => d.replace(/\s+/g, " ").trim() === text)) return true;
  // an address, a public URL, a CSV line or file of the fixtures
  if (/^(?:https?:\/\/|localhost:|\/)\S*(?: › \S+)*$/.test(text)) return true;
  if (/^[\w.-]+\.(?:csv|webp)$/.test(text)) return true;
  const rest = text
    .split(/\s*(?:·|,|\/|—|–|:|;|\(|\)|\||→|›|\?|=)\s*/)
    .filter((p) => /[A-Za-z]{2,}/.test(p));
  return rest.length > 0 && rest.every((p) => SAME_IN_BOTH.has(p) || data.includes(p));
}

/** The markup without any visible text: tags and every attribute people do not read. */
function structure(html: string): string {
  return html
    .replace(/\s(?:aria-label|title|placeholder|alt)="[^"]*"/g, "")
    .replace(/>[^<]*</g, "><")
    .replace(/<!-- -->/g, "")
    .replace(/<title>[^<]*<\/title>/g, "");
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

const seo =
  (q: Record<string, string> = {}): Render =>
  () =>
    seoModule.default({ searchParams: Promise.resolve(q) } as never) as Promise<ReactElement>;
const redirects =
  (q: Record<string, string> = {}): Render =>
  () =>
    redirectsModule.default({ searchParams: Promise.resolve(q) } as never) as Promise<ReactElement>;
const manager = (manage = true, over: Record<string, unknown> = {}): Render =>
  function ManagerScreen() {
    return <RedirectManager data={listData(manage, over) as never} />;
  };

const none = () => undefined;
const keep = (n: number) => Array.from({ length: n }, () => KEEP);
const readOnlyPermissions = {
  ...overviewData().permissions,
  editPages: false,
  publishPages: false,
  editProducts: false,
};
const settings = overviewData().settings;

describe("SEO in Turkish: every screen and state", () => {
  const screens: [string, () => void, Render, unknown[]?][] = [
    ["overview", none, seo()],
    ...(["attention", "noindex", "pending", "products", "pages"] as const).map(
      (filter): [string, () => void, Render] => [
        `overview, filter ${filter}`,
        none,
        seo({ filter }),
      ],
    ),
    [
      "overview, empty filter",
      () => reads.set(OVERVIEW, overviewData({ items: ITEMS.filter((i) => i.source === "cms") })),
      seo({ filter: "products" }),
    ],
    [
      "overview, defaults draft",
      () =>
        reads.set(
          OVERVIEW,
          overviewData({ settings: { ...settings, published: false }, liveSettings: null }),
        ),
      seo(),
    ],
    [
      "overview, defaults changed",
      () => reads.set(OVERVIEW, overviewData({ settings: { ...settings, pendingChanges: true } })),
      seo(),
    ],
    [
      "overview, built-in defaults",
      () => reads.set(OVERVIEW, overviewData({ settings: null, liveSettings: null })),
      seo(),
    ],
    [
      "overview, read only",
      () => reads.set(OVERVIEW, overviewData({ permissions: readOnlyPermissions })),
      seo(),
    ],
    [
      "overview, read only, built-in defaults",
      () =>
        reads.set(
          OVERVIEW,
          overviewData({ settings: null, liveSettings: null, permissions: readOnlyPermissions }),
        ),
      seo(),
    ],
    ["overview, no rows", () => reads.set(OVERVIEW, overviewData({ items: [] })), seo()],
    ["overview, no access", () => reads.delete(CMS_CONTEXT), seo()],
    ["overview, refused", () => reads.set(OVERVIEW, FORBIDDEN), seo()],
    ["overview, load error", () => reads.set(OVERVIEW, FAIL), seo()],
    ["redirects", none, redirects()],
    ["redirects, read only", () => reads.set(REDIRECTS, listData(false)), redirects()],
    [
      "redirects, filtered, page 2",
      () =>
        reads.set(
          `${REDIRECTS}?q=old&origin=IMPORT&status=302&active=false&sort=source&dir=asc&page=2`,
          listData(true, { page: 2, total: 160 }),
        ),
      redirects({
        q: "old",
        origin: "IMPORT",
        status: "302",
        active: "false",
        sort: "source",
        dir: "asc",
        page: "2",
      }),
    ],
    [
      "redirects, one",
      () => reads.set(REDIRECTS, listData(true, { items: [ROWS[0]], total: 1 })),
      redirects(),
    ],
    [
      "redirects, empty",
      () => reads.set(REDIRECTS, listData(true, { items: [], total: 0 })),
      redirects(),
    ],
    ["redirects, no access", () => reads.delete(CMS_CONTEXT), redirects()],
    ["redirects, refused", () => reads.set(REDIRECTS, FORBIDDEN), redirects()],
    ["redirects, load error", () => reads.set(REDIRECTS, FAIL), redirects()],
    [
      "notice with warnings",
      none,
      manager(),
      [
        KEEP,
        KEEP,
        {
          text: TR("seo.redirects.manager.saved"),
          warnings: ["target:not_live", "source:draft_content"],
        },
      ],
    ],
    ["create form", none, manager(), [{ mode: "create" }]],
    [
      "create form with an error",
      none,
      manager(),
      [
        { mode: "create" },
        KEEP,
        KEEP,
        "/old",
        "/old",
        KEEP,
        KEEP,
        KEEP,
        false,
        { message: TR("seo.redirects.rules.targetSelf"), fields: ["target"] },
      ],
    ],
    ["create form saving", none, manager(), [{ mode: "create" }, KEEP, KEEP, ...keep(5), true]],
    ["edit form", none, manager(), [{ mode: "edit", item: ROWS[0] }]],
    [
      "edit form, protected",
      none,
      manager(),
      [{ mode: "edit", item: ROWS[2] }, KEEP, KEEP, ...keep(10)],
    ],
    ["delete confirmation", none, manager(), [KEEP, KEEP, KEEP, true]],
    ["deleting", none, manager(), [KEEP, KEEP, KEEP, true, true]],
    ["history loading", none, manager(), [KEEP, KEEP, KEEP, ...keep(4), true]],
    ["history empty", none, manager(), [KEEP, KEEP, KEEP, ...keep(3), [], true]],
    ["history", none, manager(), [KEEP, KEEP, KEEP, ...keep(3), HISTORY, true]],
    ["import, start", none, manager(), [KEEP, true]],
    ["import, file read", none, manager(), [KEEP, true, KEEP, CSV, "redirects.csv"]],
    [
      "import, dry-run with errors",
      none,
      manager(),
      [KEEP, true, KEEP, CSV, "redirects.csv", IMPORT_RESULT, false, null, false],
    ],
    [
      "import, dry-run issues only",
      none,
      manager(),
      [KEEP, true, KEEP, CSV, "redirects.csv", IMPORT_RESULT],
    ],
    [
      "import, ready",
      none,
      manager(),
      [
        KEEP,
        true,
        KEEP,
        CSV,
        "redirects.csv",
        {
          ...IMPORT_RESULT,
          summary: { ...IMPORT_RESULT.summary, error: 0 },
          rows: IMPORT_RESULT.rows.slice(0, 3),
        },
      ],
    ],
    [
      "import, nothing to do",
      none,
      manager(),
      [
        KEEP,
        true,
        KEEP,
        CSV,
        "same.csv",
        {
          ...IMPORT_RESULT,
          summary: { rows: 1, create: 0, update: 0, unchanged: 1, error: 0 },
          rows: [IMPORT_RESULT.rows[2]],
        },
      ],
    ],
    ["manager, read only", none, manager(false)],
    ["manager, read only, empty", none, manager(false, { items: [] })],
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
});

describe("SEO in Turkish: texts, codes and files", () => {
  it("names the overview's filters, kinds and notes in Turkish", () => {
    expect(overview.SEO_FILTERS.map((f) => overview.seoFilterLabel(f.id, TR))).toEqual([
      "Tümü",
      "İlgilenilmesi gerekenler",
      "Noindex",
      "Yayınlanmamış",
      "Ürünler",
      "Sayfalar ve makaleler",
    ]);
    expect(overview.seoKindLabel("products", TR)).toBe("Ürün listesi");
    expect(ITEMS.flatMap((i) => overview.seoNotes(i, TR))).toEqual([
      "Meta açıklama yok (yedek metin kullanılıyor)",
      "Açıklama kesilebilir",
      "Başlık kesilebilir",
      "Kanonik → /en/about-us",
      "Kanonik yol geçerli değil",
    ]);
    // the filters and what needs attention do not depend on the language
    expect(ITEMS.map((i) => overview.needsAttention(i))).toEqual([
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("has a Turkish message for every API rule and warning, codes unchanged", () => {
    const rules = Object.keys(EN_MESSAGES.seo.redirects.rules);
    expect(rules.length).toBeGreaterThan(30);
    for (const code of [
      "source:required",
      "source:live_content",
      "source:duplicate",
      "source:chain",
      "target:self",
      "target:chain",
      "target:external",
      "redirect:protected",
      "version:stale",
      "csv.12:quote",
      "csv:too_large",
      "csv:too_many_rows",
    ]) {
      expect(view.knownRule(code), code).toBe(true);
      expect(view.ruleMessage(code, TR), code).not.toBe(view.ruleMessage(code, EN));
    }
    expect(view.ruleMessage("csv:too_large", TR)).toBe("Dosya çok büyük (en fazla 128 KB).");
    expect(view.ruleMessage("csv:too_many_rows", TR)).toBe(
      "Dosya başına en fazla 1000 yönlendirme.",
    );
    expect(view.ruleMessage("weird:thing", TR)).toBe("weird alanını kontrol edin (thing).");
    expect(view.warningMessage("target:not_live", TR)).toContain("404");
    expect(view.warningMessage("other:code", TR)).toBe("other:code");
    expect(view.importActionLabel("error", TR)).toBe("Hata");
    expect(view.importActionLabel("other", TR)).toBe("other");
    expect(view.originLabel("SLUG_CHANGE", TR)).toBe("Slug değişikliği");
    expect(view.sortLabel("target", TR)).toBe("Hedef adres");
  });

  it("names the API's refusals in Turkish by code", () => {
    expect(
      client.redirectErrorMessage(
        "CONFLICT_STATE",
        [
          { path: "source", rule: "duplicate" },
          { path: "target", rule: "chain" },
        ],
        TR,
      ),
    ).toBe(
      `${TR_MESSAGES.seo.redirects.rules.sourceDuplicate} ${TR_MESSAGES.seo.redirects.rules.targetChain}`,
    );
    expect(client.redirectErrorMessage("FORBIDDEN", [], TR)).toBe(TR_MESSAGES.errors.FORBIDDEN);
    expect(client.redirectErrorMessage(null, [], TR)).toBe(TR_MESSAGES.seo.redirects.api.notSaved);
  });

  it("summarises the history in Turkish; paths, codes and field keys stay", () => {
    expect(HISTORY.map((e) => view.historyActionLabel(e.action, e.details, TR))).toEqual([
      "Değiştirildi",
      "Oluşturuldu (içe aktarma)",
      "Hedef içeriği izledi",
      "Devre dışı bırakıldı (içerik yeniden yayında)",
      "Silindi",
      "seo.unknown_action",
    ]);
    expect(view.historySummary(HISTORY[1]!.details, TR)).toBe(
      "/old-1?x=1 · → /contact · 302 · devre dışı",
    );
    expect(view.historySummary(HISTORY[0]!.details, TR)).toBe(
      "/old-1 · → /about-us · değişen: target, note",
    );
    expect(view.historySummary(HISTORY[2]!.details, TR)).toBe(
      "→ /products/new-oil · (önceki: /products/old-oil)",
    );
  });

  it("keeps the dry-run report and the sample file byte-identical in every language", async () => {
    const report = view.importReportCsv(IMPORT_RESULT);
    // The report never takes the console language: same bytes from an English and a Turkish page.
    ui.locale = "tr";
    expect(view.importReportCsv(IMPORT_RESULT)).toBe(report);
    expect(report.split("\r\n")[0]).toBe(
      "line,result,source,target,status,active,note,errors,warnings",
    );
    expect(report).toContain(
      `2,New,/a,/b,301,true,'=cmd(),,${EN("seo.redirects.warnings.targetNotLive")}`,
    );
    expect(report).toContain(EN("seo.redirects.rules.sourceRequired"));
    expect(report).not.toContain(TR("seo.redirects.rules.sourceRequired"));
    expect(report.endsWith("\r\n")).toBe(true);
    expect(SEO_REDIRECT_CSV_SAMPLE.split("\n")[0]).toBe("source,target,status,active,note");
  });

  it("formats dates in Turkish and leaves query strings and links alone", async () => {
    const tr = await render(manager(), "tr", [KEEP, KEEP, KEEP, ...keep(3), HISTORY, true]);
    expect(tr).toContain("20 Kas 2026 09:05");
    expect(tr).toContain("tarihinde Editor (fixture) değiştirdi");
    const page = await render(redirects(), "tr");
    expect(page).toContain(`href="/seo/redirects?origin=SLUG_CHANGE"`);
    expect(page).toContain(`href="/products/${id(9)}?site=bv&amp;tab=seo"`);
    expect(page).toContain(`value="updated"`);
    expect(BV).toBe(listData(true).site.id);
  });
});
