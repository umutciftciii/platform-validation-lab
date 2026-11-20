// ML-4 (DP-237, ADR-028 D4/D5, R-37): the rebuilt legacy URL map, evaluated through the real proxy
// decision (`decide`) and a simulated `seo/resolve` (database rows + live addresses of DEV).
//
// Every one of the 245 old addresses is requested like a browser would and must get exactly what
// the inventory's `expected` column says: KEEP 200 directly, REDIRECT one 301 to a live target,
// REVIEW/UNMATCHED a 404 (never the home page). The DEV transition states (old rows only, no rows,
// old and new rows together) are checked for loops and chains as well.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DP_212_IMPORT_ROWS } from "./dp-212-redirects.fixture.ts";
import { localePath } from "./locale-routing.ts";
import {
  ML_4_IMPORT_ROWS,
  ML_4_INVENTORY,
  ML_4_LIVE_STORED,
  ML_4_PUBLIC_LOCALES,
} from "./ml-4-legacy-map.fixture.ts";
import {
  auditRedirects,
  follow,
  parseRedirectCsv,
  rowFromCsv,
  type AuditEntry,
  type RedirectRow,
  type SiteState,
} from "./redirect-audit.ts";

const MAP_DIR = new URL("../../../docs/cms/legacy-url-map/", import.meta.url);

const toRows = (rows: typeof ML_4_IMPORT_ROWS | typeof DP_212_IMPORT_ROWS): RedirectRow[] =>
  rows.filter(([, , , active]) => active === "true").map(([s, t, st]) => rowFromCsv(s, t, st));

const ML4 = toRows(ML_4_IMPORT_ROWS);
const DP212 = toRows(DP_212_IMPORT_ROWS);

function site(rows: readonly RedirectRow[], live: Iterable<string> = ML_4_LIVE_STORED): SiteState {
  return { rows, live: new Set(live), publicLocales: ML_4_PUBLIC_LOCALES };
}

/** One row per source (the import upserts by source + query): later lists win. */
function merged(...lists: (readonly RedirectRow[])[]): RedirectRow[] {
  const bySource = new Map<string, RedirectRow>();
  for (const list of lists)
    for (const r of list) bySource.set(`${r.sourcePath}?${r.sourceQuery}`, r);
  return [...bySource.values()];
}

function assertNoLoop(report: AuditEntry[], label: string): void {
  for (const e of report) {
    assert.notEqual(e.final, "loop", `${label}: ${e.request}: ${e.hops.join(" -> ")}`);
    assert.ok(e.hops.length <= 1, `${label}: ${e.request}: ${e.hops.join(" -> ")}`);
  }
}

describe("ML-4 fixture", () => {
  it("is the map of docs/cms/legacy-url-map (where the docs are present)", () => {
    assert.equal(ML_4_INVENTORY.length, 245);
    assert.equal(new Set(ML_4_INVENTORY.map((r) => r.source.toLowerCase())).size, 245);
    const imp = new URL("legacy-redirects.import.csv", MAP_DIR);
    if (existsSync(imp)) assert.deepEqual(ML4, parseRedirectCsv(readFileSync(imp, "utf8")));
    const inv = new URL("legacy-url-inventory.csv", MAP_DIR);
    if (existsSync(inv)) {
      const lines = readFileSync(inv, "utf8").trim().split("\n");
      assert.equal(lines.length - 1, 245);
    }
  });

  it("has a row for every REDIRECT with mechanism `row`, and only for those", () => {
    const rowSources = new Set(
      ML4.map((r) => (r.sourceQuery ? `${r.sourcePath}?${r.sourceQuery}` : r.sourcePath)),
    );
    const wanted = ML_4_INVENTORY.filter((r) => r.mechanism === "row").map((r) =>
      r.source.toLowerCase(),
    );
    assert.deepEqual([...rowSources].sort(), [...wanted].sort());
    for (const r of ML_4_INVENTORY) {
      if (r.action === "KEEP") assert.ok(!rowSources.has(r.source.toLowerCase()), r.source);
    }
  });

  it("never stores a row from a site address to itself, a chain, or a target outside /en", () => {
    const sources = new Set(ML4.map((r) => r.sourcePath));
    for (const r of ML4) {
      const targetPath = r.target.split("?")[0] as string;
      assert.ok(!sources.has(targetPath), `chain: ${r.sourcePath} -> ${r.target}`);
      assert.ok(!targetPath.startsWith("/nl"), `target under /nl: ${r.target}`);
      assert.ok(!/^https?:/i.test(r.target), `external target: ${r.target}`);
      // `/en/x → /x` is the same address under ML-3: never a row (a KEEP).
      if (r.sourcePath.startsWith("/en/") && !r.sourceQuery) {
        assert.notEqual(localePath("en", r.target), r.sourcePath, r.sourcePath);
      }
    }
  });
});

describe("ML-4: every old address through proxy + database", () => {
  const s = site(ML4);

  for (const inv of ML_4_INVENTORY) {
    it(`${inv.action} ${inv.source}`, async () => {
      // The whole answer as a browser sees it (trailing slash included, `decideRequest`).
      const entry = await follow(s, inv.source);
      const steps = inv.expected.split(" > ");
      const last = steps.pop() as string;
      const redirects = steps.map((st) => [Number(st.slice(0, 3)), st.slice(4)] as const);
      const trail = `${inv.source}: ${entry.statuses.join(",")} ${entry.hops.join(" -> ")}`;
      assert.deepEqual(
        entry.hops,
        redirects.map(([, to]) => to),
        trail,
      );
      assert.deepEqual(
        entry.statuses,
        redirects.map(([code]) => code),
        trail,
      );
      assert.ok(entry.hops.length <= 1, `at most one redirect: ${trail}`);
      if (last.startsWith("200")) {
        assert.equal(entry.final, "page", trail);
      } else {
        assert.equal(last, "404", inv.source);
        assert.equal(entry.final, "not-found", trail);
      }
      const [first] = redirects;
      if (first && first[0] === 301) {
        // A REVIEW address without a row of its own may be covered by a plain row that keeps the
        // query (`/tr/products`); never a target of its own, never the home page.
        if (inv.action === "REDIRECT") assert.equal(inv.publicTarget, first[1], inv.source);
        else assert.notEqual(first[1], "/en", inv.source);
      }
      if (inv.action === "REVIEW" || inv.action === "UNMATCHED") {
        assert.ok(!entry.hops.includes("/en"), `${inv.source} must never reach the home page`);
      }
    });
  }

  it("answers /en itself (200, never redirected) and /en/ with the slash 308 only", async () => {
    const en = await follow(s, "/en");
    assert.equal(en.final, "page");
    assert.deepEqual(en.hops, []);
    assert.equal(en.decision.action, "next");
    const slashed = await follow(s, "/en/");
    assert.deepEqual([slashed.statuses, slashed.hops, slashed.final], [[308], ["/en"], "page"]);
  });

  it("answers /tr/ with one 301 to /en (no 308 first), the query kept by the plain row", async () => {
    for (const [from, to] of [
      ["/tr/", "/en"],
      ["/TR/", "/en"],
      ["/tr/?utm_source=x", "/en?utm_source=x"],
      ["/tr/about-us/", "/en/about-us"],
      ["/en/contact-us/", "/en/contact"],
      ["/about-us/", "/en/about-us"],
    ] as const) {
      const e = await follow(s, from);
      assert.deepEqual([e.statuses, e.hops, e.final], [[301], [to], "page"], from);
    }
  });

  it("keeps the slash normalisation of every other address (one 308, then its own answer)", async () => {
    for (const [from, to, final] of [
      ["/en/about-us/", "/en/about-us", "page"],
      ["/en/products/?category=base-oil", "/en/products?category=base-oil", "page"],
      ["/en/no-such-page/", "/en/no-such-page", "not-found"],
      ["/nl/", "/nl", "not-found"],
      ["/robots.txt/", "/robots.txt", "page"],
      ["/api/health/", "/api/health", "page"],
      ["/_next/static/x/", "/_next/static/x", "page"],
      ["/media/brand/", "/media/brand", "page"],
    ] as const) {
      const e = await follow(s, from);
      assert.deepEqual([e.statuses, e.hops, e.final], [[308], [to], final], from);
    }
  });

  it("sends nothing to the home page except the old home addresses", () => {
    const home = ML_4_INVENTORY.filter((r) => r.publicTarget === "/en").map((r) => r.source);
    assert.deepEqual(home.sort(), ["/", "/en/index", "/tr", "/tr/"].sort());
  });

  it("answers every request of the audit with at most one redirect and no loop", async () => {
    assertNoLoop(await auditRedirects(s), "ML-4 rows");
  });

  it("keeps the queries as designed", async () => {
    // A plain row keeps the visitor's query; a row bound to a query sends its own target.
    assert.deepEqual((await follow(s, "/tr/products?q=iccsyn")).hops, ["/en/products?q=iccsyn"]);
    assert.deepEqual((await follow(s, "/en/contact-us?utm_source=mail")).hops, [
      "/en/contact?utm_source=mail",
    ]);
    assert.deepEqual((await follow(s, "/tr/products?page=4")).hops, ["/en/products"]);
    assert.deepEqual((await follow(s, "/tr/products?category=grease")).hops, [
      "/en/products?category=solvent-oil",
    ]);
    // /en list views: only a row bound to the exact query; the list's own ?page=/?category= render.
    assert.deepEqual((await follow(s, "/en/products?category=grease")).hops, [
      "/en/products?category=solvent-oil",
    ]);
    for (const p of [
      "/en/products?page=4",
      "/en/products?category=base-oil&page=2",
      "/en/products?q=x",
    ]) {
      const e = await follow(s, p);
      assert.equal(e.final, "page", p);
      assert.deepEqual(e.hops, [], p);
    }
    // Upper case (the stored sources are lower case, the lookup lower-cases the path).
    assert.deepEqual((await follow(s, "/TR/About-Us")).hops, ["/en/about-us"]);
  });

  it("keeps /nl closed and technical endpoints untouched", async () => {
    for (const p of ["/nl", "/nl/over-ons", "/nl/products", "/nl/about-us"]) {
      assert.equal((await follow(s, p)).final, "not-found", p);
    }
    for (const p of [
      "/robots.txt",
      "/sitemap.xml",
      "/favicon.ico",
      "/api/health",
      "/media/brand/logo.svg",
      "/product-documents/x",
      "/product-images/x/display",
      "/preview/x",
      "/lead-form/contact",
      "/_next/static/chunk.js",
    ]) {
      const e = await follow(s, p);
      assert.equal(e.final, "page", p);
      assert.deepEqual(e.hops, [], p);
    }
  });

  it("serves every live address under /en and sends its unprefixed form there in one hop", async () => {
    for (const stored of ML_4_LIVE_STORED) {
      const pub = localePath("en", stored);
      assert.equal((await follow(s, pub)).final, "page", pub);
      if (stored !== "/") assert.deepEqual((await follow(s, stored)).hops, [pub], stored);
    }
  });
});

describe("ML-4: DEV transition states (R-37)", () => {
  it("1: old code state is not simulated here; new code with the 83 DP-212 rows never loops", async () => {
    assertNoLoop(await auditRedirects(site(DP212)), "DP-212 rows");
  });

  it("2: new code with no active row (after step 3): KEEP addresses already answer 200", async () => {
    const s = site([]);
    for (const inv of ML_4_INVENTORY.filter((r) => r.action === "KEEP")) {
      const entry = await follow(s, inv.source);
      assert.equal(entry.final, "page", inv.source);
    }
    for (const inv of ML_4_INVENTORY.filter((r) => r.mechanism === "row")) {
      const entry = await follow(s, inv.source);
      // Without a row an old address is a 404 for the minutes until the import (DEV only).
      assert.ok(entry.final === "not-found" || entry.final === "page", inv.source);
      assert.deepEqual(entry.hops, [], inv.source);
    }
  });

  it("3: the 83 old rows still active when the new map is imported: no loop, at most one hop", async () => {
    // The import updates rows with the same source; the rest of the 83 stay as they were.
    assertNoLoop(await auditRedirects(site(merged(DP212, ML4))), "DP-212 + ML-4 rows");
  });

  it("4: live content changes during the step (half the targets off): no loop, at most one hop", async () => {
    const half = ML_4_LIVE_STORED.filter((_, i) => i % 2 === 0);
    assertNoLoop(await auditRedirects(site(ML4, half)), "ML-4 rows, half live");
    assertNoLoop(await auditRedirects(site(merged(DP212, ML4), [])), "all rows, nothing live");
  });
});
