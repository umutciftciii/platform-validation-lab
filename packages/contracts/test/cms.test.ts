// CMS S1 (DP-015, ADR-020): page contracts — slugs, links, section validation, strictness.
import { describe, expect, it } from "vitest";
import {
  CMS_DESIGN_TEMPLATES,
  CMS_SECTION_TYPES,
  CMS_SITE_REGISTRY,
  CMS_STATIC_ASSETS,
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

describe("CMS S2 field types", () => {
  const fields = [
    { type: "text", key: "anchor", label: "A", max: 60, required: true, format: "anchor" },
    { type: "text", key: "focus", label: "F", max: 12, required: true, format: "position" },
    { type: "text", key: "href", label: "H", max: 500, format: "href" },
    { type: "asset", key: "image", label: "I", kinds: ["image"] },
    {
      type: "group",
      key: "box",
      label: "B",
      fields: [{ type: "text", key: "title", label: "T", max: 20, required: true }],
    },
    {
      type: "list",
      key: "items",
      label: "L",
      itemLabel: "Item",
      min: 1,
      max: 3,
      unique: "id",
      fields: [{ type: "text", key: "id", label: "Id", max: 20, required: true, format: "anchor" }],
    },
  ] as const;
  const schema = cmsFieldsSchema(fields as never);
  const ok = {
    anchor: "group-1",
    focus: "50% 30%",
    href: "",
    image: "/media/ctl-technology/clear-base-oil.webp",
    box: { title: "Box" },
    items: [{ id: "a" }, { id: "b" }],
  };

  it("accepts valid values and turns an empty optional link target into null", () => {
    expect(schema.parse(ok)).toMatchObject({ href: null, box: { title: "Box" } });
    expect(schema.parse({ ...ok, href: "/products" })).toMatchObject({ href: "/products" });
  });

  it("refuses bad anchors, focal points, unknown or wrong-kind assets and duplicate keys", () => {
    for (const bad of [
      { anchor: "Group 1" },
      { focus: "center" },
      { href: "javascript:x" },
      { image: "/media/../secret.webp" },
      { image: "https://evil.example/x.webp" },
      { image: "/media/iccsyn-groups/temp/group-1-loop.gif" },
      { box: { title: "Box", extra: 1 } },
      { items: [{ id: "a" }, { id: "a" }] },
      { items: [] },
    ]) {
      expect(schema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("registers every asset once, with its size", () => {
    const srcs = CMS_STATIC_ASSETS.map((a) => a.src);
    expect(new Set(srcs).size).toBe(srcs.length);
    for (const a of CMS_STATIC_ASSETS) {
      expect(a.src).toMatch(/^\/media\/[a-z0-9/_-]+\.(webp|gif)$/);
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
    }
  });

  it("fixes the list sizes the BV animations depend on", () => {
    const home = CMS_DESIGN_TEMPLATES.find((t) => t.key === "bv.home")!;
    const list = (group: string, key: string) => {
      const g = home.fields.find((f) => f.key === group);
      const l = g && g.type === "group" ? g.fields.find((f) => f.key === key) : undefined;
      return l && l.type === "list" ? [l.min, l.max] : null;
    };
    expect(list("hero", "applications")).toEqual([6, 6]);
    expect(list("ctl", "stages")).toEqual([3, 3]);
    expect(list("applications", "scenes")).toEqual([3, 3]);
  });

  it("keeps every designed template in the site registry", () => {
    for (const t of CMS_DESIGN_TEMPLATES) {
      const entry = CMS_SITE_REGISTRY.find((e) => e.key === t.key);
      expect(entry?.managedBy, t.key).toBe("cms_pending");
      expect(entry?.path ?? null).toBe(t.path);
    }
  });
});

describe("CMS content page sections (DP-135)", () => {
  const parse = (section: Record<string, unknown>) =>
    CmsTemplateContentSchema.safeParse({ sections: [{ id: "sec-0001", ...section }] });
  const split = {
    type: "split",
    eyebrow: null,
    title: "Logistics",
    body: "Sea and road.",
    image: "/media/services-showcase/logistics-desktop.webp",
    imageAlt: "A tanker at a quay.",
    imageNote: null,
  };

  it("accepts an image beside text, a specification list and a quote", () => {
    expect(parse(split).success).toBe(true);
    expect(
      parse({
        type: "specList",
        title: "Products",
        intro: null,
        items: [{ term: "Base Oils", detail: "Group I, Group II" }],
        link: { label: "Contact", href: "/contact" },
      }).success,
    ).toBe(true);
    expect(parse({ type: "quote", text: "Long-term value.", source: null }).success).toBe(true);
  });

  it("accepts the contact section only with its form note (DP-150)", () => {
    const contact = {
      type: "contact",
      title: "Contact",
      intro: null,
      formTitle: "Send us a message",
      formNote: "This form cannot send messages yet.",
    };
    expect(parse(contact).success).toBe(true);
    expect(parse({ ...contact, formNote: "" }).success).toBe(false);
    // The phone, e-mail and address come from the footer, never from the section.
    expect(parse({ ...contact, phone: "+31 20 000 0000" }).success).toBe(false);
  });

  it("refuses an unregistered image, a missing alt text, an empty list and an empty quote", () => {
    expect(parse({ ...split, image: "/media/elsewhere.webp" }).success).toBe(false);
    expect(parse({ ...split, imageAlt: "" }).success).toBe(false);
    expect(
      parse({ type: "specList", title: "T", intro: null, items: [], link: null }).success,
    ).toBe(false);
    expect(parse({ type: "quote", text: " ", source: null }).success).toBe(false);
  });

  it("offers an import only for content the site has a seed for", () => {
    for (const e of CMS_SITE_REGISTRY) {
      if (e.importable) expect(e.managedBy, e.key).toBe("cms_pending");
      if (e.kind === "TEMPLATE") expect(e.path, e.key).toMatch(/^\/[a-z0-9-]+$/);
    }
    const importable = CMS_SITE_REGISTRY.filter((e) => e.kind === "TEMPLATE" && e.importable);
    expect(importable.map((e) => e.path).sort()).toEqual([
      "/about-us",
      "/contact",
      "/energy-trading",
      "/logistics",
      "/storage-distribution",
    ]);
  });
});
