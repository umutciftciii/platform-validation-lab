// COM-1: hreflang and sitemap addresses of the corporate site — only published, indexable
// counterparts in public languages, reciprocal, x-default in English; no catalogue entries.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicSitemapEntry } from "@dream/contracts";

import { hreflangMap } from "./hreflang.ts";
import { sitemapUrls } from "./sitemap-entries.ts";

const entry = (
  locale: string,
  path: string,
  kind: PublicSitemapEntry["kind"] = "page",
  alternates: { locale: string; path: string }[] = [],
): PublicSitemapEntry => ({
  locale,
  path,
  kind,
  lastModified: "2026-11-27T10:00:00.000Z",
  alternates,
});

describe("hreflangMap", () => {
  it("names indexable counterparts with x-default in English", () => {
    assert.deepEqual(
      hreflangMap("tr", "/hakkimizda", [{ locale: "en", path: "/about-us", indexable: true }]),
      {
        en: "/en/about-us",
        tr: "/tr/hakkimizda",
        "x-default": "/en/about-us",
      },
    );
  });

  it("names nothing without an indexable counterpart or for unknown languages", () => {
    assert.equal(hreflangMap("en", "/about-us", []), null);
    assert.equal(hreflangMap("en", "/about-us", [{ locale: "tr", path: "/hakkimizda" }]), null);
    assert.equal(
      hreflangMap("en", "/about-us", [{ locale: "nl", path: "/over-ons", indexable: true }]),
      null,
    );
  });
});

describe("sitemapUrls", () => {
  it("lists public languages only, each at its prefixed address, alternates reciprocal", () => {
    const entries = [
      entry("en", "/about-us", "page", [{ locale: "tr", path: "/hakkimizda" }]),
      entry("tr", "/hakkimizda", "page", [{ locale: "en", path: "/about-us" }]),
      entry("en", "/sustainability"),
    ];
    const closed = sitemapUrls(entries, ["en"]);
    assert.deepEqual(
      closed.map((u) => [u.href, u.languages]),
      [
        ["/en/about-us", null],
        ["/en/sustainability", null],
      ],
    );
    const open = sitemapUrls(entries, ["en", "tr"]);
    assert.deepEqual(open[0]?.languages, {
      en: "/en/about-us",
      tr: "/tr/hakkimizda",
      "x-default": "/en/about-us",
    });
    assert.deepEqual(open[1]?.languages, open[0]?.languages);
  });

  it("fails closed to English while the language list cannot be read", () => {
    const urls = sitemapUrls([entry("tr", "/hakkimizda"), entry("en", "/about-us")], null);
    assert.deepEqual(
      urls.map((u) => u.href),
      ["/en/about-us"],
    );
  });

  it("never lists catalogue routes (the corporate site has none)", () => {
    const urls = sitemapUrls(
      [entry("en", "/products", "products"), entry("en", "/products/x", "product")],
      ["en"],
    );
    assert.deepEqual(urls, []);
  });

  it("lists the news list and its articles with their counterparts (COM-3)", () => {
    const urls = sitemapUrls(
      [
        entry("en", "/news", "news", [{ locale: "tr", path: "/news" }]),
        entry("tr", "/news", "news", [{ locale: "en", path: "/news" }]),
        entry("en", "/news/market-note", "article", [{ locale: "tr", path: "/news/piyasa-notu" }]),
        entry("tr", "/news/piyasa-notu", "article", [{ locale: "en", path: "/news/market-note" }]),
        entry("en", "/news/english-only", "article"),
      ],
      ["en", "tr"],
    );
    assert.deepEqual(
      urls.map((u) => u.href),
      [
        "/en/news",
        "/tr/news",
        "/en/news/market-note",
        "/tr/news/piyasa-notu",
        "/en/news/english-only",
      ],
    );
    assert.deepEqual(urls[2]?.languages, {
      en: "/en/news/market-note",
      tr: "/tr/news/piyasa-notu",
      "x-default": "/en/news/market-note",
    });
    assert.equal(urls[4]?.languages, null);
  });
});
