import { describe, expect, it } from "vitest";
import {
  BV_LOCAL_ORIGIN,
  PublicSeoResolveResponseSchema,
  PublicSitemapResponseSchema,
  REDIRECT_SITE_KEYS,
  SEO_RESOLVABLE_PATH,
  canonicalUrl,
  jsonLdText,
  organizationJsonLd,
  productJsonLd,
  seoDeployEnv,
  seoPolicy,
  seoPublicOrigin,
  seoRedirectLocation,
  seoRedirectTargetIsSitePath,
} from "../src/index.js";

describe("DP-207 indexing policy", () => {
  it("reads the deploy environment like the API: unknown counts as production", () => {
    expect(seoDeployEnv(undefined)).toBe("local");
    expect(seoDeployEnv(" ")).toBe("local");
    expect(seoDeployEnv("staging")).toBe("staging");
    expect(seoDeployEnv("production")).toBe("production");
    expect(seoDeployEnv("prod")).toBe("production");
  });

  it("is indexable only in production, with the switch on and an https origin", () => {
    const origin = "https://dreampetroleumbv.com";
    expect(seoPolicy({ deployEnv: "production", origin, indexing: "on" })).toEqual({
      deployEnv: "production",
      origin,
      indexable: true,
    });
    for (const env of [
      { deployEnv: undefined, origin, indexing: "on" }, // local / DEV
      { deployEnv: "local", origin: undefined, indexing: "on" },
      { deployEnv: "staging", origin, indexing: "on" },
      { deployEnv: "production", origin, indexing: undefined },
      { deployEnv: "production", origin, indexing: "yes" },
      { deployEnv: "production", origin, indexing: "ON" },
      { deployEnv: "production", origin: undefined, indexing: "on" },
      { deployEnv: "production", origin: "http://dreampetroleumbv.com", indexing: "on" },
    ]) {
      expect(seoPolicy(env).indexable, JSON.stringify(env)).toBe(false);
    }
  });

  it("accepts a bare origin only; http and the local default only locally", () => {
    expect(seoPublicOrigin(undefined, "local")).toBe(BV_LOCAL_ORIGIN);
    expect(seoPublicOrigin("http://localhost:3208", "local")).toBe("http://localhost:3208");
    expect(seoPublicOrigin(undefined, "production")).toBeNull();
    expect(seoPublicOrigin("https://dreampetroleumbv.com/", "production")).toBe(
      "https://dreampetroleumbv.com",
    );
    for (const bad of [
      "http://dreampetroleumbv.com",
      "https://dreampetroleumbv.com/en",
      "https://dreampetroleumbv.com?x=1",
      "https://user:pw@dreampetroleumbv.com",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(seoPublicOrigin(bad, "production"), bad).toBeNull();
    }
  });

  it("builds canonical URLs without query or fragment", () => {
    const o = "https://dreampetroleumbv.com";
    expect(canonicalUrl(o, "/")).toBe("https://dreampetroleumbv.com/");
    expect(canonicalUrl(o, "/products/x?utm=1#documents")).toBe(
      "https://dreampetroleumbv.com/products/x",
    );
    expect(canonicalUrl(o, "about-us")).toBe("https://dreampetroleumbv.com/about-us");
  });
});

describe("DP-207 resolvable addresses and sitemap contract", () => {
  it("accepts the content addresses the site serves, nothing else", () => {
    for (const ok of ["/", "/about-us", "/news/x-1", "/products/base-oil-2-150n"]) {
      expect(SEO_RESOLVABLE_PATH.test(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "about",
      "/About",
      "/a/b",
      "/news/a/b",
      "/x/",
      "/-x",
      "/a--b",
      "/products/",
    ]) {
      expect(SEO_RESOLVABLE_PATH.test(bad), bad).toBe(false);
    }
  });

  it("parses a sitemap and refuses relative or unknown entries", () => {
    expect(
      PublicSitemapResponseSchema.safeParse({
        entries: [{ path: "/", kind: "home", lastModified: "2026-11-18T10:00:00.000Z" }],
      }).success,
    ).toBe(true);
    expect(
      PublicSitemapResponseSchema.safeParse({
        entries: [{ path: "x", kind: "home", lastModified: null }],
      }).success,
    ).toBe(false);
    expect(
      PublicSitemapResponseSchema.safeParse({
        entries: [{ path: "/x", kind: "draft", lastModified: null }],
      }).success,
    ).toBe(false);
  });
});

describe("DP-207 structured data", () => {
  const origin = "https://dreampetroleumbv.com";

  it("describes the organisation with absolute URLs", () => {
    expect(
      organizationJsonLd({ name: "Dream Petroleum B.V.", origin, logoPath: "/media/logo.svg" }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Dream Petroleum B.V.",
      url: "https://dreampetroleumbv.com/",
      logo: "https://dreampetroleumbv.com/media/logo.svg",
    });
  });

  it("describes a product from its snapshot, without invented offers, ratings or brand", () => {
    const ld = productJsonLd({
      origin,
      path: "/products/base-oil-2-150n",
      name: "Group II Base Oil 150N",
      code: "G2-150N",
      description: null,
      category: "Group II",
      imagePaths: ["/product-images/abc/display"],
    });
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Group II Base Oil 150N",
      sku: "G2-150N",
      url: "https://dreampetroleumbv.com/products/base-oil-2-150n",
      category: "Group II",
      image: ["https://dreampetroleumbv.com/product-images/abc/display"],
    });
    for (const k of ["offers", "aggregateRating", "review", "brand"])
      expect(ld).not.toHaveProperty(k);
  });

  it("cannot close its script element", () => {
    const text = jsonLdText({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("</script");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("DP-210 redirects", () => {
  it("answers a live address or a redirect, never both", () => {
    expect(PublicSeoResolveResponseSchema.parse({ path: "/about-us", kind: "page" })).toEqual({
      path: "/about-us",
      kind: "page",
    });
    expect(
      PublicSeoResolveResponseSchema.parse({
        path: "/old",
        redirect: { target: "/new", statusCode: 301 },
      }),
    ).toEqual({ path: "/old", redirect: { target: "/new", statusCode: 301 } });
    for (const bad of [
      { path: "/x", kind: "page", redirect: { target: "/y", statusCode: 301 } },
      { path: "/x", redirect: { target: "/y", statusCode: 307 } },
      { path: "/x", redirect: { target: "", statusCode: 301 } },
      { path: "/x" },
    ]) {
      expect(PublicSeoResolveResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("keeps the request's query on a same-site target without one", () => {
    expect(seoRedirectLocation("/new", "")).toBe("/new");
    expect(seoRedirectLocation("/new", "?")).toBe("/new");
    expect(seoRedirectLocation("/new", "?utm_source=x")).toBe("/new?utm_source=x");
    expect(seoRedirectLocation("/new", "a=1")).toBe("/new?a=1");
    // A target with its own query, or an https URL, is used as it is.
    expect(seoRedirectLocation("/products?category=base-oil", "?a=1")).toBe(
      "/products?category=base-oil",
    );
    expect(seoRedirectLocation("https://example.com/a", "?a=1")).toBe("https://example.com/a");
    expect(seoRedirectTargetIsSitePath("//evil.example")).toBe(false);
    expect(REDIRECT_SITE_KEYS).toEqual(["BV"]);
  });
});
