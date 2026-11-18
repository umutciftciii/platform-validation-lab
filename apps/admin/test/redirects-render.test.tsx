// DP-211: Admin > SEO > Redirects renders on the server with real response shapes (manual,
// imported and protected slug-change rows, read-only and managing callers), and its view helpers
// (list parameters, messages, the dry-run report) behave. The admin API and the session are
// replaced by fixtures, as in cms-pages-render.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoRedirectImportResponse } from "@dream/contracts";

const reads = new Map<string, unknown>();
vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    return { ok: true, data: schema.parse(reads.get(path)) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const { default: RedirectsPage } = await import("../app/(console)/seo/redirects/page");
const view = await import("../lib/redirects-view");
const { redirectErrorMessage } = await import("../lib/redirects-client");

const BV = "0190f2a1-0000-7000-8000-0000000000b1";
const AT = "2026-11-18T12:00:00.000Z";
const id = (n: number) => `0190f2a1-0000-7000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Record<string, unknown>) => ({
  id: id(n),
  sourcePath: `/old-${n}`,
  sourceQuery: "",
  target: "/about-us",
  statusCode: 301,
  active: true,
  origin: "MANUAL",
  note: null,
  version: 1,
  protected: false,
  content: null,
  createdBy: "Editor (fixture)",
  updatedBy: "Editor (fixture)",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

function list(
  manage: boolean,
  items = [
    row(1, { note: "Old company page" }),
    row(2, {
      sourcePath: "/offer",
      sourceQuery: "ref=mail",
      target: "/contact",
      statusCode: 302,
      active: false,
      origin: "IMPORT",
    }),
    row(3, {
      sourcePath: "/products/old-oil",
      target: "/products/new-oil",
      origin: "SLUG_CHANGE",
      protected: true,
      content: { type: "PRODUCT", id: id(9), name: "New oil", livePath: "/products/new-oil" },
    }),
  ],
) {
  return {
    site: { id: BV, key: "BV", name: "Dream Petroleum BV" },
    permissions: { manage, history: manage },
    items,
    total: items.length,
    page: 1,
    pageSize: 50,
    counts: { all: 3, MANUAL: 1, SLUG_CHANGE: 1, IMPORT: 1, inactive: 1 },
  };
}

beforeEach(() => {
  reads.clear();
  reads.set("/api/v1/admin/cms/context", {
    sites: [
      {
        id: BV,
        key: "BV",
        name: "Dream Petroleum BV",
        locale: "en",
        canEdit: true,
        canPublish: true,
      },
    ],
  });
});

async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await RedirectsPage({ searchParams: Promise.resolve(sp) } as never));
}

describe("DP-211 redirects page", () => {
  it("lists manual, imported and protected slug-change redirects for a manager", async () => {
    reads.set(`/api/v1/admin/seo/sites/${BV}/redirects`, list(true));
    const html = await render();
    expect(html).toContain("Redirects");
    expect(html).toContain("/old-1");
    expect(html).toContain("/offer?ref=mail");
    expect(html).toContain("302 temporary");
    expect(html).toContain("Inactive");
    expect(html).toContain("Slug change");
    expect(html).toContain("Protected");
    expect(html).toContain('href="/products/' + id(9) + '?site=bv&amp;tab=seo"');
    expect(html).toContain("live at /products/new-oil");
    expect(html).toContain("New redirect");
    expect(html).toContain("Import CSV");
    // The protected row offers its note only, never Delete.
    const protectedRow = html.slice(html.indexOf(`data-redirect-row="${id(3)}"`));
    expect(protectedRow.slice(0, protectedRow.indexOf("</li>"))).toContain("Edit note");
    expect(protectedRow.slice(0, protectedRow.indexOf("</li>"))).not.toContain(">Delete<");
    expect((html.match(/>Delete</g) ?? []).length).toBe(2);
  });

  it("is read-only without content:publish", async () => {
    reads.set(`/api/v1/admin/seo/sites/${BV}/redirects`, list(false));
    const html = await render();
    expect(html).not.toContain("New redirect");
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain(">Edit<");
    expect(html).toContain("needs the right to publish content");
  });

  it("passes search, filters, sort and page to the API", async () => {
    const qs = "?q=old&origin=IMPORT&status=302&active=false&sort=source&dir=asc&page=2";
    reads.set(`/api/v1/admin/seo/sites/${BV}/redirects${qs}`, {
      ...list(true),
      page: 2,
      total: 60,
    });
    const html = await render({
      q: "old",
      origin: "IMPORT",
      status: "302",
      active: "false",
      sort: "source",
      dir: "asc",
      page: "2",
    });
    expect(html).toContain("page 2 of 2");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Previous");
  });

  it("explains a refusal", async () => {
    const html = await render();
    expect(html).toContain("The redirects could not be loaded");
  });
});

describe("DP-211 view helpers", () => {
  it("parses list parameters defensively", () => {
    expect(
      view.parseRedirectParams({ origin: "X", status: "307", sort: "evil", page: "-1", q: "  a " }),
    ).toEqual({
      q: "a",
      origin: "",
      status: "",
      active: "",
      sort: "updated",
      dir: "desc",
      page: 1,
    });
    const p = view.parseRedirectParams({ origin: "SLUG_CHANGE", page: "3" });
    expect(view.redirectQuery(p)).toBe("?origin=SLUG_CHANGE&page=3");
    expect(view.redirectQuery(p, { origin: "", page: 1 })).toBe("");
  });

  it("names every API rule in plain words", () => {
    for (const code of [
      "source:live_content",
      "source:duplicate",
      "source:chain",
      "target:chain",
      "target:external",
      "target:self",
      "redirect:protected",
      "csv.3:quote",
      "import:changed",
    ]) {
      expect(view.knownRule(code), code).toBe(true);
      expect(view.ruleMessage(code)).not.toMatch(/^Check /);
    }
    expect(view.ruleMessage("weird:thing")).toContain("Check weird");
    expect(
      redirectErrorMessage("CONFLICT_STATE", [
        { path: "source", rule: "duplicate" },
        { path: "target", rule: "chain" },
      ]),
    ).toContain("already exists");
  });

  it("builds a dry-run report that is safe to open in a spreadsheet", () => {
    const result: SeoRedirectImportResponse = {
      dryRun: true,
      applied: false,
      planHash: "0".repeat(64),
      summary: { rows: 2, create: 1, update: 0, unchanged: 0, error: 1 },
      rows: [
        {
          line: 2,
          source: "/a",
          target: "/b",
          statusCode: 301,
          active: true,
          note: "=cmd()",
          action: "create",
          errors: [],
          warnings: ["target:not_live"],
        },
        {
          line: 3,
          source: "/products",
          target: "/x",
          statusCode: 301,
          active: true,
          note: null,
          action: "error",
          errors: ["source:reserved"],
          warnings: [],
        },
      ],
    };
    const csv = view.importReportCsv(result);
    expect(csv.split("\r\n")[0]).toBe(
      "line,result,source,target,status,active,note,errors,warnings",
    );
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain("Error");
    expect(csv).toContain("belongs to the site itself");
  });

  it("summarises history events", () => {
    expect(view.historyActionLabel("seo.redirect_created", { via: "import" })).toBe(
      "Created (import)",
    );
    expect(
      view.historySummary({
        sourcePath: "/a",
        sourceQuery: "x=1",
        target: "/b",
        statusCode: 302,
        active: false,
        changed: ["target"],
      }),
    ).toBe("/a?x=1 · → /b · 302 · inactive · changed: target");
  });
});
