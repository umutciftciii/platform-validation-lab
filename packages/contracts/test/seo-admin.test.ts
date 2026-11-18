// DP-209: admin-managed SEO contracts — the canonical path rule (same-site paths only), length
// warnings (advice, never errors), the page SEO request, the product listing SEO request, the
// snapshot/public product SEO (the OG image is always one of the published images) and the
// bv.site-seo fragment.
import { describe, expect, it } from "vitest";
import {
  BV_SITE_SEO_FIELDS,
  BV_SITE_SEO_KEY,
  CMS_DESIGN_TEMPLATES,
  CMS_SITE_REGISTRY,
  CmsPublicPageSchema,
  CmsSeoSchema,
  EMPTY_PRODUCT_SEO,
  ListingSeoUpdateRequestSchema,
  ListingSchema,
  PublicSiteSeoSettingsSchema,
  PublishedSnapshotSchema,
  SeoCanonicalPathSchema,
  cmsFieldsSchema,
  seoCanonicalPathIsValid,
  seoIsSelfCanonical,
  seoLengthWarning,
  toPublicProduct,
} from "../src/index.js";

const IMG = "0190a8c4-7c1e-7000-8000-0000000000a1";
const OTHER = "0190a8c4-7c1e-7000-8000-0000000000a2";

describe("DP-209 canonical path", () => {
  it("accepts same-site paths of up to three segments; empty means none", () => {
    for (const p of ["/", "/about-us", "/products/base-oil-sn-150", "/news/a-b/c"]) {
      expect(SeoCanonicalPathSchema.parse(p), p).toBe(p);
      expect(seoCanonicalPathIsValid(p)).toBe(true);
    }
    expect(SeoCanonicalPathSchema.parse("")).toBeNull();
    expect(SeoCanonicalPathSchema.parse("  ")).toBeNull();
    expect(SeoCanonicalPathSchema.parse(null)).toBeNull();
    expect(SeoCanonicalPathSchema.parse(" /about-us ")).toBe("/about-us");
  });

  it("refuses URLs, other hosts, schemes, queries, fragments and app internals", () => {
    for (const p of [
      "https://dreampetroleumbv.com/about-us",
      "http://evil.example",
      "//evil.example/x",
      "javascript:alert(1)",
      "about-us",
      "/About-Us",
      "/about_us",
      "/about-us/",
      "/a//b",
      "/a/b/c/d",
      "/x?category=y",
      "/x#top",
      "/../x",
      "/api/v1/public",
      "/preview/token",
      "/lead-form",
      "/product-documents/x",
      "/product-images/x",
      `/${"a".repeat(201)}`,
    ]) {
      expect(SeoCanonicalPathSchema.safeParse(p).success, p).toBe(false);
      expect(seoCanonicalPathIsValid(p), p).toBe(false);
    }
    expect(seoCanonicalPathIsValid(null)).toBe(false);
  });

  it("a page is its own canonical without an override or with its own path", () => {
    expect(seoIsSelfCanonical("/a", null)).toBe(true);
    expect(seoIsSelfCanonical("/a", "/a")).toBe(true);
    expect(seoIsSelfCanonical("/a", "/b")).toBe(false);
  });
});

describe("DP-209 length warnings (advice, not limits)", () => {
  it("warns above the shown length, and for a very short description; never for empty", () => {
    expect(seoLengthWarning("title", "")).toBeNull();
    expect(seoLengthWarning("title", "x".repeat(60))).toBeNull();
    expect(seoLengthWarning("title", "x".repeat(61))).toMatch(/^61 characters: about 60/);
    expect(seoLengthWarning("description", "x".repeat(20))).toMatch(/50–160/);
    expect(seoLengthWarning("description", "x".repeat(120))).toBeNull();
    expect(seoLengthWarning("description", "x".repeat(161))).toMatch(/about 160/);
    expect(seoLengthWarning("ogTitle", "x".repeat(71))).toMatch(/about 70/);
    expect(seoLengthWarning("ogDescription", "x".repeat(201))).toMatch(/about 200/);
  });
});

describe("DP-209 page SEO request", () => {
  const base = { title: null, description: null, noindex: false };

  it("keeps DP-207 requests valid: the new fields default to null", () => {
    expect(CmsSeoSchema.parse(base)).toEqual({
      ...base,
      canonicalPath: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
    });
  });

  it("accepts a canonical path, Open Graph texts and a registered image; blanks are null", () => {
    expect(
      CmsSeoSchema.parse({
        ...base,
        canonicalPath: "/about-us",
        ogTitle: "  Share  ",
        ogDescription: "",
        ogImage: "/media/ctl-technology/clear-base-oil.webp",
      }),
    ).toMatchObject({
      canonicalPath: "/about-us",
      ogTitle: "Share",
      ogDescription: null,
      ogImage: "/media/ctl-technology/clear-base-oil.webp",
    });
  });

  it("refuses an unregistered or non-image asset, an unsafe canonical and overlong texts", () => {
    for (const bad of [
      { ogImage: "https://evil.example/a.png" },
      { ogImage: "/media/unknown.webp" },
      { ogImage: "/media/iccsyn-groups/temp/group-1-loop.gif" }, // an animation
      { canonicalPath: "https://evil.example" },
      { ogTitle: "x".repeat(121) },
      { ogDescription: "x".repeat(321) },
      { ogTitle: `a${String.fromCharCode(7)}b` },
    ]) {
      expect(CmsSeoSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("reads public pages of an API without the DP-209 fields (rolling update)", () => {
    const page = CmsPublicPageSchema.parse({
      kind: "TEMPLATE",
      templateKey: "standard",
      path: "/a",
      title: "A",
      seo: base,
      content: {},
      revisionNumber: 1,
      publishedAt: "2026-11-18T10:00:00.000Z",
      firstPublishedAt: "2026-11-18T10:00:00.000Z",
    });
    expect(page.seo).toMatchObject({ canonicalPath: null, ogImage: null });
  });
});

describe("DP-209 product SEO", () => {
  it("validates the listing SEO request like the page SEO", () => {
    const ok = ListingSeoUpdateRequestSchema.parse({
      version: 3,
      title: " T ",
      noindex: true,
      canonicalPath: "",
      ogImageId: IMG,
    });
    expect(ok).toMatchObject({ title: "T", canonicalPath: null, noindex: true, ogImageId: IMG });
    expect(
      ListingSeoUpdateRequestSchema.safeParse({ version: 3, noindex: false, extra: 1 }).success,
    ).toBe(false);
    expect(
      ListingSeoUpdateRequestSchema.safeParse({ version: 3, noindex: false, canonicalPath: "//x" })
        .success,
    ).toBe(false);
    expect(ListingSeoUpdateRequestSchema.safeParse({ noindex: false }).success).toBe(false);
  });

  const snapshot = (seo?: unknown) =>
    PublishedSnapshotSchema.parse({
      schemaVersion: 1,
      slug: "x",
      code: "X",
      name: "X",
      summary: null,
      description: null,
      category: { slug: "c", name: "C" },
      sortOrder: 0,
      specs: [],
      images: [{ id: IMG, altText: "a", isCover: true, width: 10, height: 10 }],
      ...(seo ? { seo } : {}),
    });

  it("keeps older snapshots readable and answers empty SEO for them", () => {
    expect(toPublicProduct(snapshot(), "2026-11-18T10:00:00.000Z").seo).toEqual(EMPTY_PRODUCT_SEO);
  });

  it("serves only an OG image that the snapshot publishes", () => {
    const seo = { ...EMPTY_PRODUCT_SEO, title: "T", ogImageId: IMG };
    expect(toPublicProduct(snapshot(seo), "2026-11-18T10:00:00.000Z").seo.ogImageId).toBe(IMG);
    const gone = { ...seo, ogImageId: OTHER };
    expect(toPublicProduct(snapshot(gone), "2026-11-18T10:00:00.000Z").seo).toMatchObject({
      title: "T",
      ogImageId: null,
    });
  });

  it("defaults the admin listing SEO when an older API leaves it out", () => {
    const l = ListingSchema.parse({
      id: IMG,
      siteId: OTHER,
      categoryId: OTHER,
      visibility: "VISIBLE",
      sortOrder: 0,
      version: 1,
      text: null,
      updatedAt: "2026-11-18T10:00:00.000Z",
    });
    expect(l.seo).toEqual(EMPTY_PRODUCT_SEO);
  });
});

describe("DP-209 site SEO defaults (bv.site-seo)", () => {
  it("is a BV fragment of the registry and of the designed templates", () => {
    expect(CMS_SITE_REGISTRY.find((e) => e.key === BV_SITE_SEO_KEY)).toMatchObject({
      site: "BV",
      kind: "FRAGMENT",
      path: null,
      importable: true,
    });
    expect(CMS_DESIGN_TEMPLATES.find((t) => t.key === BV_SITE_SEO_KEY)?.kind).toBe("FRAGMENT");
  });

  it("requires every default, an image asset, and matches the public settings shape", () => {
    const schema = cmsFieldsSchema(BV_SITE_SEO_FIELDS);
    const ok = {
      siteName: "Dream Petroleum BV",
      defaultTitle: "Dream Petroleum BV",
      defaultDescription: "Base oils.",
      defaultOgImage: "/media/ctl-technology/clear-base-oil.webp",
    };
    expect(PublicSiteSeoSettingsSchema.parse(schema.parse(ok))).toEqual(ok);
    for (const k of Object.keys(ok)) {
      expect(schema.safeParse({ ...ok, [k]: "" }).success, k).toBe(false);
    }
    expect(schema.safeParse({ ...ok, defaultOgImage: "https://evil.example/x.png" }).success).toBe(
      false,
    );
  });
});
