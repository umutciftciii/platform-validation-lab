// ML-3 (DP-236, ADR-028 D5, R-37): the proxy rules and the database redirects evaluated together.
//
// The fixture is the DP-212 import file (83 rows) that is LIVE IN DEV today
// (lib/dp-212-redirects.fixture.ts, generated from
// docs/cms/legacy-url-map/legacy-redirects.import.csv and compared with it where docs exist). Many rows are `/en/x → /x`; the ML-3 rule is
// `/x → /en/x`. These tests show what a visitor would get if ML-3 met those rows before ML-4: never a
// loop, never more than one redirect; the two-way pairs are refused (404) instead of served.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DP_212_IMPORT_ROWS } from "./dp-212-redirects.fixture.ts";
import {
  auditRedirects,
  follow,
  parseRedirectCsv,
  rowFromCsv,
  type RedirectRow,
  type SiteState,
} from "./redirect-audit.ts";

const DOCS_COPY = new URL("../../../docs/cms/legacy-url-map/legacy-redirects.import.csv", import.meta.url);
const rows = DP_212_IMPORT_ROWS.filter(([, , , active]) => active === "true").map(
  ([source, target, status]) => rowFromCsv(source, target, status),
);

/** Stored target paths of the rows (without query): the addresses the map points at. */
const targetPaths = [...new Set(rows.map((r) => r.target.split("?")[0] as string))];

function site(live: Iterable<string>, extra: RedirectRow[] = [], publicLocales = ["en"]): SiteState {
  return { rows: [...rows, ...extra], live: new Set(live), publicLocales };
}

describe("DP-212 fixture", () => {
  it("is the 83-row import file that is live in DEV", () => {
    assert.equal(rows.length, 83);
    // Private repository: the fixture equals the map file row for row (the public export has no
    // docs/, so there only the count is checked).
    if (existsSync(DOCS_COPY)) {
      assert.deepEqual(rows, parseRedirectCsv(readFileSync(DOCS_COPY, "utf8")));
    }
  });
});

describe("ML-3 routing with the 83 DEV rows", () => {
  for (const [name, live] of [
    ["every target live", targetPaths.filter((p) => p !== "/products" && p !== "/news")],
    ["nothing live", []],
    ["half the targets live", targetPaths.filter((_, i) => i % 2 === 0)],
  ] as const) {
    it(`never loops and never answers more than one redirect (${name})`, async () => {
      const report = await auditRedirects(site(live));
      assert.ok(report.length >= 83 + 1);
      for (const e of report) {
        assert.notEqual(e.final, "loop", `${e.request}: ${e.hops.join(" -> ")}`);
        assert.ok(e.hops.length <= 1, `${e.request}: ${e.hops.join(" -> ")}`);
      }
    });
  }

  it("serves a live /en address directly: the old row /en/x → /x is never consulted", async () => {
    const s = site(["/about-us", "/contact", "/logistics"]);
    for (const p of ["/en/about-us", "/en/logistics", "/en/contact"]) {
      const e = await follow(s, p);
      assert.equal(e.final, "page", p);
      assert.deepEqual(e.hops, [], p);
    }
  });

  it("refuses a two-way pair when the address has nothing live (404, no loop)", async () => {
    const e = await follow(site([]), "/en/about-us");
    assert.equal(e.final, "refused");
    assert.deepEqual(e.hops, []);
  });

  it("answers the real mapping changes in one hop at the /en address", async () => {
    const s = site(["/news", "/contact", "/products/solvent-oil-petroleum-ether"]);
    const cases: [string, string][] = [
      ["/en/blog", "/en/news"],
      ["/en/contact-us", "/en/contact"],
      ["/en/index", "/en"],
      ["/en/products/grease-petroleumetherbv", "/en/products/solvent-oil-petroleum-ether"],
      ["/tr/products", "/en/products"],
      ["/tr/products/base-oil-2-100n", "/en/products/base-oil-2-100n"],
      ["/tr/products?category=grease", "/en/products?category=solvent-oil"],
      ["/tr/products?page=3", "/en/products"],
      [
        "/en/blog_detail/why-are-oil-prices-falling-the-impact-of-the-us-iran-agreement-on-energy-markets/1",
        "/en/news/why-are-oil-prices-falling-the-impact-of-the-us-iran-agreement-on-energy-markets",
      ],
    ];
    for (const [from, to] of cases) {
      const e = await follow(s, from);
      assert.deepEqual(e.hops, [to], from);
    }
  });

  it("serves the old /en/products list addresses as the list page itself (no row, no hop)", async () => {
    const s = site([]);
    for (const p of ["/en/products", "/en/products?category=base-oil", "/en/products?page=2"]) {
      const e = await follow(s, p);
      assert.equal(e.final, "page", p);
      assert.deepEqual(e.hops, [], p);
    }
    // `/en` is the home page, not the old row `/en → /`.
    assert.equal((await follow(s, "/en")).final, "page");
  });

  it("answers / and unprefixed addresses with exactly one 301 to /en", async () => {
    const s = site(["/about-us"]);
    assert.deepEqual((await follow(s, "/")).hops, ["/en"]);
    assert.deepEqual((await follow(s, "/about-us")).hops, ["/en/about-us"]);
    assert.deepEqual((await follow(s, "/products?category=base-oil")).hops, [
      "/en/products?category=base-oil",
    ]);
  });
});

describe("synthetic cycles and chains across proxy and database", () => {
  it("refuses a database cycle that only exists through the prefix", async () => {
    // Stored rows /en/a → /b and /en/b → /a are not a chain for the database trigger
    // (`site_redirect_no_chain` compares stored strings), but with ML-3 they are a cycle.
    const s = site(
      [],
      [rowFromCsv("/en/a", "/b", "301"), rowFromCsv("/en/b", "/a", "301")],
    );
    for (const p of ["/en/a", "/en/b", "/a", "/b"]) {
      const e = await follow(s, p);
      assert.notEqual(e.final, "loop", p);
      assert.ok(e.hops.length <= 1, `${p}: ${e.hops.join(" -> ")}`);
    }
    assert.equal((await follow(s, "/en/a")).final, "refused");
  });

  it("collapses a chain that only exists through the prefix into one hop", async () => {
    const s = site(
      ["/c"],
      [rowFromCsv("/en/a", "/b", "301"), rowFromCsv("/en/b", "/c", "301")],
    );
    assert.deepEqual((await follow(s, "/en/a")).hops, ["/en/c"]);
    assert.equal((await follow(s, "/en/a")).final, "page");
  });

  it("keeps NL closed: no redirect row opens an address under /nl", async () => {
    const s = site(["/nl/over-ons"], [rowFromCsv("/en/over", "/nl/over-ons", "301")]);
    // The row may point there, but the address itself is a 404 while NL is not public.
    const e = await follow(s, "/en/over");
    assert.deepEqual(e.hops, ["/nl/over-ons"]);
    assert.equal(e.final, "not-found");
    assert.equal((await follow(s, "/nl/over-ons")).final, "not-found");
    // Once public, the Dutch page is served.
    const open = { ...s, publicLocales: ["en", "nl"] };
    assert.equal((await follow(open, "/nl/over-ons")).final, "page");
  });
});
