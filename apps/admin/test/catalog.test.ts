// PM-1: the catalogue screens' view helpers, error messages and server-side API reads.
import { randomBytes, randomUUID } from "node:crypto";
import { CatalogContextResponseSchema, type Category } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { readApi } from "../lib/admin-api";
import type { ProxyConfig } from "../lib/api-proxy";
import { messageForIssues } from "../lib/catalog-client";
import {
  apiListQuery,
  categoryPath,
  flattenTree,
  listHref,
  pageCount,
  readFilters,
} from "../lib/catalog-view";
import { slugify } from "../components/catalog/product-master-form";

const SITE = "0190f2a1-0000-7000-8000-00000000000b";
const cat = (id: string, name: string, parentId: string | null, sortOrder = 0): Category => ({
  id,
  siteId: SITE,
  parentId,
  name,
  slug: name.toLowerCase(),
  description: null,
  sortOrder,
  isDefault: false,
  version: 1,
  listingCount: 0,
  childCount: 0,
  updatedAt: "2026-11-11T10:00:00.000Z",
});

describe("category tree view", () => {
  const items = [
    cat("w", "Waxes", null, 10),
    cat("p", "PAO", "s"),
    cat("b", "Base Oils", null, 0),
    cat("s", "Synthetic", "b"),
    cat("g", "Group III", "b", -1),
  ];

  it("orders parents before children, siblings by sort order then name", () => {
    expect(flattenTree(items).map((r) => [r.category.name, r.depth])).toEqual([
      ["Base Oils", 0],
      ["Group III", 1],
      ["Synthetic", 1],
      ["PAO", 2],
      ["Waxes", 0],
    ]);
    expect(categoryPath(items, "p")).toBe("Base Oils / Synthetic / PAO");
  });

  it("keeps orphans visible and survives cycles", () => {
    const odd = [cat("x", "Orphan", "missing"), cat("a", "A", "b2"), cat("b2", "B", "a")];
    expect(flattenTree(odd).map((r) => r.category.name)).toEqual(["Orphan"]);
    expect(categoryPath(odd, "a")).toBe("B / A");
  });
});

describe("list filters", () => {
  it("reads known values and falls back on anything else", () => {
    expect(readFilters({ q: "  pao ", status: "ARCHIVED", listing: "listed", page: "3" })).toEqual({
      q: "pao",
      status: "ARCHIVED",
      listing: "listed",
      visibility: "",
      category: "",
      sort: "name",
      order: "asc",
      page: 3,
    });
    const junk = readFilters({ status: "DELETED", sort: "password", page: "-4", category: "x" });
    expect(junk).toMatchObject({ status: "", sort: "name", page: 1, category: "" });
  });

  it("builds the API query and the page links", () => {
    const f = readFilters({ q: "oil", visibility: "VISIBLE", sort: "code", order: "desc" });
    expect(apiListQuery(SITE, f)).toBe(
      `siteId=${SITE}&q=oil&visibility=VISIBLE&sort=code&order=desc&page=1&pageSize=25`,
    );
    expect(listHref("bv", { ...f, page: 2 })).toBe(
      "/products?site=bv&q=oil&visibility=VISIBLE&sort=code&order=desc&page=2",
    );
    expect(listHref("corporate", {})).toBe("/products?site=corporate");
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
  });

  it("derives slugs from names", () => {
    expect(slugify("ICCSYN 6 Synthetic")).toBe("iccsyn-6-synthetic");
    expect(slugify("  Ürün — Çok İyi! ")).toBe("urun-cok-iyi");
  });
});

describe("catalogue error messages", () => {
  it("explains known conflicts and lists invalid fields otherwise", () => {
    expect(messageForIssues("CONFLICT_STATE", [{ path: "version", rule: "stale" }])).toMatch(
      /Someone else changed/,
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "code", rule: "unique" }])).toMatch(
      /already uses this code/,
    );
    expect(
      messageForIssues("VALIDATION_FAILED", [
        { path: "name", rule: "too_small" },
        { path: "slug", rule: "invalid_format" },
      ]),
    ).toBe("Check these fields: name, slug.");
    expect(messageForIssues("FORBIDDEN", [])).toBe("You are not allowed to do this.");
    expect(messageForIssues(null, [])).toMatch(/could not be saved/);
  });
});

describe("server-side API reads", () => {
  const KEY = randomBytes(32).toString("base64url");
  const CONFIG: ProxyConfig = { apiUrl: "http://api.internal:3000", proxyKey: KEY, trustedHops: 0 };
  const TOKEN = randomBytes(32).toString("base64url");
  const CONTEXT = {
    sites: [
      { id: randomUUID(), key: "BV", name: "Dream Petroleum BV", canEdit: true, canPublish: false },
    ],
    canEditMaster: false,
    canApprove: false,
  };
  function upstream(status: number, body: unknown) {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl = (async (url: string, init: RequestInit & { headers: Headers }) => {
      seen.push({ url, headers: init.headers });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { seen, deps: { fetch: fetchImpl, log: () => {} } };
  }
  const PATH = "/api/v1/admin/catalog/context";

  it("forwards only the session cookie and parses the contract", async () => {
    const { seen, deps } = upstream(200, CONTEXT);
    const r = await readApi(
      PATH,
      CatalogContextResponseSchema,
      { sessionToken: TOKEN },
      CONFIG,
      deps,
    );
    expect(r).toEqual({ ok: true, data: CONTEXT });
    expect(seen[0]!.url).toBe(`${CONFIG.apiUrl}${PATH}`);
    expect(seen[0]!.headers.get("cookie")).toBe(`__Host-dp_admin_session=${TOKEN}`);
    expect(seen[0]!.headers.get("x-dp-proxy-key")).toBe(KEY);
  });

  it("returns 401 without a cookie (no call), and 403/404 as values", async () => {
    const none = upstream(200, CONTEXT);
    expect(
      await readApi(PATH, CatalogContextResponseSchema, { sessionToken: "" }, CONFIG, none.deps),
    ).toEqual({
      ok: false,
      status: 401,
      code: null,
    });
    expect(none.seen).toHaveLength(0);
    for (const [status, code] of [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ] as const) {
      const { deps } = upstream(status, { error: { code } });
      expect(
        await readApi(PATH, CatalogContextResponseSchema, { sessionToken: TOKEN }, CONFIG, deps),
      ).toEqual({
        ok: false,
        status,
        code,
      });
    }
  });

  it("fails closed on other statuses and on contract mismatches", async () => {
    const err = upstream(500, { error: { code: "INTERNAL_ERROR" } });
    await expect(
      readApi(PATH, CatalogContextResponseSchema, { sessionToken: TOKEN }, CONFIG, err.deps),
    ).rejects.toThrow(/status 500/);
    const bad = upstream(200, { sites: "nope" });
    await expect(
      readApi(PATH, CatalogContextResponseSchema, { sessionToken: TOKEN }, CONFIG, bad.deps),
    ).rejects.toThrow(/contract/);
  });
});
