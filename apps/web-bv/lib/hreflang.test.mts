// ML-5 (DP-019): hreflang of a page and the addresses of sitemap.xml per language.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicSitemapEntry } from "@dream/contracts";

import { hreflangMap } from "./hreflang.ts";
import { sitemapUrls } from "./sitemap-entries.ts";

describe("hreflangMap", () => {
  it("names en, nl and x-default (English) for a reciprocal published pair", () => {
    assert.deepEqual(
      hreflangMap("en", "/about-us", [{ locale: "nl", path: "/over-ons", indexable: true }]),
      { en: "/en/about-us", nl: "/nl/over-ons", "x-default": "/en/about-us" },
    );
    // The same set from the Dutch page (reciprocal).
    assert.deepEqual(
      hreflangMap("nl", "/over-ons", [{ locale: "en", path: "/about-us", indexable: true }]),
      { en: "/en/about-us", nl: "/nl/over-ons", "x-default": "/en/about-us" },
    );
    assert.deepEqual(hreflangMap("en", "/", [{ locale: "nl", path: "/", indexable: true }]), {
      en: "/en",
      nl: "/nl",
      "x-default": "/en",
    });
  });

  it("an untranslated page has no hreflang, never a guessed /nl address", () => {
    assert.equal(hreflangMap("en", "/about-us", []), null);
    // A counterpart that may not be named (noindex, another canonical, unmarked) is left out.
    assert.equal(hreflangMap("en", "/about-us", [{ locale: "nl", path: "/over-ons", indexable: false }]), null);
    assert.equal(hreflangMap("en", "/about-us", [{ locale: "nl", path: "/over-ons" }]), null);
  });

  it("ignores languages without routes, duplicates, its own language and malformed paths", () => {
    assert.equal(
      hreflangMap("en", "/x", [
        { locale: "de", path: "/x", indexable: true },
        { locale: "en", path: "/other", indexable: true },
        { locale: "nl", path: "https://evil.example/", indexable: true },
        { locale: "nl", path: "//evil.example", indexable: true },
        { locale: "nl", path: "/NL", indexable: true },
      ]),
      null,
    );
    const two = hreflangMap("en", "/x", [
      { locale: "nl", path: "/een", indexable: true },
      { locale: "nl", path: "/twee", indexable: true },
    ]);
    assert.deepEqual(two, { en: "/en/x", nl: "/nl/een", "x-default": "/en/x" });
    // The page's own address must be a site path too.
    assert.equal(hreflangMap("en", "/x?y=1", [{ locale: "nl", path: "/y", indexable: true }]), null);
  });

  it("the sitemap mode accepts counterparts it already checked itself", () => {
    assert.deepEqual(
      hreflangMap("en", "/news", [{ locale: "nl", path: "/news" }], { requireIndexable: false }),
      { en: "/en/news", nl: "/nl/news", "x-default": "/en/news" },
    );
  });
});

const entry = (e: Partial<PublicSitemapEntry> & Pick<PublicSitemapEntry, "path" | "locale">): PublicSitemapEntry => ({
  kind: "page",
  lastModified: "2026-11-20T10:00:00.000Z",
  alternates: [],
  ...e,
});

describe("sitemapUrls", () => {
  const api: PublicSitemapEntry[] = [
    entry({ path: "/", locale: "en", kind: "home", alternates: [{ locale: "nl", path: "/" }] }),
    entry({ path: "/products", locale: "en", kind: "products", alternates: [{ locale: "nl", path: "/products" }] }),
    entry({ path: "/products/iccsyn-6", locale: "en", kind: "product", alternates: [{ locale: "nl", path: "/products/iccsyn-6" }] }),
    entry({ path: "/products/white-oil-15", locale: "en", kind: "product" }),
    entry({ path: "/about-us", locale: "en", alternates: [{ locale: "nl", path: "/over-ons" }] }),
    entry({ path: "/our-team", locale: "en", alternates: [{ locale: "nl", path: "/ons-team" }] }),
    entry({ path: "/", locale: "nl", kind: "home", alternates: [{ locale: "en", path: "/" }] }),
    entry({ path: "/over-ons", locale: "nl", alternates: [{ locale: "en", path: "/about-us" }] }),
    // ML-8c: the Dutch catalogue (the API lists only products published in Dutch).
    entry({ path: "/products", locale: "nl", kind: "products", alternates: [{ locale: "en", path: "/products" }] }),
    entry({ path: "/products/iccsyn-6", locale: "nl", kind: "product", alternates: [{ locale: "en", path: "/products/iccsyn-6" }] }),
    entry({ path: "/de-only", locale: "de" }),
  ];

  it("NL not public: only /en addresses, no Dutch URL and no Dutch alternate anywhere", () => {
    const urls = sitemapUrls(api, ["en"]);
    assert.deepEqual(
      urls.map((u) => u.href),
      ["/en", "/en/products", "/en/products/iccsyn-6", "/en/products/white-oil-15", "/en/about-us", "/en/our-team"],
    );
    assert.ok(urls.every((u) => u.languages === null));
    assert.ok(!JSON.stringify(urls).includes("/nl"));
  });

  it("the language list unreadable: the default language only (fail closed)", () => {
    const urls = sitemapUrls(api, null);
    assert.ok(urls.every((u) => u.locale === "en" && u.languages === null));
  });

  it("NL public: Dutch pages listed with reciprocal alternates; unlisted counterparts dropped", () => {
    const urls = sitemapUrls(api, ["en", "nl"]);
    const by = Object.fromEntries(urls.map((u) => [u.href, u.languages]));
    assert.deepEqual(Object.keys(by), [
      "/en",
      "/en/products",
      "/en/products/iccsyn-6",
      "/en/products/white-oil-15",
      "/en/about-us",
      "/en/our-team",
      "/nl",
      "/nl/over-ons",
      "/nl/products",
      "/nl/products/iccsyn-6",
    ]);
    const pair = { en: "/en/about-us", nl: "/nl/over-ons", "x-default": "/en/about-us" };
    assert.deepEqual(by["/en/about-us"], pair);
    assert.deepEqual(by["/nl/over-ons"], pair);
    assert.deepEqual(by["/en"], { en: "/en", nl: "/nl", "x-default": "/en" });
    // /ons-team is not in the sitemap (e.g. noindex): no hreflang towards it.
    assert.equal(by["/en/our-team"], null);
    // ML-8c: the lists and a product published in both languages are reciprocal pairs; a product
    // without a Dutch publication names no counterpart.
    const list = { en: "/en/products", nl: "/nl/products", "x-default": "/en/products" };
    assert.deepEqual(by["/en/products"], list);
    assert.deepEqual(by["/nl/products"], list);
    const product = {
      en: "/en/products/iccsyn-6",
      nl: "/nl/products/iccsyn-6",
      "x-default": "/en/products/iccsyn-6",
    };
    assert.deepEqual(by["/en/products/iccsyn-6"], product);
    assert.deepEqual(by["/nl/products/iccsyn-6"], product);
    assert.equal(by["/en/products/white-oil-15"], null);
    // Every hreflang target is itself a sitemap URL (reciprocity).
    for (const langs of Object.values(by)) {
      for (const [l, href] of Object.entries(langs ?? {})) {
        if (l !== "x-default") assert.ok(href in by, href);
      }
    }
  });

  it("keeps the API's last modification dates and lists each address once", () => {
    const urls = sitemapUrls([...api, entry({ path: "/about-us", locale: "en" })], ["en"]);
    assert.equal(urls.filter((u) => u.href === "/en/about-us").length, 1);
    assert.equal(urls[0]?.lastModified, "2026-11-20T10:00:00.000Z");
  });
});
