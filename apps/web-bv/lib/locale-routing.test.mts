// ML-3 (DP-236): public addresses per language, link prefixes and the language switcher.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_LOCALE,
  isRouteLocale,
  carriedQuery,
  languageOptions,
  localePath,
  localizeHref,
  localizeLinks,
  ogLocale,
  publicRedirectTarget,
  splitLocale,
  storedAddress,
} from "./locale-routing.ts";

describe("locales", () => {
  it("knows exactly en and nl, English being the default", () => {
    assert.equal(DEFAULT_LOCALE, "en");
    for (const ok of ["en", "nl"]) assert.ok(isRouteLocale(ok), ok);
    for (const bad of ["tr", "EN", "Nl", "", "en-GB", null, 1]) assert.ok(!isRouteLocale(bad), String(bad));
    assert.equal(ogLocale("en"), "en_GB");
    assert.equal(ogLocale("nl"), "nl_NL");
  });

  it("splits a public address into language and inner path", () => {
    assert.deepEqual(splitLocale("/en"), { locale: "en", rest: "/" });
    assert.deepEqual(splitLocale("/nl/over-ons"), { locale: "nl", rest: "/over-ons" });
    assert.deepEqual(splitLocale("/en/products/x"), { locale: "en", rest: "/products/x" });
    assert.equal(splitLocale("/about-us"), null);
    assert.equal(splitLocale("/english"), null);
    assert.equal(splitLocale("/tr/x"), null);
  });

  it("builds public and stored addresses", () => {
    assert.equal(localePath("en", "/"), "/en");
    assert.equal(localePath("nl", "/"), "/nl");
    assert.equal(localePath("en", "/about-us"), "/en/about-us");
    assert.equal(localePath("nl", "/news/x"), "/nl/news/x");
    assert.throws(() => localePath("en", "about-us"));
    // ML-2 storage: the default language unprefixed, others under their prefix.
    assert.equal(storedAddress("en", "/about-us"), "/about-us");
    assert.equal(storedAddress("en", "/"), "/");
    assert.equal(storedAddress("nl", "/over-ons"), "/nl/over-ons");
    assert.equal(storedAddress("nl", "/"), "/nl");
  });
});

describe("localizeHref", () => {
  it("prefixes the site's page addresses", () => {
    const cases: [string, string][] = [
      ["/", "/en"],
      ["/about-us", "/en/about-us"],
      ["/products", "/en/products"],
      ["/products?category=base-oil", "/en/products?category=base-oil"],
      ["/products/x", "/en/products/x"],
      ["/news/a", "/en/news/a"],
      ["/privacy", "/en/privacy"],
      ["/#top", "/en#top"],
      ["/?q=1", "/en?q=1"],
      ["/contact#form", "/en/contact#form"],
    ];
    for (const [href, out] of cases) assert.equal(localizeHref("en", href), out, href);
    assert.equal(localizeHref("nl", "/products"), "/nl/products");
  });

  it("leaves external, anchors, technical endpoints, files and prefixed links alone", () => {
    for (const href of [
      "https://example.com/x",
      "//evil.example/x",
      "mailto:info@example.com",
      "tel:+31",
      "#top",
      "/media/brand/logo.svg",
      "/product-documents/abc",
      "/product-images/abc/display",
      "/lead-form/contact",
      "/preview/abc",
      "/api/health",
      "/_next/static/x.js",
      "/favicon.ico",
      "/robots.txt",
      "/sitemap.xml",
      "/en/about-us",
      "/nl/over-ons",
      "/nl",
    ]) {
      assert.equal(localizeHref("en", href), href, href);
    }
  });

  it("localizes every *href field of a view, nothing else", () => {
    const view = {
      title: "/about-us",
      path: "/about-us",
      homeHref: "/",
      items: [{ label: "About", href: "/about-us" }, { label: "Ext", href: "https://x.test" }],
      hero: { ctaHref: "/products", image: "/media/a.webp" },
      cta: { href: null },
    };
    const out = localizeLinks(view, "en");
    assert.deepEqual(out, {
      title: "/about-us",
      path: "/about-us",
      homeHref: "/en",
      items: [{ label: "About", href: "/en/about-us" }, { label: "Ext", href: "https://x.test" }],
      hero: { ctaHref: "/en/products", image: "/media/a.webp" },
      cta: { href: null },
    });
    // The input is not changed.
    assert.equal(view.items[0]?.href, "/about-us");
  });
});

describe("publicRedirectTarget", () => {
  it("gives a stored target its public address (one hop)", () => {
    assert.equal(publicRedirectTarget("/about-us"), "/en/about-us");
    assert.equal(publicRedirectTarget("/"), "/en");
    assert.equal(publicRedirectTarget("/products?category=x"), "/en/products?category=x");
    assert.equal(publicRedirectTarget("/nl/over-ons"), "/nl/over-ons");
    assert.equal(publicRedirectTarget("/en/news"), "/en/news");
  });

  it("keeps absolute URLs and technical endpoints", () => {
    assert.equal(publicRedirectTarget("https://example.com/a"), "https://example.com/a");
    assert.equal(publicRedirectTarget("/product-documents/x"), "/product-documents/x");
    assert.equal(publicRedirectTarget("/media/x.pdf"), "/media/x.pdf");
  });
});

describe("languageOptions (ML-7)", () => {
  it("always lists English and Dutch; a language that is not public has no link", () => {
    assert.deepEqual(languageOptions("en", ["en"]), [
      { locale: "en", label: "English", href: "/en", current: true, available: true },
      { locale: "nl", label: "Nederlands", href: null, current: false, available: false },
    ]);
    // A counterpart of a hidden language is never offered.
    assert.equal(languageOptions("en", ["en"], { nl: "/nl/over-ons" })[1]?.href, null);
  });

  it("never lists a language the site has no routes for", () => {
    assert.deepEqual(
      languageOptions("en", ["en", "nl", "tr"]).map((o) => o.locale),
      ["en", "nl"],
    );
  });

  it("goes to the counterpart when one is published, else to the language's home", () => {
    const withCounterpart = languageOptions("en", ["en", "nl"], {
      en: "/en/about-us",
      nl: "/nl/over-ons",
    });
    assert.deepEqual(withCounterpart, [
      { locale: "en", label: "English", href: "/en/about-us", current: true, available: true },
      { locale: "nl", label: "Nederlands", href: "/nl/over-ons", current: false, available: true },
    ]);
    const without = languageOptions("en", ["en", "nl"], { en: "/en/about-us" });
    assert.equal(without[1]?.href, "/nl");
  });

  it("marks the current language also when it is not public (a Dutch 404 while NL is closed)", () => {
    const opts = languageOptions("nl", ["en"]);
    assert.deepEqual(
      opts.map((o) => [o.locale, o.current, o.available, o.href]),
      [
        ["en", false, true, "/en"],
        ["nl", true, false, null],
      ],
    );
  });
});

describe("carriedQuery (ML-7)", () => {
  it("keeps the catalogue filter on the same catalogue list in another language", () => {
    assert.equal(carriedQuery("/en/products", "/nl/products", "?category=base-oils"), "?category=base-oils");
  });

  it("drops the query everywhere else", () => {
    assert.equal(carriedQuery("/en/about-us", "/nl/over-ons", "?x=1"), "");
    assert.equal(carriedQuery("/en/contact", "/nl/contact", "?x=1"), "");
    assert.equal(carriedQuery("/en/products", "/nl", "?category=x"), "");
    assert.equal(carriedQuery("/en/products/x", "/nl/products/x", "?a=1"), "");
    assert.equal(carriedQuery("/en/products", "/nl/products", ""), "");
    assert.equal(carriedQuery("/en/products", "/nl/products", "?"), "");
  });
});
