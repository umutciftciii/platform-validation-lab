// COM-1: the language prefix of dreampetroleum.com (Turkish and English), the stored/public
// address translation and the language selector.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_LOCALE,
  ROUTE_LOCALES,
  languageOptions,
  localePath,
  localizeHref,
  localizeLinks,
  publicRedirectTarget,
  splitLocale,
  storedAddress,
} from "./locale-routing.ts";

describe("corporate locales", () => {
  it("has routes for English and Turkish, English the default (contract 3.2 b, owner K3)", () => {
    assert.deepEqual([...ROUTE_LOCALES], ["en", "tr"]);
    assert.equal(DEFAULT_LOCALE, "en");
  });

  it("splits and builds public addresses", () => {
    assert.deepEqual(splitLocale("/tr/hakkimizda"), { locale: "tr", rest: "/hakkimizda" });
    assert.deepEqual(splitLocale("/en"), { locale: "en", rest: "/" });
    assert.equal(splitLocale("/nl/over-ons"), null);
    assert.equal(splitLocale("/english"), null);
    assert.equal(localePath("tr", "/"), "/tr");
    assert.equal(localePath("en", "/about-us"), "/en/about-us");
  });

  it("prefixes only addresses of the site's pages", () => {
    assert.equal(localizeHref("tr", "/hakkimizda?x=1#a"), "/tr/hakkimizda?x=1#a");
    assert.equal(localizeHref("en", "/"), "/en");
    for (const href of [
      "https://example.com/x",
      "mailto:info@dreampetroleum.com",
      "tel:+902122181357",
      "#top",
      "/api/health",
      "/media/x.webp",
      "/sitemap.xml",
      "/tr/already",
      "//evil.example",
    ]) {
      assert.equal(localizeHref("tr", href), href, href);
    }
  });

  it("translates stored addresses (no prefix in the default language)", () => {
    assert.equal(storedAddress("en", "/about-us"), "/about-us");
    assert.equal(storedAddress("tr", "/hakkimizda"), "/tr/hakkimizda");
    assert.equal(publicRedirectTarget("/about-us"), "/en/about-us");
    assert.equal(publicRedirectTarget("/tr/hakkimizda"), "/tr/hakkimizda");
    assert.equal(
      publicRedirectTarget("https://dreampetroleumbv.com/en"),
      "https://dreampetroleumbv.com/en",
    );
  });

  it("localizes every href of a view and nothing else", () => {
    const view = { label: "/about-us", href: "/about-us", items: [{ ctaHref: "/x", text: "/y" }] };
    assert.deepEqual(localizeLinks(view, "tr"), {
      label: "/about-us",
      href: "/tr/about-us",
      items: [{ ctaHref: "/tr/x", text: "/y" }],
    });
  });

  it("lists both languages; one that is not public has no link", () => {
    const options = languageOptions("en", ["en"], { en: "/en/about-us" });
    assert.deepEqual(options, [
      { locale: "en", label: "English", href: "/en/about-us", current: true, available: true },
      { locale: "tr", label: "Türkçe", href: null, current: false, available: false },
    ]);
    const open = languageOptions("en", ["en", "tr"], { en: "/en/about-us", tr: "/tr/hakkimizda" });
    assert.equal(open[1]?.href, "/tr/hakkimizda");
    // Without a counterpart the other language's home, never a guessed address.
    assert.equal(languageOptions("en", ["en", "tr"])[1]?.href, "/tr");
  });
});
