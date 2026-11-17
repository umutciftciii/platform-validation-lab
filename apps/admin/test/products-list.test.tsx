// DP-200: the product list says each product's status once. The selected site's status always
// shows, named after the site; the master's only when it adds something — a never-published
// Draft master no longer reads "Draft" twice. Same markup on wide screens (table) and phones
// (stacked list); filters, sorting and links unchanged. The page renders on the server with real
// response shapes; the admin API and the session are fixtures.
import type { ProductListItem, ProductStatus } from "@dream/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRowStatus, type SiteDisplayStatus } from "../lib/publication-status";

const reads = new Map<string, unknown>();

vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    return { ok: true, data: schema.parse(reads.get(path)) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));

const { default: ProductsPage } = await import("../app/(console)/products/page");

const C = "/api/v1/admin/catalog";
const BV = "22222222-2222-4222-8222-222222222222";
const CORP = "33333333-3333-4333-8333-333333333333";
const CAT = "44444444-4444-4444-8444-444444444444";
const T = "2026-11-17T10:00:00.000Z";
const LIST_QUERY = "sort=name&order=asc&page=1&pageSize=25";

const live = { status: "PUBLISHED" as const, productVersion: 3 };
const off = { status: "UNPUBLISHED" as const, productVersion: 3 };

describe("listRowStatus", () => {
  const row = (
    publication: { status: "PUBLISHED" | "UNPUBLISHED" } | null,
    listing: "HIDDEN" | "VISIBLE" | null,
    productStatus: ProductStatus,
  ) => listRowStatus({ publication, listing, productStatus });

  it("drops the master status only when it repeats the site's Draft or Not listed", () => {
    // DP-203: no listing and no publication on the site = Not listed, not Draft.
    expect(row(null, null, "DRAFT")).toEqual({ site: "NOT_LISTED", master: null });
    expect(row(null, "HIDDEN", "DRAFT")).toEqual({ site: "DRAFT", master: null });
  });

  it("keeps the master status whenever it says something else", () => {
    expect(row(null, "HIDDEN", "IN_REVIEW")).toEqual({ site: "DRAFT", master: "IN_REVIEW" });
    expect(row(null, "HIDDEN", "APPROVED")).toEqual({ site: "DRAFT", master: "APPROVED" });
    expect(row(null, null, "ARCHIVED")).toEqual({ site: "NOT_LISTED", master: "ARCHIVED" });
    expect(row(null, null, "APPROVED")).toEqual({ site: "NOT_LISTED", master: "APPROVED" });
    // Draft master next to a published or unpublished site is a real difference.
    expect(row(live, "VISIBLE", "DRAFT")).toEqual({ site: "PUBLISHED", master: "DRAFT" });
    expect(row(off, "VISIBLE", "DRAFT")).toEqual({ site: "UNPUBLISHED", master: "DRAFT" });
    expect(row(live, "VISIBLE", "APPROVED")).toEqual({ site: "PUBLISHED", master: "APPROVED" });
    expect(row(live, "VISIBLE", "ARCHIVED")).toEqual({ site: "UNPUBLISHED", master: "ARCHIVED" });
  });

  it("keeps Published and Unpublished apart", () => {
    const site = (p: typeof live | typeof off | null, l: "HIDDEN" | "VISIBLE"): SiteDisplayStatus =>
      row(p, l, "APPROVED").site;
    expect(site(live, "VISIBLE")).toBe("PUBLISHED");
    expect(site(live, "HIDDEN")).toBe("UNPUBLISHED");
    expect(site(off, "VISIBLE")).toBe("UNPUBLISHED");
    expect(site(null, "VISIBLE")).toBe("DRAFT");
  });
});

let n = 0;
function item(
  name: string,
  status: ProductStatus,
  publication: ProductListItem["publication"],
  listing: "HIDDEN" | "VISIBLE" | null,
): ProductListItem {
  n += 1;
  const id = `0190a8c4-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    code: `P-${n}`,
    slug: `p-${n}`,
    name,
    status,
    version: 3,
    updatedAt: T,
    listing: listing
      ? { id, visibility: listing, categoryId: CAT, categoryName: "Engine oils", updatedAt: T }
      : null,
    publication,
  };
}

function fixtures() {
  n = 0;
  reads.clear();
  reads.set(`${C}/context`, {
    sites: [
      { id: BV, key: "BV", name: "Dream Petroleum BV", canEdit: true, canPublish: true },
      { id: CORP, key: "CORPORATE", name: "Corporate", canEdit: false, canPublish: false },
    ],
    canEditMaster: true,
    canApprove: false,
  });
  const page = (items: ProductListItem[]) => ({
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
  });
  // One product, two sites: published on BV, never published on Corporate.
  reads.set(
    `${C}/products?siteId=${BV}&${LIST_QUERY}`,
    page([
      item("Fresh draft", "DRAFT", null, "HIDDEN"),
      item("In review", "IN_REVIEW", null, "HIDDEN"),
      item("Live draft master", "DRAFT", live, "VISIBLE"),
      item("Live approved", "APPROVED", live, "VISIBLE"),
      item("Taken off", "APPROVED", off, "VISIBLE"),
      item("Archived", "ARCHIVED", live, "VISIBLE"),
      item("Unlisted draft", "DRAFT", null, null),
    ]),
  );
  n = 3;
  reads.set(
    `${C}/products?siteId=${CORP}&${LIST_QUERY}`,
    page([item("Live approved", "APPROVED", null, null)]),
  );
  reads.set(`${C}/sites/${BV}/categories`, { items: [] });
  reads.set(`${C}/sites/${CORP}/categories`, { items: [] });
}

async function render(params: Record<string, string> = {}) {
  const page = await ProductsPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(params),
  } as never);
  return renderToStaticMarkup(page);
}

/** The status cells of each product, from the table (wide) and the stacked list (phones). */
const STATUS =
  /data-status="(\w+)"><span[^>]*>([^<]*)<\/span><span[^>]*>(?:<span[^>]*><\/span>)?([^<]*)<\/span>/g;

function section(html: string, from: string, to: string): string {
  const a = html.indexOf(from);
  expect(a, from).toBeGreaterThanOrEqual(0);
  return html.slice(a, html.indexOf(to, a));
}

function readRows(part: string, sep: string) {
  return part
    .split(sep)
    .slice(1)
    .map((row) => ({
      name: /font-medium[^>]*>([^<]*)</.exec(row)?.[1] ?? "",
      status: [...row.matchAll(STATUS)].map((m) => `${m[1]}:${m[2]}${m[3]}`),
      href: /href="(\/products\/[^"]+)"/.exec(row)?.[1] ?? "",
    }));
}

function rows(html: string) {
  const table = readRows(section(html, "<tbody>", "</tbody>"), "<tr");
  const phone = readRows(section(html, '<ul class="divide-y', "</ul>"), "<li");
  const strip = (r: { name: string; status: string[] }) => ({ name: r.name, status: r.status });
  return { table: table.map(strip), phone: phone.map(strip), tableRaw: table, phoneRaw: phone };
}

describe("products list (DP-200)", () => {
  beforeEach(fixtures);

  it("shows each status once, the master only when it adds something", async () => {
    const { table, phone } = rows(await render());
    const expected = [
      { name: "Fresh draft", status: ["site:BVDraft"] },
      { name: "In review", status: ["site:BVDraft", "master:MasterIn review"] },
      { name: "Live draft master", status: ["site:BVPublished", "master:MasterDraft"] },
      { name: "Live approved", status: ["site:BVPublished", "master:MasterApproved"] },
      { name: "Taken off", status: ["site:BVUnpublished", "master:MasterApproved"] },
      { name: "Archived", status: ["site:BVUnpublished", "master:MasterArchived"] },
      // DP-203: not listed on the site reads "Not listed", never "Draft".
      { name: "Unlisted draft", status: ["site:BVNot listed"] },
    ];
    expect(table).toEqual(expected);
    // Phones show exactly what the table shows.
    expect(phone).toEqual(expected);
  });

  it("never shows two Draft labels for one product", async () => {
    const { table, phone } = rows(await render());
    for (const r of [...table, ...phone]) {
      const drafts = r.status.filter((s) => s.endsWith("Draft"));
      expect(drafts.length, r.name).toBeLessThanOrEqual(1);
      expect(r.status.join(" "), r.name).not.toMatch(/HIDDEN|VISIBLE|Hidden|Visible/);
    }
  });

  it("names the selected site, so a product reads per site", async () => {
    const { table } = rows(await render({ site: "corporate" }));
    expect(table).toEqual([
      { name: "Live approved", status: ["site:CorporateNot listed", "master:MasterApproved"] },
    ]);
  });

  it("keeps the table header, filters, sorting and links", async () => {
    const html = await render();
    const heads = [...section(html, "<thead>", "</thead>").matchAll(/<th[^>]*>([^<]*)<\/th>/g)];
    expect(heads.map((m) => m[1])).toEqual([
      "Product",
      "Category on this site",
      "Status",
      "Last changed",
    ]);
    const form = section(html, "<form", "</form>");
    const names = (tag: string) =>
      [...form.matchAll(new RegExp(`<${tag}[^>]*name="(\\w+)"`, "g"))].map((m) => m[1]);
    expect(names("select")).toEqual(["category", "listing", "sort", "order", "status"]);
    expect(names("input")).toEqual(["site", "q"]);
    const { tableRaw, phoneRaw } = rows(html);
    expect(tableRaw[0]?.href).toBe("/products/0190a8c4-7c1e-7000-8000-000000000001?site=bv");
    expect(phoneRaw.map((r) => r.href)).toEqual(tableRaw.map((r) => r.href));
  });
});
