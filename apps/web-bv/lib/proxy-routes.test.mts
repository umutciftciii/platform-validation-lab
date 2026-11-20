// DP-220 + ML-3 (DP-236): the proxy's address forms and its decision. The lead form of a
// lead-gated document is one of the site's own addresses (inside a language since ML-3), only for a
// document the product lists as requestable. Every page address carries its language; `/` and
// unprefixed addresses answer one 301 to `/en`; a language that is not public is a 404.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TECHNICAL_PREFIXES,
  classifyPath,
  decide,
  decideRequest,
  documentRequestStatus,
  type DocumentsRead,
  type ProxyDeps,
  type ResolveAnswer,
} from "./proxy-routes.ts";

const DOC = "01a1eb64-aeb0-7112-93ac-1a6ee105cdc7";
const OTHER = "0190f2a1-0000-7000-8000-000000000000";

describe("classifyPath", () => {
  it("recognises the document request form inside a language", () => {
    assert.deepEqual(classifyPath(`/en/products/iccsyn-10-ctl-technology/documents/${DOC}`), {
      kind: "document-request",
      locale: "en",
      slug: "iccsyn-10-ctl-technology",
      id: DOC,
    });
    // Without a prefix it is the same address in English (one 301).
    assert.deepEqual(classifyPath(`/products/iccsyn-10-ctl-technology/documents/${DOC}`), {
      kind: "unprefixed",
      rest: `/products/iccsyn-10-ctl-technology/documents/${DOC}`,
    });
  });

  it("answers a malformed document request address with a 404, never an old-site lookup", () => {
    for (const p of [
      `/products/iccsyn-10-ctl-technology/documents/not-an-id`,
      `/products/iccsyn-10-ctl-technology/documents/${DOC.toUpperCase()}`,
      `/products/iccsyn-10-ctl-technology/documents/${DOC}x`,
      `/products/ICCSYN-10/documents/${DOC}`,
      `/products/bad--slug/documents/${DOC}`,
      `/products/${"a".repeat(121)}/documents/${DOC}`,
      `/products/iccsyn-10-ctl-technology/documents/`,
    ]) {
      assert.equal(classifyPath(p).kind, "not-found", p);
      assert.equal(classifyPath(`/en${p}`).kind, "not-found", `/en${p}`);
    }
  });

  it("does not open other /products sub-paths", () => {
    for (const p of [
      `/products/iccsyn-10-ctl-technology/documents`,
      `/products/iccsyn-10-ctl-technology/specs`,
      `/products/iccsyn-10-ctl-technology/files/${DOC}`,
      `/products/iccsyn-10-ctl-technology/documents/${DOC}/download`,
      `/products/a/b`,
    ]) {
      for (const q of [p, `/en${p}`]) {
        const route = classifyPath(q);
        assert.ok(route.kind === "legacy" || route.kind === "not-found", `${q}: ${route.kind}`);
      }
    }
  });

  it("knows the address forms of ML-3", () => {
    const cases: [string, string][] = [
      ["/", "root"],
      ["/en", "home"],
      ["/nl", "home"],
      ["/en/about-us", "content"],
      ["/nl/over-ons", "content"],
      ["/en/news/some-article", "content"],
      ["/en/products/iccsyn-10-ctl-technology", "content"],
      ["/en/products", "list"],
      ["/en/news", "list"],
      ["/nl/products", "list"],
      ["/en/privacy", "privacy"],
      // the site's own forms without a prefix: one 301 to /en
      ["/about-us", "unprefixed"],
      ["/news", "unprefixed"],
      ["/news/some-article", "unprefixed"],
      ["/products", "unprefixed"],
      ["/products/iccsyn-10-ctl-technology", "unprefixed"],
      ["/privacy", "unprefixed"],
      // root files and internals
      ["/favicon.ico", "next"],
      ["/robots.txt", "next"],
      ["/sitemap.xml", "next"],
      ["/media/x.webp", "next"],
      ["/product-documents/x", "next"],
      ["/api/health", "next"],
      // old-site addresses (DP-212): redirect only
      ["/index.html", "legacy"],
      ["/en/products/base-oil/extra", "legacy"],
      ["/en/blog_detail/x/1", "legacy"],
      ["/en/contact-us.html", "legacy"],
      ["/tr", "legacy"],
      ["/tr/hakkimizda", "legacy"],
      ["/tr/products/x", "legacy"],
      ["/EN/About-Us", "legacy"],
      ["/About-Us", "legacy"],
      ["/news/a/b", "legacy"],
      // two-letter segments are languages, never slugs
      ["/en/tr", "legacy"],
      ["/de", "legacy"],
      ["/a/b/c/d/e/f/g", "not-found"],
      ["/x%2e%2e/y", "not-found"],
    ];
    for (const [p, kind] of cases) assert.equal(classifyPath(p).kind, kind, p);
  });

  it("keeps the language of the request for its 404 frame", () => {
    assert.deepEqual(classifyPath("/nl/a/b/c/d/e/f/g"), { kind: "not-found", locale: "nl" });
    assert.deepEqual(classifyPath("/a/b/c/d/e/f/g"), { kind: "not-found", locale: "en" });
  });
});

describe("documentRequestStatus", () => {
  const listed = (requestable: boolean, id = DOC): DocumentsRead => ({
    ok: true,
    data: [{ id, requestable }],
  });

  it("renders the form for a requestable document", () => {
    assert.equal(documentRequestStatus(listed(true), DOC), "page");
  });

  it("is a 404 for an unknown document or one without a form", () => {
    assert.equal(documentRequestStatus(listed(true, OTHER), DOC), "not_found");
    assert.equal(documentRequestStatus(listed(false), DOC), "not_found");
    assert.equal(documentRequestStatus({ ok: true, data: [] }, DOC), "not_found");
  });

  it("is a 404 for an unknown or unpublished product", () => {
    assert.equal(documentRequestStatus({ ok: false, reason: "not_found" }, DOC), "not_found");
  });

  it("fails open while the API cannot answer (the page does its own checks)", () => {
    assert.equal(documentRequestStatus({ ok: false, reason: "unavailable" }, DOC), "page");
  });
});

// --- decide --------------------------------------------------------------------------------------

type Call = { path: string; search: string; locale?: string };

function fakeDeps(
  answers: Record<string, ResolveAnswer>,
  {
    publicLocales = ["en"] as readonly string[] | null,
    privacyPublished = true,
    docs = { ok: true, data: [{ id: DOC, requestable: true }] } as DocumentsRead,
  } = {},
): ProxyDeps & { calls: Call[]; loops: string[][] } {
  const calls: Call[] = [];
  const loops: string[][] = [];
  return {
    calls,
    loops,
    resolve: async (path, search, locale) => {
      calls.push({ path, search, ...(locale ? { locale } : {}) });
      return answers[`${locale ?? "en"} ${path}`] ?? { status: "not_found" };
    },
    publicLocales: async () => publicLocales,
    documents: async () => docs,
    privacyPublished,
    onLoop: (t) => loops.push([...t]),
  };
}

describe("decide", () => {
  it("answers / with one 301 to /en, keeping the query, without an API call", async () => {
    const deps = fakeDeps({});
    assert.deepEqual(await decide("/", "", deps), {
      action: "redirect",
      location: "/en",
      status: 301,
    });
    assert.deepEqual(await decide("/", "?utm=a", deps), {
      action: "redirect",
      location: "/en?utm=a",
      status: 301,
    });
    assert.equal(deps.calls.length, 0);
  });

  it("answers an unprefixed address with one 301 to the /en address", async () => {
    const deps = fakeDeps({ "en /about-us": { status: "found" } });
    assert.deepEqual(await decide("/about-us", "?x=1", deps), {
      action: "redirect",
      location: "/en/about-us?x=1",
      status: 301,
    });
    assert.deepEqual(await decide("/products", "?category=base-oil", deps), {
      action: "redirect",
      location: "/en/products?category=base-oil",
      status: 301,
    });
  });

  it("collapses unprefixed → /en → moved into ONE hop", async () => {
    const deps = fakeDeps({
      "en /old-name": { status: "redirect", target: "/new-name", statusCode: 301 },
    });
    assert.deepEqual(await decide("/old-name", "", deps), {
      action: "redirect",
      location: "/en/new-name",
      status: 301,
    });
  });

  it("serves live English content under /en, asking the API with the stored address", async () => {
    const deps = fakeDeps({ "en /about-us": { status: "found" } });
    assert.deepEqual(await decide("/en/about-us", "", deps), { action: "next" });
    assert.deepEqual(deps.calls, [{ path: "/about-us", search: "" }]);
  });

  it("gives a stored redirect target its /en address", async () => {
    const deps = fakeDeps({
      "en /old": { status: "redirect", target: "/new?x=1", statusCode: 302, keepQuery: false },
    });
    assert.deepEqual(await decide("/en/old", "?y=2", deps), {
      action: "redirect",
      location: "/en/new?x=1",
      status: 302,
    });
  });

  it("asks the old-site row of an /en address only when nothing is live", async () => {
    const deps = fakeDeps({
      "en /en/contact-us": { status: "redirect", target: "/contact", statusCode: 301 },
    });
    assert.deepEqual(await decide("/en/contact-us", "", deps), {
      action: "redirect",
      location: "/en/contact",
      status: 301,
    });
    assert.deepEqual(
      deps.calls.map((c) => c.path),
      ["/contact-us", "/en/contact-us", "/contact", "/en/contact"],
    );
  });

  it("refuses a two-way redirect (DP-212 /en/x → /x meets ML-3 /x → /en/x) with a 404", async () => {
    const deps = fakeDeps({
      "en /en/about-us": { status: "redirect", target: "/about-us", statusCode: 301 },
    });
    assert.deepEqual(await decide("/en/about-us", "", deps), { action: "not-found", locale: "en" });
    assert.deepEqual(deps.loops, [["/en/about-us", "/en/about-us"]]);
    // The unprefixed form: one honest hop to /en/about-us, which then answers its own 404.
    assert.deepEqual(await decide("/about-us", "", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 301,
    });
  });

  it("refuses longer cycles and over-long chains", async () => {
    const cycle = fakeDeps({
      "en /a": { status: "redirect", target: "/b", statusCode: 301 },
      "en /b": { status: "redirect", target: "/c", statusCode: 301 },
      "en /c": { status: "redirect", target: "/a", statusCode: 301 },
    });
    assert.deepEqual(await decide("/en/a", "", cycle), { action: "not-found", locale: "en" });
    assert.deepEqual(cycle.loops[0], ["/en/a", "/en/b", "/en/c", "/en/a"]);

    const answers: Record<string, ResolveAnswer> = {};
    for (let i = 0; i < 9; i++) {
      answers[`en /s${i}`] = { status: "redirect", target: `/s${i + 1}`, statusCode: 301 };
    }
    const long = fakeDeps(answers);
    assert.deepEqual(await decide("/en/s0", "", long), { action: "not-found", locale: "en" });
    assert.equal(long.loops.length, 1);
  });

  it("answers a short chain in one hop, 302 when any hop is temporary", async () => {
    const deps = fakeDeps({
      "en /a": { status: "redirect", target: "/b", statusCode: 301 },
      "en /b": { status: "redirect", target: "/c", statusCode: 302 },
      "en /c": { status: "found" },
    });
    assert.deepEqual(await decide("/en/a", "", deps), {
      action: "redirect",
      location: "/en/c",
      status: 302,
    });
  });

  it("keeps an external target as the end of the chain", async () => {
    const deps = fakeDeps({
      "en /out": { status: "redirect", target: "https://example.com/x", statusCode: 301 },
    });
    assert.deepEqual(await decide("/en/out", "", deps), {
      action: "redirect",
      location: "https://example.com/x",
      status: 301,
    });
  });

  it("is a 404 under a language that is not public, without asking about content", async () => {
    const deps = fakeDeps({ "nl /over-ons": { status: "found" } }, { publicLocales: ["en"] });
    for (const p of [
      "/nl",
      "/nl/over-ons",
      "/nl/news",
      "/nl/news/x",
      "/nl/products",
      "/nl/privacy",
    ]) {
      assert.deepEqual(await decide(p, "", deps), { action: "not-found", locale: "nl" }, p);
    }
    assert.equal(deps.calls.length, 0);
    // Unknown visibility (API down) is not public either.
    const down = fakeDeps({}, { publicLocales: null });
    assert.deepEqual(await decide("/nl", "", down), { action: "not-found", locale: "nl" });
    // The default language never depends on the list.
    assert.deepEqual(await decide("/en", "", down), { action: "next" });
  });

  it("serves Dutch content once NL is public, asking with the language", async () => {
    const deps = fakeDeps({ "nl /over-ons": { status: "found" } }, { publicLocales: ["en", "nl"] });
    assert.deepEqual(await decide("/nl/over-ons", "", deps), { action: "next" });
    assert.deepEqual(deps.calls[0], { path: "/over-ons", search: "", locale: "nl" });
    assert.deepEqual(await decide("/nl", "", deps), { action: "next" });
    assert.deepEqual(await decide("/nl/news", "", deps), { action: "next" });
    // No English content under /nl: an unknown Dutch address is a 404 (no old-site lookup).
    assert.deepEqual(await decide("/nl/about-us", "", deps), { action: "not-found", locale: "nl" });
    // No Dutch catalogue or policy yet (ML-8c, ADR-028 D12).
    for (const p of [
      "/nl/products",
      "/nl/products/x",
      `/nl/products/x/documents/${DOC}`,
      "/nl/privacy",
    ]) {
      assert.deepEqual(await decide(p, "", deps), { action: "not-found", locale: "nl" }, p);
    }
  });

  it("keeps the article's 'no longer available' page and 404s other unpublished content", async () => {
    const deps = fakeDeps({
      "en /news/gone": { status: "unpublished" },
      "en /gone": { status: "unpublished" },
    });
    assert.deepEqual(await decide("/en/news/gone", "", deps), { action: "next" });
    assert.deepEqual(await decide("/en/gone", "", deps), { action: "not-found", locale: "en" });
  });

  it("fails open for content while the API cannot answer, closed for old-site addresses", async () => {
    const deps = fakeDeps({
      "en /about-us": { status: "unknown" },
      "en /index.html": { status: "unknown" },
    });
    assert.deepEqual(await decide("/en/about-us", "", deps), { action: "next" });
    assert.deepEqual(await decide("/index.html", "", deps), { action: "not-found", locale: "en" });
  });

  it("keeps privacy and the document form rules", async () => {
    assert.deepEqual(await decide("/en/privacy", "", fakeDeps({})), { action: "next" });
    assert.deepEqual(await decide("/en/privacy", "", fakeDeps({}, { privacyPublished: false })), {
      action: "not-found",
      locale: "en",
    });
    const form = `/en/products/x/documents/${DOC}`;
    assert.deepEqual(await decide(form, "", fakeDeps({})), { action: "next" });
    assert.deepEqual(
      await decide(
        form,
        "",
        fakeDeps({}, { docs: { ok: true, data: [{ id: DOC, requestable: false }] } }),
      ),
      { action: "not-found", locale: "en" },
    );
  });

  it("never touches technical endpoints and root files", async () => {
    const deps = fakeDeps({});
    for (const p of [
      "/favicon.ico",
      "/robots.txt",
      "/sitemap.xml",
      "/media/brand/logo.svg",
      "/product-documents/x",
      "/product-images/x/display",
      "/lead-form/contact",
      "/preview/x",
      "/api/health",
      "/_next/static/chunk.js",
    ]) {
      assert.deepEqual(await decide(p, "", deps), { action: "next" }, p);
    }
    assert.equal(deps.calls.length, 0);
  });
});

describe("ML-4: list views and rows bound to their exact query", () => {
  it("serves a list without a query without an API call", async () => {
    const deps = fakeDeps({});
    assert.deepEqual(await decide("/en/products", "", deps), { action: "next" });
    assert.deepEqual(await decide("/en/news", "", deps), { action: "next" });
    assert.equal(deps.calls.length, 0);
  });

  it("answers a row bound to the exact query of an /en list view in one hop", async () => {
    const deps = fakeDeps({
      "en /en/products": {
        status: "redirect",
        target: "/products?category=solvent-oil",
        statusCode: 301,
        keepQuery: false,
      },
    });
    assert.deepEqual(await decide("/en/products", "?category=grease", deps), {
      action: "redirect",
      location: "/en/products?category=solvent-oil",
      status: 301,
    });
  });

  it("never follows a plain row of the list address (the list itself is live)", async () => {
    // A DP-212 row /en/products → /products (plain: keeps the query) must not turn the list
    // into a redirect to itself.
    const deps = fakeDeps({
      "en /en/products": { status: "redirect", target: "/products", statusCode: 301 },
    });
    for (const q of ["?category=base-oil", "?page=2", "?q=iccsyn"]) {
      assert.deepEqual(await decide("/en/products", q, deps), { action: "next" }, q);
    }
    assert.equal(deps.loops.length, 0);
  });

  it("never answers a bound row that points at the request itself", async () => {
    const deps = fakeDeps({
      "en /en/products": {
        status: "redirect",
        target: "/products?category=base-oil",
        statusCode: 301,
        keepQuery: false,
      },
    });
    assert.deepEqual(await decide("/en/products", "?category=base-oil", deps), { action: "next" });
    assert.equal(deps.loops.length, 0);
  });

  it("renders the list while the API cannot answer or has no row", async () => {
    assert.deepEqual(
      await decide(
        "/en/products",
        "?page=4",
        fakeDeps({ "en /en/products": { status: "unknown" } }),
      ),
      { action: "next" },
    );
    assert.deepEqual(await decide("/en/products", "?category=white-oil", fakeDeps({})), {
      action: "next",
    });
  });

  it("does not ask for rows under another language", async () => {
    const deps = fakeDeps({}, { publicLocales: ["en", "nl"] });
    assert.deepEqual(await decide("/nl/news", "?page=2", deps), { action: "next" });
    assert.equal(deps.calls.length, 0);
  });
});

describe("ML-4: trailing slash (decideRequest)", () => {
  const calls: string[] = [];
  const deps: ProxyDeps = {
    resolve: async (path) => {
      calls.push(path);
      if (path === "/tr") return { status: "redirect", target: "/", statusCode: 301 };
      if (path === "/tr/old") return { status: "redirect", target: "/about-us", statusCode: 302 };
      if (path === "/about-us" || path === "/") return { status: "found" };
      return { status: "not_found" };
    },
    publicLocales: async () => ["en"],
    documents: async () => ({ ok: false, reason: "not_found" }),
    privacyPublished: true,
  };

  it("answers the redirect of the slash-less address at once (one hop)", async () => {
    assert.deepEqual(await decideRequest("/tr/", "", "GET", deps), {
      action: "redirect",
      location: "/en",
      status: 301,
    });
    assert.deepEqual(await decideRequest("/tr/", "?a=1", "HEAD", deps), {
      action: "redirect",
      location: "/en?a=1",
      status: 301,
    });
    // Unprefixed site address: the ML-3 301 directly.
    assert.deepEqual(await decideRequest("/about-us/", "", "GET", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 301,
    });
    // A temporary redirect stays temporary.
    assert.equal(
      ((await decideRequest("/tr/old/", "", "GET", deps)) as { status: number }).status,
      302,
    );
  });

  it("otherwise normalises with Next's 308 (query kept), without changing the answer", async () => {
    for (const [path, search, location] of [
      ["/en/", "", "/en"],
      ["/en/about-us/", "?x=1", "/en/about-us?x=1"],
      ["/en/no-such-page/", "", "/en/no-such-page"],
      ["/nl/", "", "/nl"],
    ] as const) {
      assert.deepEqual(await decideRequest(path, search, "GET", deps), {
        action: "redirect",
        location,
        status: 308,
      });
    }
  });

  it("never asks the API for technical addresses or other methods; no slash: decide as before", async () => {
    calls.length = 0;
    for (const p of [
      "/_next/static/x/",
      "/api/health/",
      "/media/a/",
      "/preview/t/",
      "/lead-form/c/",
    ]) {
      const d = await decideRequest(p, "", "GET", deps);
      assert.deepEqual(d, { action: "redirect", location: p.slice(0, -1), status: 308 }, p);
    }
    assert.deepEqual(await decideRequest("/tr/", "", "POST", deps), {
      action: "redirect",
      location: "/tr",
      status: 308,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(await decideRequest("/tr", "", "POST", deps), { action: "next" });
    assert.deepEqual(await decideRequest("/en", "", "GET", deps), { action: "next" });
    assert.deepEqual(await decideRequest("/tr", "", "GET", deps), await decide("/tr", "", deps));
    // Only a slash after a segment: `/` itself and `//` are not normalised here.
    assert.deepEqual(await decideRequest("/", "", "GET", deps), await decide("/", "", deps));
  });

  it("TECHNICAL_PREFIXES are exactly the prefixes the proxy.ts matcher leaves out", () => {
    const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    const m = /\(\?!([^)]+)\)/.exec(src);
    assert.ok(m, "matcher exclusion not found");
    const fromMatcher = (m[1] as string).split("|").map((p) => `/${p}`);
    assert.deepEqual([...fromMatcher].sort(), [...TECHNICAL_PREFIXES].sort());
    assert.ok(src.includes('"/:path+/"'), "matcher for addresses with a trailing slash");
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    assert.match(config, /skipTrailingSlashRedirect: true/);
  });
});
