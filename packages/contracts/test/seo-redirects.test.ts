// DP-211: the address rules, query normalisation and CSV parsing shared by the admin form, the
// CSV import and the API (one set of rules, one set of rule names).
import { describe, expect, it } from "vitest";
import {
  SEO_REDIRECT_CSV_MAX_BYTES,
  SEO_REDIRECT_CSV_MAX_ROWS,
  SEO_REDIRECT_IMPORT_MAX_BODY_BYTES,
  SEO_REDIRECT_IMPORT_PATH,
  SEO_REDIRECT_CSV_SAMPLE,
  SeoRedirectInputSchema,
  csvCell,
  normalizeRedirectQuery,
  parseCsvActive,
  parseCsvStatus,
  parseRedirectCsv,
  parseRedirectSource,
  parseRedirectTarget,
  redirectSourceIsLegacy,
  redirectSourceLabel,
  redirectTargetPath,
  seoLegacyPath,
  seoRedirectLocation,
} from "../src/index.js";

const rule = (r: { ok: boolean; rule?: string }) => (r.ok ? "ok" : r.rule);

describe("DP-211 redirect sources", () => {
  it("accepts the addresses the BV site answers, with an optional query", () => {
    expect(parseRedirectSource(" /old-page ")).toEqual({
      ok: true,
      value: { sourcePath: "/old-page", sourceQuery: "" },
    });
    expect(parseRedirectSource("/news/old-article/")).toMatchObject({
      value: { sourcePath: "/news/old-article" },
    });
    expect(parseRedirectSource("/products/old-oil?b=2&a=1")).toEqual({
      ok: true,
      value: { sourcePath: "/products/old-oil", sourceQuery: "a=1&b=2" },
    });
    // A full URL is reduced to its path and query (the source is always on this site).
    expect(parseRedirectSource("https://dreampetroleumbv.com/old?x=1")).toEqual({
      ok: true,
      value: { sourcePath: "/old", sourceQuery: "x=1" },
    });
  });

  it("refuses reserved, malformed and unreachable sources with readable rules", () => {
    expect(rule(parseRedirectSource(""))).toBe("required");
    for (const p of [
      "/",
      "/products",
      "/news",
      "/privacy",
      "/api",
      "/de",
      "/sitemap",
      "/sitemap.xml",
      "/Robots.txt",
      "/media/brand/logo.svg",
      "/Products",
      "/lead-form",
    ]) {
      expect(rule(parseRedirectSource(p)), p).toBe("reserved");
    }
    for (const p of ["/api/x", "/_next/static/x"])
      expect(rule(parseRedirectSource(p)), p).toBe("reserved");
    // DP-212: upper case, deeper paths, ".html" and "_" are old-site addresses now (below);
    // what stays malformed:
    for (const p of [
      "old",
      "/a b",
      "//x",
      "/a//b",
      "/a/../b",
      "/a/..",
      "/.hidden",
      "/a-",
      "/a%20b",
      "/caf\u00e9",
      "/a/b/c/d/e/f/g",
      "/a\\b",
    ]) {
      expect(rule(parseRedirectSource(p)), p).toBe("format");
    }
    expect(rule(parseRedirectSource("/a#top"))).toBe("fragment");
    expect(rule(parseRedirectSource(`/a?${"x=1&".repeat(80)}`))).toBe("too_long");
  });
});

describe("DP-212 old-site sources (legacy URL map)", () => {
  const src = (p: string) => {
    const r = parseRedirectSource(p);
    return r.ok ? redirectSourceLabel(r.value) : `!${r.rule}`;
  };

  it("accepts the old site's addresses and stores them in lower case without a trailing slash", () => {
    expect(src("/en")).toBe("/en");
    expect(src("/tr/")).toBe("/tr");
    expect(src("/en/index")).toBe("/en/index");
    expect(src("/en/About-Us")).toBe("/en/about-us");
    expect(src("/EN/PRODUCTS/Base-Oil-2-100N")).toBe("/en/products/base-oil-2-100n");
    expect(src("/en/blog_detail/why-oil/1")).toBe("/en/blog_detail/why-oil/1");
    expect(src("/en/contact-us.html")).toBe("/en/contact-us.html");
    expect(src("/assets/specs/base-oil-2-150n.pdf")).toBe("/assets/specs/base-oil-2-150n.pdf");
    expect(src("/Old-Page")).toBe("/old-page");
    expect(src("https://dreampetroleumbv.com/en/products?category=base-oil")).toBe(
      "/en/products?category=base-oil",
    );
    // The query keeps its case (values are data) and is normalised as before.
    expect(src("/en/products?page=2&category=White-Oil")).toBe(
      "/en/products?category=White-Oil&page=2",
    );
  });

  it("tells old-site sources from the site's own forms", () => {
    expect(redirectSourceIsLegacy("/en")).toBe(true);
    expect(redirectSourceIsLegacy("/en/products/x")).toBe(true);
    expect(redirectSourceIsLegacy("/x.html")).toBe(true);
    expect(redirectSourceIsLegacy("/old-page")).toBe(false);
    expect(redirectSourceIsLegacy("/products/x")).toBe(false);
  });

  it("looks request paths up the same way (seoLegacyPath)", () => {
    expect(seoLegacyPath("/EN/About-Us/")).toBe("/en/about-us");
    expect(seoLegacyPath("/en/contact-us.html")).toBe("/en/contact-us.html");
    for (const bad of [
      "/",
      "",
      "en",
      "/en//x",
      "/en/../x",
      "/en/%2e%2e/x",
      "/_next/static/x.js",
      "/api/v1/x",
      "/media/brand/logo.svg",
      "/Media/x.jpg",
      "/__dp/not-found",
      "/sitemap.xml",
      "/robots.txt",
      "/favicon.ico",
      `/${"a".repeat(301)}`,
      "/a/b/c/d/e/f/g",
    ]) {
      expect(seoLegacyPath(bad), bad).toBeNull();
    }
  });

  it("has room for the whole legacy map in one file, with a matching request limit", () => {
    expect(SEO_REDIRECT_CSV_MAX_ROWS).toBe(1000);
    expect(SEO_REDIRECT_CSV_MAX_BYTES).toBe(128 * 1024);
    // JSON escaping of quotes and line breaks at most doubles the CSV; plus the envelope.
    expect(SEO_REDIRECT_IMPORT_MAX_BODY_BYTES).toBeGreaterThan(2 * SEO_REDIRECT_CSV_MAX_BYTES);
    const id = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect(SEO_REDIRECT_IMPORT_PATH.test(`/api/v1/admin/seo/sites/${id}/redirects/import`)).toBe(
      true,
    );
    for (const p of [
      `/api/v1/admin/seo/sites/${id}/redirects`,
      `/api/v1/admin/seo/sites/${id}/redirects/import/x`,
      `/api/v1/admin/cms/sites/${id}/redirects/import`,
      `/api/v1/admin/seo/sites/x/redirects/import`,
    ]) {
      expect(SEO_REDIRECT_IMPORT_PATH.test(p), p).toBe(false);
    }
  });

  it("parses a 1000-row legacy file and refuses one row more", () => {
    const rows = Array.from(
      { length: 1000 },
      (_, i) => `/en/products/p-${i},/products/p-${i},301,true,`,
    );
    const ok = parseRedirectCsv(["source,target,status,active,note", ...rows].join("\r\n"));
    expect(ok.ok && ok.rows.length).toBe(1000);
    expect(parseRedirectCsv(["source,target", ...rows, "/en/x,/x"].join("\n"))).toEqual({
      ok: false,
      rule: "too_many_rows",
    });
  });
});

describe("DP-211 redirect targets", () => {
  it("accepts paths of the same site, with a normalised query", () => {
    expect(parseRedirectTarget("/about-us")).toEqual({ ok: true, value: "/about-us" });
    expect(parseRedirectTarget("/")).toEqual({ ok: true, value: "/" });
    expect(parseRedirectTarget("/products?category=base-oil")).toEqual({
      ok: true,
      value: "/products?category=base-oil",
    });
    expect(parseRedirectTarget("/products/x?b=1&a=2")).toEqual({
      ok: true,
      value: "/products/x?a=2&b=1",
    });
    expect(parseRedirectTarget("/a/b/c")).toEqual({ ok: true, value: "/a/b/c" });
  });

  it("never leaves the site and never names an app internal", () => {
    for (const t of [
      "https://evil.example/x",
      "http://dreampetroleumbv.com/x",
      "//evil.example",
      "javascript:alert(1)",
      "mailto:a@b.c",
      "\\\\evil",
    ]) {
      expect(rule(parseRedirectTarget(t)), t).toBe("external");
    }
    for (const t of [
      "/api/x",
      "/_next/a",
      "/__dp/not-found",
      "/preview/x",
      "/product-documents/a",
    ]) {
      expect(rule(parseRedirectTarget(t)), t).toBe("reserved");
    }
    for (const t of ["about", "/About", "/a/b/c/d", "/a b"]) {
      expect(rule(parseRedirectTarget(t)), t).toBe("format");
    }
    expect(rule(parseRedirectTarget("/a#x"))).toBe("fragment");
  });

  it("labels and paths", () => {
    expect(redirectSourceLabel({ sourcePath: "/a", sourceQuery: "" })).toBe("/a");
    expect(redirectSourceLabel({ sourcePath: "/a", sourceQuery: "x=1" })).toBe("/a?x=1");
    expect(redirectTargetPath("/products?c=1")).toBe("/products");
  });
});

describe("DP-211 query normalisation", () => {
  it("sorts parameters so their order never matters, and encodes safely", () => {
    expect(normalizeRedirectQuery("?b=2&a=1")).toEqual({ ok: true, value: "a=1&b=2" });
    expect(normalizeRedirectQuery("a=1&b=2")).toEqual(normalizeRedirectQuery("b=2&a=1"));
    expect(normalizeRedirectQuery("q=a b&x=(1)")).toEqual({ ok: true, value: "q=a%20b&x=%281%29" });
    expect(normalizeRedirectQuery("")).toEqual({ ok: true, value: "" });
    expect(normalizeRedirectQuery("=x")).toEqual({ ok: true, value: "" });
    expect(normalizeRedirectQuery("flag")).toEqual({ ok: true, value: "flag=" });
  });

  it("matches what the database stores (SiteRedirect_source_query)", () => {
    const v = normalizeRedirectQuery("ü=ç&utm_source=mail!*'");
    expect(v.ok && /^[A-Za-z0-9._~%=&+-]+$/.test(v.value)).toBe(true);
  });
});

describe("DP-211 public location", () => {
  it("keeps the request query for a plain redirect, never for a query-bound one", () => {
    expect(seoRedirectLocation("/new", "?utm=x")).toBe("/new?utm=x");
    expect(seoRedirectLocation("/new", "?id=5", false)).toBe("/new");
    expect(seoRedirectLocation("/new?c=1", "?utm=x")).toBe("/new?c=1");
  });
});

describe("DP-211 CSV", () => {
  it("parses the sample: header in any order, optional columns, quotes, CRLF, BOM", () => {
    const sample = parseRedirectCsv(SEO_REDIRECT_CSV_SAMPLE);
    expect(sample.ok && sample.rows.length).toBe(4);
    const csv = '﻿note;target;source\r\n"a; ""quoted"" note";/new;/old\r\n\r\n;/b;/a\r\n';
    expect(parseRedirectCsv(csv)).toEqual({
      ok: true,
      rows: [
        {
          line: 2,
          source: "/old",
          target: "/new",
          status: "",
          active: "",
          note: 'a; "quoted" note',
        },
        { line: 4, source: "/a", target: "/b", status: "", active: "", note: "" },
      ],
    });
    const multi = parseRedirectCsv('source,target,note\n/a,/b,"two\nlines"\n/c,/d,\n');
    expect(multi.ok && multi.rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it("refuses unusable files with a rule", () => {
    expect(parseRedirectCsv("")).toEqual({ ok: false, rule: "empty" });
    expect(parseRedirectCsv("source,target\n")).toEqual({ ok: false, rule: "empty" });
    expect(parseRedirectCsv("from,to\n/a,/b")).toMatchObject({ ok: false, rule: "header" });
    expect(parseRedirectCsv("source,target,source\n/a,/b,/c")).toMatchObject({ rule: "header" });
    expect(parseRedirectCsv('source,target\n"/a,/b')).toMatchObject({ ok: false, rule: "quote" });
    expect(parseRedirectCsv("source,target\n/a,/b,/c")).toMatchObject({ rule: "columns", line: 2 });
    const many = [
      "source,target",
      ...Array.from({ length: SEO_REDIRECT_CSV_MAX_ROWS + 1 }, (_, i) => `/a${i},/b`),
    ];
    expect(parseRedirectCsv(many.join("\n"))).toEqual({ ok: false, rule: "too_many_rows" });
    expect(parseRedirectCsv(`source,target\n${"/a,/b\n".repeat(25_000)}`)).toEqual({
      ok: false,
      rule: "too_large",
    });
  });

  it("reads status and active leniently, refuses anything else", () => {
    expect(["", "301", "302", "307", "x"].map(parseCsvStatus)).toEqual([301, 301, 302, null, null]);
    expect(["", "true", "No", "0", "active", "maybe"].map(parseCsvActive)).toEqual([
      true,
      true,
      false,
      false,
      true,
      null,
    ]);
  });

  it("neutralises spreadsheet formulas in downloaded reports", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell("/old")).toBe("/old");
  });
});

describe("DP-211 request body", () => {
  it("trims the note, refuses control characters and unknown fields", () => {
    const ok = SeoRedirectInputSchema.parse({
      source: "/a",
      target: "/b",
      statusCode: 301,
      active: true,
      note: "  hi ",
    });
    expect(ok.note).toBe("hi");
    expect(
      SeoRedirectInputSchema.parse({
        source: "/a",
        target: "/b",
        statusCode: 302,
        active: false,
        note: " ",
      }).note,
    ).toBeNull();
    expect(
      SeoRedirectInputSchema.safeParse({
        source: "/a",
        target: "/b",
        statusCode: 307,
        active: true,
      }).success,
    ).toBe(false);
    expect(
      SeoRedirectInputSchema.safeParse({
        source: "/a",
        target: "/b",
        statusCode: 301,
        active: true,
        note: "a\u0007",
      }).success,
    ).toBe(false);
    expect(
      SeoRedirectInputSchema.safeParse({
        source: "/a",
        target: "/b",
        statusCode: 301,
        active: true,
        origin: "SLUG_CHANGE",
      }).success,
    ).toBe(false);
  });
});
