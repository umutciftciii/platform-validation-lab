// CMS S1 (DP-015, ADR-020): page contracts — slugs, links, section validation, strictness.
import { describe, expect, it } from "vitest";
import {
  CMS_SECTION_TYPES,
  CMS_SITE_REGISTRY,
  CmsHrefSchema,
  CmsPageCreateRequestSchema,
  CmsPageDraftRequestSchema,
  CmsSlugSchema,
  CmsTemplateContentSchema,
  cmsFieldsSchema,
} from "../src/index.js";

const draft = (content: unknown) => ({
  version: 1,
  title: "About us",
  slug: "about-us",
  seo: { title: null, description: null, noindex: false },
  content,
});

describe("CMS slugs", () => {
  it("normalises one kebab-case segment", () => {
    expect(CmsSlugSchema.parse(" About-Us ")).toBe("about-us");
  });

  it("refuses app routes, two-letter (locale) slugs and other formats", () => {
    for (const bad of [
      "products",
      "privacy",
      "api",
      "preview",
      "en",
      "nl",
      "a/b",
      "-a",
      "a--b",
      "",
    ]) {
      expect(CmsSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(CmsSlugSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(CmsSlugSchema.safeParse("energy-trading").success).toBe(true);
  });
});

describe("CMS links", () => {
  it("accepts site paths, anchors, https, mailto and tel", () => {
    for (const ok of [
      "/about-us",
      "/",
      "#contact",
      "https://dreampetroleumbv.com/en",
      "mailto:info@x.com",
      "tel:+31202101350",
    ]) {
      expect(CmsHrefSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuses script, data, http and protocol-relative targets", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "http://x.com",
      "//evil.com",
      "/a b",
      " ",
    ]) {
      expect(CmsHrefSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("CMS template content", () => {
  const hero = { id: "sec-00001", type: "hero", title: " Who we are ", eyebrow: "", intro: null };

  it("trims texts, stores blanks as null and keeps the section order", () => {
    const parsed = CmsTemplateContentSchema.parse({
      sections: [hero, { id: "sec-00002", type: "text", body: "One.\n\nTwo." }],
    });
    expect(parsed.sections).toEqual([
      { id: "sec-00001", type: "hero", title: "Who we are", eyebrow: null, intro: null, cta: null },
      { id: "sec-00002", type: "text", title: null, body: "One.\n\nTwo." },
    ]);
  });

  it("refuses unknown section types, unknown fields and missing required fields", () => {
    expect(
      CmsTemplateContentSchema.safeParse({ sections: [{ id: "sec-00001", type: "video" }] })
        .success,
    ).toBe(false);
    expect(
      CmsTemplateContentSchema.safeParse({ sections: [{ ...hero, html: "<b>x</b>" }] }).success,
    ).toBe(false);
    expect(
      CmsTemplateContentSchema.safeParse({ sections: [{ id: "sec-00001", type: "hero" }] }).success,
    ).toBe(false);
    expect(CmsTemplateContentSchema.safeParse({ sections: [], extra: 1 }).success).toBe(false);
  });

  it("reports the field path of a nested problem", () => {
    const result = CmsTemplateContentSchema.safeParse({
      sections: [
        {
          id: "sec-00001",
          type: "cta",
          title: "Talk to us",
          button: { label: "Go", href: "javascript:x" },
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("sections.0.button.href");
  });

  it("refuses duplicate section ids, too many sections and card lists out of range", () => {
    expect(CmsTemplateContentSchema.safeParse({ sections: [hero, hero] }).success).toBe(false);
    const many = Array.from({ length: 31 }, (_, i) => ({
      ...hero,
      id: `sec-${String(i).padStart(5, "0")}`,
    }));
    expect(CmsTemplateContentSchema.safeParse({ sections: many }).success).toBe(false);
    const cards = (n: number) => ({
      id: "sec-00003",
      type: "cards",
      items: Array.from({ length: n }, () => ({ title: "Card" })),
    });
    expect(CmsTemplateContentSchema.safeParse({ sections: [cards(0)] }).success).toBe(false);
    expect(CmsTemplateContentSchema.safeParse({ sections: [cards(13)] }).success).toBe(false);
    expect(CmsTemplateContentSchema.safeParse({ sections: [cards(12)] }).success).toBe(true);
  });

  it("refuses control characters", () => {
    expect(
      CmsTemplateContentSchema.safeParse({ sections: [{ ...hero, title: "a\u0000b" }] }).success,
    ).toBe(false);
  });

  it("builds a schema for every section type, and each has a required field", () => {
    for (const s of CMS_SECTION_TYPES) {
      expect(cmsFieldsSchema(s.fields).safeParse({}).success, s.type).toBe(false);
    }
  });
});

describe("CMS page requests", () => {
  it("creates with a title and slug only", () => {
    expect(CmsPageCreateRequestSchema.parse({ title: " About ", slug: "About" })).toEqual({
      title: "About",
      slug: "about",
    });
    expect(
      CmsPageCreateRequestSchema.safeParse({ title: "A", slug: "a-b", kind: "DESIGN" }).success,
    ).toBe(false);
  });

  it("saves a whole draft with SEO fields", () => {
    const parsed = CmsPageDraftRequestSchema.parse(draft({ sections: [] }));
    expect(parsed.seo).toEqual({ title: null, description: null, noindex: false });
    expect(
      CmsPageDraftRequestSchema.safeParse({ ...draft({ sections: [] }), seo: { noindex: "yes" } })
        .success,
    ).toBe(false);
    expect(
      CmsPageDraftRequestSchema.safeParse({
        ...draft({ sections: [] }),
        seo: { title: "x".repeat(121), description: null, noindex: false },
      }).success,
    ).toBe(false);
  });
});

describe("CMS site registry", () => {
  it("has unique keys and keeps legal and catalogue pages out of the CMS", () => {
    const keys = CMS_SITE_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of CMS_SITE_REGISTRY) {
      if (e.kind === "LEGAL") expect(e.managedBy).toBe("contract");
      if (e.kind === "CATALOG") expect(e.managedBy).toBe("catalog");
      expect(e.key.startsWith(e.site === "BV" ? "bv." : "corporate.")).toBe(true);
    }
  });
});
