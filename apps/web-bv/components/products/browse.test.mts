// DP-160 + DP-163 regression: URL browsing, filtering, paging and the strip/chip helpers.
// Pure functions; run with `node --test` (Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicCategory, PublicProductSummary } from "@dream/contracts";

import {
  browseHref,
  buildTree,
  categoryLabel,
  chipRows,
  filterProducts,
  PAGE_SIZE,
  paginate,
  parseBrowse,
  topCategories,
  trail,
} from "./browse.ts";

const cat = (slug: string, name: string, parentSlug: string | null, sortOrder: number, count: number) =>
  ({ slug, name, parentSlug, sortOrder, count }) satisfies PublicCategory;

const CATS: PublicCategory[] = [
  cat("base-oil", "Base Oil", null, 10, 3),
  cat("base-oil-group-i", "Group I", "base-oil", 20, 1),
  cat("base-oil-group-iii", "Group III", "base-oil", 40, 1),
  cat("base-oil-group-iii-plus", "Group III+", "base-oil", 50, 1),
  cat("white-oil", "White Oil", null, 60, 1),
  cat("rubber-filled-with-oil-agent", "Rubber Filled With Oil (Agent)", null, 140, 1),
];

const product = (code: string, name: string, category: string): PublicProductSummary => ({
  slug: code.toLowerCase(),
  code,
  name,
  summary: null,
  category: { slug: category, name: CATS.find((c) => c.slug === category)!.name },
  cover: null,
  publishedAt: "2026-11-14T10:00:00.000Z",
  hasTechnicalData: false,
  hasDocuments: false,
});

const PRODUCTS = [
  product("G1-SN150", "Group I Base Oil SN 150", "base-oil-group-i"),
  product("ICCSYN-6-G3", "ICCSYN 6 (CTL Technology) Group III", "base-oil-group-iii"),
  product("ICCSYN-6-G3P", "ICCSYN 6 (CTL Technology) Group III+", "base-oil-group-iii-plus"),
  product("WO-W1-30", "White Oil W1-30", "white-oil"),
  product("RPO-4106", "Rubber Filled With Oil (Agent) 4106#", "rubber-filled-with-oil-agent"),
];

describe("parseBrowse", () => {
  it("reads category, query and page; malformed values fall back", () => {
    assert.deepEqual(parseBrowse({ category: "Base-Oil", q: "  iccsyn   6 ", page: "2" }), {
      category: "base-oil",
      q: "iccsyn 6",
      page: 2,
    });
    assert.deepEqual(parseBrowse({ category: "../x", page: "-3" }), { category: null, q: "", page: 1 });
    assert.equal(parseBrowse({ page: "999999" }).page, 1000);
    assert.equal(parseBrowse({ q: "x".repeat(200) }).q.length, 80);
  });
});

describe("filterProducts", () => {
  it("a category includes its sub-categories", () => {
    const p = parseBrowse({ category: "base-oil" });
    assert.deepEqual(
      filterProducts(PRODUCTS, CATS, p).map((x) => x.code),
      ["G1-SN150", "ICCSYN-6-G3", "ICCSYN-6-G3P"],
    );
  });
  it("keeps ICCSYN-6-G3 and ICCSYN-6-G3P apart by category and by code", () => {
    assert.deepEqual(
      filterProducts(PRODUCTS, CATS, parseBrowse({ category: "base-oil-group-iii" })).map((x) => x.code),
      ["ICCSYN-6-G3"],
    );
    assert.deepEqual(
      filterProducts(PRODUCTS, CATS, parseBrowse({ q: "iccsyn-6-g3p" })).map((x) => x.code),
      ["ICCSYN-6-G3P"],
    );
  });
  it("searches name, code and category, case and accent insensitive, within the category", () => {
    assert.deepEqual(
      filterProducts(PRODUCTS, CATS, parseBrowse({ q: "RÜBBER" })).map((x) => x.code),
      ["RPO-4106"],
    );
    assert.deepEqual(
      filterProducts(PRODUCTS, CATS, parseBrowse({ category: "white-oil", q: "iccsyn" })),
      [],
    );
  });
});

describe("paginate and links", () => {
  it("pages by PAGE_SIZE and clamps the page", () => {
    const many = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => i);
    assert.deepEqual(paginate(many, 9).page, 2);
    assert.equal(paginate(many, 2).items.length, 3);
    assert.equal(paginate([], 1).pages, 1);
  });
  it("leaves defaults out of the URL and keeps the query with a category", () => {
    assert.equal(browseHref({}), "/products");
    assert.equal(browseHref({ category: "base-oil", q: "sn 150", page: 1 }), "/products?category=base-oil&q=sn+150");
    assert.equal(browseHref({ page: 3 }), "/products?page=3");
  });
});

describe("DP-163 strip and chips", () => {
  it("lists only top-level categories for the strip, in API order", () => {
    assert.deepEqual(
      topCategories(CATS).map((c) => c.slug),
      ["base-oil", "white-oil", "rubber-filled-with-oil-agent"],
    );
    assert.equal(buildTree(CATS).length, 3);
  });
  it("shows sub-category chips for the chosen branch only", () => {
    assert.deepEqual(chipRows(CATS, null), []);
    assert.deepEqual(chipRows(CATS, "white-oil"), []);
    const rows = chipRows(CATS, "base-oil-group-iii");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.parent.slug, "base-oil");
    assert.deepEqual(
      rows[0]!.children.map((c) => c.slug),
      ["base-oil-group-i", "base-oil-group-iii", "base-oil-group-iii-plus"],
    );
    assert.deepEqual(trail(CATS, "base-oil-group-iii").map((c) => c.slug), ["base-oil", "base-oil-group-iii"]);
  });
  it("labels a card with the category path", () => {
    assert.equal(categoryLabel(CATS, PRODUCTS[2]!.category), "Base Oil · Group III+");
    assert.equal(categoryLabel([], { slug: "x", name: "X" }), "X");
  });
});
