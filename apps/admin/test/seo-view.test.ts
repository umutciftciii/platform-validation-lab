// DP-209: the admin's SEO previews compute what the BV site renders (lib/seo-view.ts) and the
// overview's notes and filters (lib/seo-overview.ts). Warnings only; nothing is refused here.
import type { SeoOverviewItem } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { createTranslator } from "../lib/i18n/translate";
import {
  filterSeoItems,
  needsAttention,
  parseSeoFilter,
  seoEditHref,
  seoNotes,
  seoPublicPath,
} from "../lib/seo-overview";
import {
  CODE_SITE_SEO,
  displayUrl,
  previewImageSrc,
  seoView,
  type SeoDraft,
} from "../lib/seo-view";

const EN = createTranslator("en");
const ORIGIN = "https://dreampetroleumbv.com";
const draft = (d: Partial<SeoDraft> = {}): SeoDraft => ({
  path: "/about-us",
  fallbackTitle: "About Us",
  title: "",
  description: "",
  canonicalPath: "",
  noindex: false,
  ogTitle: "",
  ogDescription: "",
  ogImageUrl: null,
  ...d,
});

describe("DP-209 SEO preview values", () => {
  it("falls back like the site: page title, page summary, site default, site image", () => {
    const site = { ...CODE_SITE_SEO, defaultDescription: "Site default description." };
    const v = seoView(draft(), site, ORIGIN);
    expect(v).toMatchObject({
      title: "About Us",
      description: "Site default description.",
      ogTitle: "About Us",
      ogDescription: "Site default description.",
      ogImageUrl: CODE_SITE_SEO.defaultOgImage,
      sources: { title: "fallback", description: "site" },
    });
    // ML-5: the public address in its language, as the site renders it (`/en/...`).
    expect(v.canonical).toEqual({
      url: "https://dreampetroleumbv.com/en/about-us",
      path: "/en/about-us",
      override: false,
      invalid: false,
    });
    const own = seoView(
      draft({
        title: "Own title",
        fallbackDescription: "Summary",
        ogImageUrl: null,
        pageImageUrl: "/media/news/why-are-oil-prices-falling.jpg",
      }),
      site,
      ORIGIN,
    );
    expect(own).toMatchObject({
      title: "Own title",
      description: "Summary",
      ogImageUrl: "/media/news/why-are-oil-prices-falling.jpg",
      sources: { title: "own", description: "fallback" },
    });
  });

  it("uses a valid canonical override and ignores an invalid one (flagged)", () => {
    expect(seoView(draft({ canonicalPath: "/our-team" }), CODE_SITE_SEO, ORIGIN).canonical).toEqual(
      {
        url: "https://dreampetroleumbv.com/en/our-team",
        path: "/en/our-team",
        override: true,
        invalid: false,
      },
    );
    expect(
      seoView(draft({ canonicalPath: "https://evil.example" }), CODE_SITE_SEO, ORIGIN).canonical,
    ).toMatchObject({ path: "/en/about-us", override: false, invalid: true });
    expect(seoView(draft(), CODE_SITE_SEO, null).canonical.url).toBeNull();
  });

  it("ML-5: shows the address in the page's language; Corporate keeps unprefixed paths", () => {
    expect(seoView(draft({ path: "/" }), CODE_SITE_SEO, ORIGIN).canonical.url).toBe(
      "https://dreampetroleumbv.com/en",
    );
    expect(
      seoView(draft({ path: "/over-ons", locale: "nl" }), CODE_SITE_SEO, ORIGIN).canonical,
    ).toEqual({
      url: "https://dreampetroleumbv.com/nl/over-ons",
      path: "/nl/over-ons",
      override: false,
      invalid: false,
    });
    // A canonical override stays in the page's language.
    expect(
      seoView(draft({ locale: "nl", canonicalPath: "/ons-team" }), CODE_SITE_SEO, ORIGIN).canonical
        .url,
    ).toBe("https://dreampetroleumbv.com/nl/ons-team");
    expect(seoView(draft({ locale: null }), CODE_SITE_SEO, ORIGIN).canonical.url).toBe(
      "https://dreampetroleumbv.com/about-us",
    );
  });

  it("lists length warnings without refusing anything", () => {
    const v = seoView(
      draft({ title: "x".repeat(70), description: "short" }),
      CODE_SITE_SEO,
      ORIGIN,
    );
    expect(v.warnings.map((w) => w.field)).toEqual(["title", "description"]);
  });

  it("builds the preview URL pieces and image sources", () => {
    expect(displayUrl("https://dreampetroleumbv.com/products/x", "/products/x")).toEqual({
      host: "dreampetroleumbv.com",
      origin: "https://dreampetroleumbv.com",
      crumbs: "products › x",
    });
    // DP-210: the local origin keeps its scheme and port (DP-209 printed https://localhost:3110).
    expect(displayUrl("http://localhost:3110/about-us", "/about-us")).toEqual({
      host: "localhost:3110",
      origin: "http://localhost:3110",
      crumbs: "about-us",
    });
    // No public address configured: the production host as an example.
    expect(displayUrl(null, "/")).toEqual({
      host: "dreampetroleumbv.com",
      origin: "https://dreampetroleumbv.com",
      crumbs: "",
    });
    expect(previewImageSrc("/media/a.webp", "http://localhost:3110")).toBe(
      "http://localhost:3110/media/a.webp",
    );
    expect(previewImageSrc("/media/a.webp", null)).toBeNull();
  });
});

const item = (i: Partial<SeoOverviewItem>): SeoOverviewItem => ({
  id: "0190a8c4-7c1e-7000-8000-0000000000a1",
  source: "cms",
  kind: "page",
  name: "Page",
  path: "/page",
  title: "Title",
  description: "A description that is long enough to be a fine meta description for tests.",
  ogTitle: null,
  ogDescription: null,
  hasOgImage: false,
  canonicalPath: null,
  noindex: false,
  live: true,
  pendingChanges: false,
  inSitemap: true,
  ...i,
});

describe("DP-209 SEO overview", () => {
  it("notes missing descriptions, long texts and canonicals", () => {
    expect(seoNotes(item({}), EN)).toEqual([]);
    expect(seoNotes(item({ description: null }), EN)).toEqual([
      "No meta description (fallback used)",
    ]);
    expect(seoNotes(item({ title: "x".repeat(61) }), EN)).toEqual(["Title may be cut off"]);
    expect(seoNotes(item({ canonicalPath: "/other" }), EN)).toEqual(["Canonical → /en/other"]);
    expect(seoPublicPath("/")).toBe("/en");
    expect(seoPublicPath("/products/x")).toBe("/en/products/x");
    expect(needsAttention(item({ canonicalPath: "/other" }))).toBe(false);
    expect(needsAttention(item({ description: null }))).toBe(true);
  });

  it("filters and links each row to its existing editor", () => {
    const rows = [
      item({ noindex: true }),
      item({ source: "product", kind: "product", pendingChanges: true }),
      item({ live: false, description: null }),
    ];
    expect(filterSeoItems(rows, "noindex")).toHaveLength(1);
    expect(filterSeoItems(rows, "products")).toHaveLength(1);
    expect(filterSeoItems(rows, "pending")).toHaveLength(2);
    expect(filterSeoItems(rows, "attention")).toHaveLength(1);
    expect(filterSeoItems(rows, "all")).toHaveLength(3);
    expect(parseSeoFilter("nope")).toBe("all");
    expect(parseSeoFilter(["noindex"])).toBe("noindex");
    expect(seoEditHref(rows[0]!, "bv")).toBe(`/content/${rows[0]!.id}#seo`);
    expect(seoEditHref(rows[1]!, "bv")).toBe(`/products/${rows[1]!.id}?site=bv&tab=seo`);
  });
});
