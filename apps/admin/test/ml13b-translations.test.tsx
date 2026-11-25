// ML-13b (DP-244): Admin > Translations (translation packages of ML-13a).
//   1. lib/translation-packages.ts — reading a package file (size, JSON, format, version, schema,
//      the 4 MB request body), report rows, filters, pages, reasons, the assistant extension point;
//   2. lib/translation-packages-client.ts — the contract's paths and bodies, every refusal of the
//      API as a message (EN/TR), the import's "no answer in time" case;
//   3. the page and the client screen rendered on the server in English and Turkish, in each state
//      (useState queued, as the other render tests): no access, error, export form, loaded
//      package, check result, missing permissions, confirmation, import result;
//   4. drift guards: every unit rule the API source names has a message; no hard-coded UI text.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  errorBody,
  TRANSLATION_PACKAGE_API,
  TRANSLATION_PACKAGE_MAX_BODY_BYTES,
  type TranslationImportReport,
} from "@dream/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";
import type { PlainKey } from "../lib/i18n/types";
import { listFiles, scanFiles } from "./support/ui-literals";
import {
  BV_ID,
  BV_LOCALES,
  CORP_ID,
  GROUP,
  LISTING,
  ROWS,
  pkg,
  report,
  sha,
  unit,
} from "./support/translation-fixtures";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const readPaths: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dp-admin-locale" ? { value: ui.locale } : undefined),
    has: () => false,
  }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (p: string, schema: { parse(v: unknown): unknown }) => {
    readPaths.push(p);
    if (!reads.has(p)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(p);
    if (v === FAIL) return { ok: false, status: 500, code: "INTERNAL_ERROR" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const pageModule = await import("../app/(console)/translations/page");
const { TranslationWorkspace } = await import("../components/translations/translation-workspace");
const lib = await import("../lib/translation-packages");
const client = await import("../lib/translation-packages-client");

const EN = createTranslator("en");
const TR = createTranslator("tr");
const CMS = "/api/v1/admin/cms/context";
const CATALOG = "/api/v1/admin/catalog/context";

const cmsSite = (id: string, key: "BV" | "CORPORATE", name: string, locales = BV_LOCALES) => ({
  id,
  key,
  name,
  locale: "en",
  canEdit: true,
  canPublish: true,
  locales,
});
const catalogSite = (id: string, key: "BV" | "CORPORATE", name: string) => ({
  id,
  key,
  name,
  canEdit: true,
  canPublish: false,
});
const SITES = [
  {
    id: BV_ID,
    key: "BV" as const,
    name: "Dream Petroleum BV",
    sourceLocale: "en",
    targets: [{ locale: "nl", public: false }],
    read: { cms: true, catalog: true },
  },
];

beforeEach(() => {
  reads.clear();
  readPaths.length = 0;
  queue.length = 0;
  ui.locale = "en";
  reads.set(CMS, { sites: [cmsSite(BV_ID, "BV", "Dream Petroleum BV")] });
  reads.set(CATALOG, {
    sites: [catalogSite(BV_ID, "BV", "Dream Petroleum BV")],
    canEditMaster: true,
    canApprove: false,
  });
});

async function renderPage(locale: AdminLocale = "en") {
  ui.locale = locale;
  const tree = (await pageModule.default()) as ReactElement;
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
}

/** States of TranslationWorkspace's hooks, in render order (KEEP = initial). */
interface Screen {
  loaded?: { fileName: string; pkg: ReturnType<typeof pkg> } | null;
  report?: TranslationImportReport | null;
  confirming?: boolean;
  importing?: boolean;
  importError?: string | null;
  done?: { report: TranslationImportReport; pkg: ReturnType<typeof pkg> } | null;
  filter?: string;
  ack?: boolean;
}
function renderScreen(s: Screen, locale: AdminLocale = "en", sites = SITES) {
  queue.length = 0;
  // ExportPanel: siteId, target, types, pending, error, done
  queue.push(KEEP, KEEP, KEEP, KEEP, KEEP, KEEP);
  // ImportPanel: loaded, fileError, reading, checking, report, error, confirming, importing,
  // importError, done
  queue.push(
    s.loaded ?? KEEP,
    KEEP,
    KEEP,
    KEEP,
    s.report ?? KEEP,
    KEEP,
    s.confirming ?? KEEP,
    s.importing ?? KEEP,
    s.importError ?? KEEP,
    s.done ?? KEEP,
  );
  // ReportView: filter, query, page — then ConfirmImport: ack
  if (s.report || s.done) queue.push(s.filter ?? KEEP, KEEP, KEEP);
  if (s.confirming) queue.push(s.ack ?? KEEP);
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <TranslationWorkspace sites={sites} />
    </LocaleProvider>,
  );
}

const CHIP_OFF =
  "rounded-full px-3 py-1 text-sm ring-1 ring-inset bg-surface-2 text-ink-2 ring-line hover:text-ink";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

// --- 1. lib -------------------------------------------------------------------------------------

describe("reading a package file", () => {
  it("accepts an exported package, also with a byte order mark", () => {
    const json = JSON.stringify(pkg());
    const read = lib.readPackageFile(json);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.pkg.units).toHaveLength(ROWS.length);
      expect(read.bodyBytes).toBe(new TextEncoder().encode(lib.requestBody(read.pkg)).byteLength);
    }
    expect(lib.readPackageFile(`﻿${json}`).ok).toBe(true);
  });

  it("refuses empty files, non-JSON, other formats and versions before sending anything", () => {
    const problem = (t: string) => {
      const r = lib.readPackageFile(t);
      return r.ok ? "ok" : r.problem;
    };
    expect(problem("   ")).toBe("empty");
    expect(problem("{not json")).toBe("not_json");
    expect(problem("[]")).toBe("not_package");
    expect(problem(JSON.stringify({ format: "other", version: 1 }))).toBe("not_package");
    expect(problem(JSON.stringify({ ...pkg(), version: 2 }))).toBe("version");
  });

  it("names where a package breaks the schema (at most five paths)", () => {
    const bad = pkg();
    const units = bad.units.map((u, i) => (i < 7 ? { ...u, sourceHash: "x" } : u));
    const r = lib.readPackageFile(JSON.stringify({ ...bad, units, extra: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("schema");
      expect(r.paths.length).toBeLessThanOrEqual(5);
      expect(r.paths[0]).toMatch(/^(units\.0\.sourceHash|\(package\))$/);
    }
  });

  it("refuses a file above 4 MB by its size, and a package whose request body would exceed 4 MB", () => {
    expect(TRANSLATION_PACKAGE_MAX_BODY_BYTES).toBe(4 * 1024 * 1024);
    const r = lib.readPackageFile("{}", TRANSLATION_PACKAGE_MAX_BODY_BYTES + 1);
    expect(r.ok ? "ok" : r.problem).toBe("too_large");
    // 220 units with 19 000-character targets: ~4.2 MB once wrapped in { "package": … }.
    const big = pkg({
      pages: [],
      types: ["catalog"],
      units: Array.from({ length: 220 }, (_, i) =>
        unit(
          `listing:${LISTING.slice(0, -3)}${String(i).padStart(3, "0")}:description`,
          `Source ${i}`,
          "x".repeat(19_000),
        ),
      ),
    });
    const json = JSON.stringify(big);
    expect(json.length).toBeGreaterThan(TRANSLATION_PACKAGE_MAX_BODY_BYTES);
    const bigRead = lib.readPackageFile(json, TRANSLATION_PACKAGE_MAX_BODY_BYTES);
    expect(bigRead.ok ? "ok" : bigRead.problem).toBe("too_large");
    // 200 of them (~3.8 MB) fit: a large package below the limit is accepted.
    const fits = { ...big, units: big.units.slice(0, 200) };
    const fitsRead = lib.readPackageFile(JSON.stringify(fits));
    expect(fitsRead.ok).toBe(true);
    if (fitsRead.ok)
      expect(fitsRead.bodyBytes).toBeLessThanOrEqual(TRANSLATION_PACKAGE_MAX_BODY_BYTES);
  });
});

describe("report rows, filters and reasons", () => {
  const rows = lib.reportRows(pkg(), report());

  it("joins every reported unit with its texts", () => {
    expect(rows.map((r) => r.status)).toEqual(ROWS.map((r) => r.status));
    expect(rows[1]).toMatchObject({
      kind: "cms",
      field: "content.sections.@hero.heading",
      source: "Energy in motion",
      current: "Energie",
      target: "Energie in beweging",
      context: "/about-us · Hero",
    });
  });

  it("filters by the owner's groups; 'skipped' = outdated, conflict, invalid, not found", () => {
    const r = report();
    const count = (f: (typeof lib.STATUS_FILTERS)[number]) => lib.filterCount(r, f);
    expect(lib.STATUS_FILTERS.map((f) => [f, count(f)])).toEqual([
      ["all", 8],
      ["create", 1],
      ["update", 1],
      ["unchanged", 1],
      ["outdated", 1],
      ["conflict", 1],
      ["invalid", 1],
      ["not_found", 1],
      ["empty", 1],
      ["skipped", 4],
    ]);
    for (const f of lib.STATUS_FILTERS) {
      expect(lib.filterRows(rows, f, "").length, f).toBe(count(f));
    }
    expect(lib.writableCount(r)).toBe(2);
    expect(lib.skippedCount(r)).toBe(4);
    expect(lib.filterRows(rows, "all", "VISCOSITEIT").map((x) => x.status)).toEqual(["conflict"]);
    expect(lib.filterRows(rows, "all", LISTING).length).toBe(2);
  });

  it("pages long tables (50 rows), never past the last page", () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    expect(lib.pageOf(many, 1).rows).toHaveLength(50);
    expect(lib.pageOf(many, 3)).toMatchObject({ page: 3, pages: 3 });
    expect(lib.pageOf(many, 3).rows).toHaveLength(20);
    expect(lib.pageOf(many, 9).page).toBe(3);
    expect(lib.pageOf([], 1)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });

  it("explains every known rule in both languages; an unknown rule is shown as its code", () => {
    for (const rule of lib.UNIT_RULES) {
      expect(lib.ruleText(rule, EN)).not.toBe(rule);
      expect(lib.ruleText(rule, TR)).not.toBe(lib.ruleText(rule, EN));
    }
    expect(lib.ruleText("some_new_rule", EN)).toBe("some_new_rule");
    expect(lib.ruleText(null, EN)).toBeNull();
  });

  it("builds the export query and the download name of the contract", () => {
    expect(lib.exportQuery(BV_ID, "nl", ["cms", "catalog"])).toBe(
      `?siteId=${BV_ID}&locale=nl&types=cms%2Ccatalog`,
    );
    expect(lib.packageFileName(pkg())).toBe("translation-bv-en-nl-cms-catalog-20261125.json");
  });
});

describe("translation assistants: an extension point without any assistant", () => {
  it("registers none (no AI call, no button that only pretends to work)", () => {
    expect(lib.TRANSLATION_ASSISTS).toEqual([]);
    const html = renderScreen({ loaded: { fileName: "p.json", pkg: pkg() } });
    expect(html).not.toContain(EN("translationPackages.import.assists"));
  });

  it("an assistant's proposals fill targets only; the result is a package for the same dry run", () => {
    const p = pkg();
    const key = p.units[3]!.key;
    const next = lib.withTargets(p, { [key]: "Voor benzinemotoren" });
    expect(next.units[3]!.target).toBe("Voor benzinemotoren");
    expect(next.units.filter((u, i) => u !== p.units[i])).toHaveLength(1);
    expect(next.units[3]!.sourceHash).toBe(p.units[3]!.sourceHash);
    expect(lib.readPackageFile(JSON.stringify(next)).ok).toBe(true);
  });

  it("renders a registered assistant as a real button on the loaded package", () => {
    queue.length = 0;
    queue.push(KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, { fileName: "p.json", pkg: pkg() });
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en">
        <TranslationWorkspace
          sites={SITES}
          assists={[{ id: "test", label: "common.tryAgain", propose: async () => ({}) }]}
        />
      </LocaleProvider>,
    );
    expect(html).toContain(`aria-label="${EN("translationPackages.import.assists")}"`);
    expect(html).toContain(">Try again</button>");
  });
});

// --- 2. client ------------------------------------------------------------------------------------

describe("client calls (contract paths, bodies, refusals)", () => {
  type Seen = { url: string; init: RequestInit };
  const fake = (status: number, body: unknown, seen: Seen[] = []) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  const err = (
    code: Parameters<typeof errorBody>[0],
    details: { path: string; rule: string }[] = [],
  ) => errorBody(code, "req-1", details);

  it("export: GET with the query; dry run and import: POST { package } as JSON", async () => {
    const seen: Seen[] = [];
    const exp = await client.exportPackage(BV_ID, "nl", ["catalog"], fake(200, pkg(), seen));
    expect(exp.ok).toBe(true);
    expect(seen[0]!.url).toBe(
      `${TRANSLATION_PACKAGE_API}/export?siteId=${BV_ID}&locale=nl&types=catalog`,
    );
    expect(seen[0]!.init.method).toBe("GET");
    const dry = await client.dryRunPackage(pkg(), fake(200, report(), seen));
    expect(dry.ok && dry.data.counts.create).toBe(1);
    expect(seen[1]!.url).toBe(`${TRANSLATION_PACKAGE_API}/dry-run`);
    expect(seen[1]!.init.method).toBe("POST");
    expect((seen[1]!.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(seen[1]!.init.body as string)).toEqual({ package: pkg() });
    const imp = await client.importPackage(pkg(), fake(200, report({ dryRun: false }), seen));
    expect(imp.ok && imp.data.dryRun).toBe(false);
    expect(seen[2]!.url).toBe(`${TRANSLATION_PACKAGE_API}/import`);
    for (const s of seen) expect(s.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("an answer that is not a report is an error, not a silent success", async () => {
    const r = await client.dryRunPackage(pkg(), fake(200, { hello: 1 }));
    expect(r.ok).toBe(false);
  });

  it("maps every refusal to a message", async () => {
    ui.locale = "en";
    const msg = async (action: "export" | "dryRun" | "import", status: number, body: unknown) => {
      const f = fake(status, body);
      const r =
        action === "export"
          ? await client.exportPackage(BV_ID, "nl", ["cms"], f)
          : action === "dryRun"
            ? await client.dryRunPackage(pkg(), f)
            : await client.importPackage(pkg(), f);
      return r.ok ? "ok" : r.message;
    };
    const k = (key: PlainKey) => EN(key);
    expect(await msg("import", 403, err("FORBIDDEN"))).toBe(
      k("translationPackages.api.importForbidden"),
    );
    expect(await msg("export", 403, err("FORBIDDEN"))).toBe(k("translationPackages.api.forbidden"));
    expect(await msg("import", 502, err("BAD_GATEWAY"))).toBe(
      k("translationPackages.api.importNoAnswer"),
    );
    expect(await msg("dryRun", 502, err("BAD_GATEWAY"))).toBe(
      k("translationPackages.api.unreachable"),
    );
    expect(await msg("dryRun", 413, err("PAYLOAD_TOO_LARGE"))).toBe(
      k("translationPackages.api.tooLarge"),
    );
    expect(
      await msg(
        "dryRun",
        400,
        err("VALIDATION_FAILED", [{ path: "package.units.4.sourceHash", rule: "mismatch" }]),
      ),
    ).toBe(k("translationPackages.api.hashMismatch"));
    expect(
      await msg(
        "import",
        400,
        err("VALIDATION_FAILED", [{ path: "package.site.key", rule: "mismatch" }]),
      ),
    ).toBe(k("translationPackages.api.siteMismatch"));
    expect(
      await msg("export", 400, err("VALIDATION_FAILED", [{ path: "locale", rule: "is_source" }])),
    ).toBe(k("translationPackages.api.isSource"));
    expect(
      await msg("export", 409, err("CONFLICT_STATE", [{ path: "locale", rule: "not_enabled" }])),
    ).toBe(k("translationPackages.api.notEnabled"));
    expect(
      await msg(
        "dryRun",
        409,
        err("CONFLICT_STATE", [{ path: "package.sourceLocale", rule: "changed" }]),
      ),
    ).toBe(k("translationPackages.api.sourceChanged"));
    expect(await msg("import", 409, err("CONFLICT_STATE"))).toBe(
      k("translationPackages.api.importStale"),
    );
    expect(
      await msg(
        "dryRun",
        400,
        err("VALIDATION_FAILED", [{ path: "package.units", rule: "too_big" }]),
      ),
    ).toBe(EN("translationPackages.api.invalidAt", { paths: "package.units" }));
    expect(await msg("dryRun", 404, err("NOT_FOUND"))).toBe(
      k("translationPackages.api.siteNotFound"),
    );
    expect(await msg("dryRun", 429, err("RATE_LIMITED"))).toBe(EN("errors.RATE_LIMITED"));
  });

  it("DP-285: a lock or a database timeout says nothing was written; an unknown outcome asks for the check", async () => {
    ui.locale = "en";
    const msg = async (action: "dryRun" | "import", status: number, body: unknown) => {
      const r =
        action === "dryRun"
          ? await client.dryRunPackage(pkg(), fake(status, body))
          : await client.importPackage(pkg(), fake(status, body));
      return r.ok ? "ok" : r.message;
    };
    const tx = (rule: string) => [{ path: "transaction", rule }];
    for (const action of ["dryRun", "import"] as const) {
      expect(await msg(action, 409, err("CONFLICT_STATE", tx("locked")))).toBe(
        EN("translationPackages.api.locked"),
      );
      for (const rule of ["timeout", "busy"]) {
        expect(await msg(action, 503, err("DATABASE_UNAVAILABLE", tx(rule)))).toBe(
          EN("translationPackages.api.databaseBusy"),
        );
      }
    }
    // A lost connection may have committed: like a missing answer, the check comes first.
    expect(await msg("import", 503, err("DATABASE_UNAVAILABLE", tx("connection")))).toBe(
      EN("translationPackages.api.importNoAnswer"),
    );
    expect(await msg("dryRun", 503, err("DATABASE_UNAVAILABLE", tx("connection")))).toBe(
      EN("translationPackages.api.unreachable"),
    );
    expect(await msg("import", 504, null)).toBe(EN("translationPackages.api.importNoAnswer"));
    // Other 409s keep their meaning; a 500 of the import is an unknown outcome, of the check not.
    expect(
      await msg("import", 409, err("CONFLICT_STATE", [{ path: "version", rule: "stale" }])),
    ).toBe(EN("translationPackages.api.importStale"));
    expect(await msg("import", 500, err("INTERNAL_ERROR"))).toBe(
      EN("translationPackages.api.importUnknown"),
    );
    expect(await msg("dryRun", 500, err("INTERNAL_ERROR"))).toBe(
      EN("translationPackages.api.failed"),
    );
    expect(TR("translationPackages.api.locked")).toMatch(/Hiçbir şey yazılmadı/);
    expect(TR("translationPackages.api.databaseBusy")).toMatch(/Hiçbir şey yazılmadı/);
    expect(TR("translationPackages.api.importUnknown")).toMatch(/kontrolü tekrar çalıştırın/);
  });

  it("an unreachable service during an import says it may have finished (repeat is safe)", async () => {
    const down = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const r = await client.importPackage(pkg(), down);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(0);
      expect(r.message).toBe(EN("translationPackages.api.importNoAnswer"));
    }
    expect(client.CLIENT_TIMEOUT_MS.import).toBeGreaterThan(90_000);
  });

  it("messages are Turkish in a Turkish console", () => {
    expect(client.packageErrorMessage("import", 403, "FORBIDDEN", [], TR)).toBe(
      TR("translationPackages.api.importForbidden"),
    );
    expect(TR("translationPackages.api.importForbidden")).toMatch(/Hiçbir şey yazılmadı/);
  });
});

// --- 3. rendering ---------------------------------------------------------------------------------

describe("the page", () => {
  it("offers the readable sites with their enabled target languages; NL marked not public", async () => {
    const html = await renderPage();
    expect(html).toContain("<h1");
    expect(text(html)).toContain("Translations");
    expect(text(html)).toContain(EN("translationPackages.rulesNote"));
    expect(html).toContain(`<option value="${BV_ID}" selected="">Dream Petroleum BV</option>`);
    expect(html).toContain('<option value="nl" selected="">nl (not public)</option>');
    expect(html).not.toContain('<option value="de">'); // not enabled
    expect(html).toMatch(/<select[^>]*id="[^"]*-source"[^>]*disabled=""/);
    expect(text(html)).toContain(EN("translationPackages.export.notPublicHint", { locale: "nl" }));
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/accept="\.json,application\/json"/);
  });

  it("a site readable in the catalogue only gets its languages from the category texts route", async () => {
    reads.set(CMS, { sites: [] });
    reads.set(CATALOG, {
      sites: [catalogSite(CORP_ID, "CORPORATE", "Dream Petroleum Corporate")],
      canEditMaster: false,
      canApprove: false,
    });
    const path = `/api/v1/admin/catalog/sites/${CORP_ID}/categories/translations?locale=en`;
    reads.set(path, {
      siteId: CORP_ID,
      locale: "en",
      defaultLocale: "en",
      locales: BV_LOCALES,
      enabled: true,
      canEdit: true,
      items: [],
    });
    const html = await renderPage();
    expect(readPaths).toContain(path);
    expect(html).toContain("Dream Petroleum Corporate");
    // CMS cannot be read on that site: its box is disabled.
    expect(text(html)).toContain(EN("translationPackages.types.noRead"));
    expect(html).toMatch(/<input type="checkbox" class="mt-0.5" disabled=""/);
  });

  it("no readable site: an empty state; both context routes failing: an error state", async () => {
    reads.set(CMS, { sites: [] });
    reads.set(CATALOG, { sites: [], canEditMaster: false, canApprove: false });
    expect(text(await renderPage())).toContain(EN("translationPackages.noAccessTitle"));
    reads.set(CMS, FAIL);
    reads.set(CATALOG, FAIL);
    const html = await renderPage();
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(EN("translationPackages.loadError"));
  });

  it("is Turkish in a Turkish console", async () => {
    const html = await renderPage("tr");
    const t = text(html);
    for (const s of [
      "Çeviri yönetimi",
      "Paket dışa aktar",
      "Kaynak dil",
      "Hedef dil",
      "Paketi dışa aktar",
      "Çevrilmiş paketi içe aktar",
      "nl (herkese açık değil)",
    ]) {
      expect(t).toContain(s);
    }
    for (const s of ["Export package", "Target language", "Import a translated package"]) {
      expect(t).not.toContain(s);
    }
    expect((await pageModule.generateMetadata()).title).toBe("Çeviri yönetimi");
  });
});

describe("the screen's states", () => {
  const loaded = { fileName: "translation-bv-en-nl.json", pkg: pkg() };

  it("a loaded package: its site, languages, counts and the check button (read only)", () => {
    const html = renderScreen({ loaded });
    const t = text(html);
    expect(t).toContain("translation-bv-en-nl.json");
    expect(t).toContain("Dream Petroleum BV · en → nl");
    expect(t).toContain("8 texts");
    expect(t).toContain("7 translated");
    expect(t).toContain(EN("translationPackages.import.check"));
    expect(t).toContain(EN("translationPackages.import.checkHint"));
    expect(t).not.toContain(EN("translationPackages.report.checkTitle"));
  });

  it("the check result: counts, filters (aria-pressed), every unit with its reason and language", () => {
    const html = renderScreen({ loaded, report: report() });
    const t = text(html);
    expect(t).toContain(
      EN("translationPackages.report.checkSummary", { writable: 2, skipped: 4, total: 8 }),
    );
    expect(html).toMatch(/aria-pressed="true" class="[^"]*">All \(8\)<\/button>/);
    for (const chip of [
      "New (1)",
      "To update (1)",
      "Unchanged (1)",
      "Outdated (1)",
      "Conflicting (1)",
      "Invalid (1)",
      "Skipped (4)",
    ]) {
      expect(html).toContain(`aria-pressed="false" class="${CHIP_OFF}">${chip}</button>`);
    }
    expect((html.match(/<tr class="align-top">/g) ?? []).length).toBe(8);
    for (const rule of ["source_changed", "target_changed", "too_long"] as const) {
      expect(t).toContain(EN(`translationPackages.rules.${rule}`));
    }
    expect(html).toContain('<span lang="en" class="line-clamp-4');
    expect(html).toContain('lang="nl" class="line-clamp-4');
    expect(t).toContain("Current: Energie");
    expect(html).toMatch(
      /<button type="button" class="[^"]*"><svg[^>]*><path[^>]*><\/path><\/svg><span>Import 2 translations as drafts…/,
    );
    expect(t).toContain(EN("translationPackages.report.draftOnly"));
    expect(t).toContain(EN("translationPackages.pages.summary", { count: 1 }));
  });

  it("the check filtered to skipped units shows only those", () => {
    const html = renderScreen({ loaded, report: report(), filter: "skipped" });
    expect((html.match(/<tr class="align-top">/g) ?? []).length).toBe(4);
    expect(html).toMatch(/aria-pressed="true" class="[^"]*">Skipped \(4\)<\/button>/);
  });

  it("missing permissions: the reason is shown and the import button is disabled", () => {
    const r = report({ canImport: false, missingPermissions: ["product_master:edit"] });
    const html = renderScreen({ loaded, report: r });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(
      EN("translationPackages.report.missingPermissions", { permissions: "product_master:edit" }),
    );
    expect(html).toMatch(
      /<button type="button" class="[^"]*" disabled=""><svg[^>]*><path[^>]*><\/path><\/svg><span>Import 2 translations as drafts…/,
    );
  });

  it("nothing valid to import: the import button is disabled", () => {
    const none = report({
      counts: { ...report().counts, create: 0, update: 0 },
    });
    const html = renderScreen({ loaded, report: none });
    expect(html).toMatch(
      /<button type="button" class="[^"]*" disabled=""><svg[^>]*><path[^>]*><\/path><\/svg><span>Import 0 translations as drafts…/,
    );
    expect(text(html)).toContain(EN("translationPackages.report.nothingToImport"));
  });

  it("the confirmation: an alert dialog, drafts only, nothing published, confirm needs the box", () => {
    const html = renderScreen({ loaded, report: report(), confirming: true });
    expect(html).toContain('role="alertdialog"');
    const t = text(html);
    expect(t).toContain(EN("translationPackages.confirm.title"));
    expect(t).toContain(EN("translationPackages.confirm.noPublish", { locale: "nl" }));
    expect(t).toContain(EN("translationPackages.confirm.ack", { count: 2 }));
    // The box is not ticked: the confirm button is disabled; Cancel takes the focus.
    expect(html).toMatch(
      /<button type="button" disabled="" aria-busy="false" class="[^"]*"><svg[^>]*><path[^>]*><\/path><\/svg><span>Import 2 translations<\/span>/,
    );
    expect(html).toMatch(/data-autofocus=""[^>]*>Cancel<\/button>/);
    const ticked = renderScreen({ loaded, report: report(), confirming: true, ack: true });
    expect(ticked).toMatch(
      /<button type="button" aria-busy="false" class="[^"]*"><svg[^>]*><path[^>]*><\/path><\/svg><span>Import 2 translations<\/span>/,
    );
  });

  it("while importing: busy, both buttons disabled; a refusal stays in the dialog", () => {
    const html = renderScreen({
      loaded,
      report: report(),
      confirming: true,
      importing: true,
      ack: true,
      importError: EN("translationPackages.api.importStale"),
    });
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).toContain(EN("translationPackages.confirm.running"));
    expect(html).toMatch(
      /role="alert" class="mt-3 text-sm text-danger">Texts changed while importing/,
    );
  });

  it("the import result: written rows, skipped units first with their reasons, nothing published", () => {
    const done = report({
      dryRun: false,
      written: {
        cmsPagesCreated: 1,
        cmsPagesUpdated: 0,
        listings: 0,
        categories: 0,
        specs: 0,
        images: 0,
      },
    });
    const html = renderScreen({ done: { report: done, pkg: pkg() } });
    const t = text(html);
    expect(t).toContain(EN("translationPackages.report.doneTitle"));
    expect(t).toContain(EN("translationPackages.report.doneSummary", { written: 1, skipped: 4 }));
    expect(html).toMatch(/aria-pressed="true" class="[^"]*">Skipped \(4\)<\/button>/);
    expect((html.match(/<tr class="align-top">/g) ?? []).length).toBe(4);
    expect(t).toContain(EN("translationPackages.report.doneNote"));
    expect(t).toContain(EN("translationPackages.report.another"));
    expect(t).not.toContain("Import 2 translations");
  });

  it("every state is Turkish in a Turkish console (no English UI text left)", () => {
    const states: Screen[] = [
      { loaded },
      { loaded, report: report() },
      { loaded, report: report({ canImport: false, missingPermissions: ["content:edit"] }) },
      { loaded, report: report(), confirming: true },
      { done: { report: report({ dryRun: false }), pkg: pkg() } },
    ];
    const data = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === "string") data.add(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk([pkg(), report(), SITES]);
    const allowed =
      /^(CMS|JSON|Site|Dream Petroleum BV|translation-bv-en-nl\.json|content:edit|nl|en|—|[\d\s·→()/.,:]+)$/;
    for (const s of states) {
      const html = renderScreen(s, "tr");
      const english = text(html)
        .split(/\s{2,}|(?<=[.!?…])\s/)
        .map((x) => x.trim())
        .filter((x) => /[A-Za-z]{3,}/.test(x));
      const left = english.filter(
        (x) =>
          !allowed.test(x) &&
          ![...data].some((d) => d.includes(x) || x.includes(d)) &&
          /\b(the|and|import|export|check|translation|draft|texts?|package|skipped|nothing)\b/i.test(
            x,
          ),
      );
      expect(left, JSON.stringify(s).slice(0, 60)).toEqual([]);
    }
  });
});

// --- 4. drift guards ------------------------------------------------------------------------------

describe("drift guards", () => {
  it("every unit or page rule the ML-13a API names has a message", () => {
    const dir = path.resolve(ROOT, "..", "api", "src", "translation-packages");
    const source = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    const found = new Set<string>();
    for (const re of [
      /rule: "([a-z_]+)"/g,
      /skipAll\("([a-z_]+)"/g,
      /refuse\(\s*problem === "([a-z_]+)"/g,
      /: "([a-z_]+)", "conflict"\)/g,
      /return "([a-z_]+)";/g,
      /problem = "([a-z_]+)"/g,
    ]) {
      for (const m of source.matchAll(re)) found.add(m[1] as string);
    }
    // Rules of whole-request refusals (400/409 details, not unit rules): messages in api.*.
    for (const r of ["is_source", "not_enabled", "mismatch", "changed"]) found.delete(r);
    expect(found.size).toBeGreaterThan(10);
    const missing = [...found].filter((r) => !lib.isUnitRule(r));
    expect(missing).toEqual([]);
  });

  it("writes no English UI text in code (dictionary only)", () => {
    const files = listFiles(ROOT, [
      "app/(console)/translations",
      "components/translations",
      "lib/translation-packages.ts",
      "lib/translation-packages-client.ts",
    ]);
    expect(files.length).toBe(4);
    expect(scanFiles(ROOT, files).map((l) => `${l.file}:${l.line}  ${l.text}`)).toEqual([]);
  });

  it("the navigation offers Translations to every staff member, not to review-only users", async () => {
    const { navGroupsFor } = await import("../lib/navigation");
    const hrefs = (owner: boolean, review = false) =>
      navGroupsFor(owner, review).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(false)).toContain("/translations");
    expect(hrefs(true)).toContain("/translations");
    expect(hrefs(false, true)).not.toContain("/translations");
    expect(EN("nav.items.translations.label")).toBe("Translations");
    expect(TR("nav.items.translations.label")).toBe("Çeviri yönetimi");
  });

  it("the fixture's hashes are real SHA-256 (as the API checks them)", () => {
    expect(sha("About us")).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg().units.every((u) => u.sourceHash === sha(u.source))).toBe(true);
    expect(GROUP).toMatch(/^[0-9a-f-]{36}$/);
  });
});
