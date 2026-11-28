// CMS S1 (DP-015, ADR-020): page contracts — slugs, links, section validation, strictness.
import { describe, expect, it } from "vitest";
import {
  CMS_DESIGN_TEMPLATES,
  CMS_SECTION_TYPES,
  CMS_SITE_REGISTRY,
  CMS_STATIC_ASSETS,
  CORPORATE_HOME_FIELDS,
  CORPORATE_HOME_KEY,
  CORPORATE_PRODUCTS_FIELDS,
  CORPORATE_PRODUCTS_KEY,
  BV_NEWS_INDEX_FIELDS,
  CMS_NEWS_INDEX_KEYS,
  CORPORATE_NEWS_INDEX_FIELDS,
  CORPORATE_NEWS_INDEX_KEY,
  cmsIsNewsIndex,
  CORPORATE_CONTENT_REGISTRY,
  CmsDateSchema,
  cmsArticleDate,
  cmsCorporateTrPlace,
  cmsTranslationProposal,
  CmsHrefSchema,
  CmsPageCreateRequestSchema,
  CmsPageDraftRequestSchema,
  CmsSlugSchema,
  CmsTemplateContentSchema,
  cmsArticleContentSchema,
  cmsAssetRequired,
  cmsDesignTemplate,
  cmsFieldsOn,
  cmsFieldsSchema,
  cmsSiteAsset,
  cmsSiteAssets,
  cmsTemplateContentSchema,
  type CmsField,
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
    // DP-209: the canonical and Open Graph fields may be left out (null when missing).
    expect(parsed.seo).toEqual({
      title: null,
      description: null,
      noindex: false,
      canonicalPath: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
    });
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
      // DP-206: the live site's own photos stay JPEG, byte for byte.
      expect(a.src).toMatch(/^\/media\/[a-z0-9/_-]+\.(webp|gif|jpg)$/);
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
      // A content page, or a news article at /news/<slug> (DP-206).
      if (e.kind === "TEMPLATE") expect(e.path, e.key).toMatch(/^\/(news\/)?[a-z0-9-]+$/);
    }
    const importable = CMS_SITE_REGISTRY.filter(
      (e) =>
        e.kind === "TEMPLATE" && e.importable && (e.site === "BV" || e.key === "corporate.contact"),
    );
    expect(importable.map((e) => e.path).sort()).toEqual([
      "/about-us",
      "/contact",
      // COM-4: the corporate contact page (corporate.contact).
      "/contact",
      "/energy-trading",
      "/logistics",
      "/news/why-are-oil-prices-falling-the-impact-of-the-us-iran-agreement-on-energy-markets",
      "/our-team",
      "/storage-distribution",
      "/strategic-partnership",
      "/sustainability",
    ]);
  });
});

describe("site-scoped media (COM-2a, DP-320)", () => {
  const bvImage = "/media/services-showcase/logistics-desktop.webp";
  const section = (over: Record<string, unknown>) => ({
    sections: [
      {
        id: "sec-0001",
        type: "split",
        eyebrow: null,
        title: "Logistics",
        body: "Sea and road.",
        image: bvImage,
        imageAlt: "A tanker at a quay.",
        imageNote: null,
        ...over,
      },
    ],
  });

  it("registers every asset for exactly one site and lists a site's own files only", () => {
    for (const a of CMS_STATIC_ASSETS) expect(["BV", "CORPORATE"]).toContain(a.site);
    expect(cmsSiteAssets("BV").every((a) => a.site === "BV")).toBe(true);
    expect(cmsSiteAssets("CORPORATE").every((a) => a.site === "CORPORATE")).toBe(true);
    expect(cmsSiteAsset(bvImage, "BV")?.src).toBe(bvImage);
    expect(cmsSiteAsset(bvImage, "CORPORATE")).toBeUndefined();
  });

  it("a page of one site never points at the other site's files", () => {
    expect(cmsTemplateContentSchema("BV").safeParse(section({})).success).toBe(true);
    expect(cmsTemplateContentSchema("CORPORATE").safeParse(section({})).success).toBe(false);
  });

  it("a corporate split section may have no image (the design works without one)", () => {
    const none = section({ image: null, imageAlt: null });
    expect(cmsTemplateContentSchema("CORPORATE").safeParse(none).success).toBe(true);
    expect(
      cmsTemplateContentSchema("CORPORATE").safeParse(section({ image: "", imageAlt: "" })),
    ).toMatchObject({
      success: true,
      data: { sections: [{ image: null, imageAlt: null }] },
    });
  });

  it("BV keeps the image required, with its alt text", () => {
    expect(cmsTemplateContentSchema("BV").safeParse(section({ image: null })).success).toBe(false);
    expect(cmsTemplateContentSchema("BV").safeParse(section({ imageAlt: "" })).success).toBe(false);
    expect(cmsTemplateContentSchema("BV").safeParse(section({ imageAlt: null })).success).toBe(
      false,
    );
  });

  it("the request shape accepts what either site accepts; the API applies the site", () => {
    expect(
      CmsTemplateContentSchema.safeParse(section({ image: null, imageAlt: null })).success,
    ).toBe(true);
    // An alt text stays required as soon as an image is chosen.
    expect(CmsTemplateContentSchema.safeParse(section({ imageAlt: null })).success).toBe(false);
  });

  it("asset fields say on which sites they are required", () => {
    const image = CMS_SECTION_TYPES.find((s) => s.type === "split")?.fields.find(
      (f) => f.key === "image",
    );
    expect(image?.type).toBe("asset");
    if (image?.type !== "asset") return;
    expect(cmsAssetRequired(image, "BV")).toBe(true);
    expect(cmsAssetRequired(image, "CORPORATE")).toBe(false);
    expect(cmsAssetRequired(image)).toBe(false);
    const cover = {
      type: "asset",
      key: "c",
      label: "C",
      kinds: ["image"],
      required: false,
    } as const;
    expect(cmsAssetRequired(cover, "BV")).toBe(false);
    const plain = { type: "asset", key: "c", label: "C", kinds: ["image"] } as const;
    expect(cmsAssetRequired(plain)).toBe(true);
    expect(cmsAssetRequired(plain, "CORPORATE")).toBe(true);
  });

  it("an article's cover image is the site's own file too", () => {
    const article = {
      excerpt: "Summary",
      coverImage: "/media/news/why-are-oil-prices-falling.jpg",
      coverAlt: "Cover",
      sections: [],
    };
    expect(cmsArticleContentSchema("BV").safeParse(article).success).toBe(true);
    expect(cmsArticleContentSchema("CORPORATE").safeParse(article).success).toBe(false);
    expect(
      cmsArticleContentSchema("CORPORATE").safeParse({
        ...article,
        coverImage: null,
        coverAlt: null,
      }).success,
    ).toBe(true);
  });
});

describe("corporate designed pages (COM-2b, DP-028, DP-094)", () => {
  const fieldsOf = (fields: readonly CmsField[]): CmsField[] =>
    fields.flatMap((f) =>
      f.type === "group" || f.type === "list" ? [f, ...fieldsOf(f.fields)] : [f],
    );

  it("registers the home page and the portfolio as importable corporate designed pages", () => {
    for (const [key, path, fields] of [
      [CORPORATE_HOME_KEY, "/", CORPORATE_HOME_FIELDS],
      [CORPORATE_PRODUCTS_KEY, "/products", CORPORATE_PRODUCTS_FIELDS],
    ] as const) {
      expect(cmsDesignTemplate(key)).toMatchObject({ site: "CORPORATE", kind: "DESIGN", path });
      expect(cmsDesignTemplate(key)?.fields).toBe(fields);
      expect(CMS_SITE_REGISTRY.find((e) => e.key === key)).toMatchObject({
        site: "CORPORATE",
        kind: "DESIGN",
        path,
        importable: true,
      });
    }
  });

  it("has image fields only for registered pictures (COM-7) and no field for a counter, a testimonial or a FAQ", () => {
    const all = [...fieldsOf(CORPORATE_HOME_FIELDS), ...fieldsOf(CORPORATE_PRODUCTS_FIELDS)];
    // COM-7: the visual pack's pictures (activity areas, service cards, call to action, the
    // portfolio heading); an asset field accepts registered files of the page's site only.
    const assets = all.filter((f) => f.type === "asset");
    expect(assets.map((f) => f.key)).toEqual(["image", "image", "image", "image"]);
    expect(assets.every((f) => f.type === "asset" && f.kinds.join() === "image")).toBe(true);
    expect(all.map((f) => f.key).join(" ")).not.toMatch(
      /counter|stat|figure|testimonial|review|quote|faq|question|distributor/i,
    );
  });

  it("refuses content the schema does not describe and keeps the typical values optional", () => {
    const schema = cmsFieldsSchema(CORPORATE_PRODUCTS_FIELDS, "CORPORATE");
    const content = {
      intro: { eyebrow: null, title: "Product Portfolio", intro: "Base oils." },
      groups: [
        {
          anchor: "base-oils-group1",
          eyebrow: null,
          title: "Group I",
          subtitle: null,
          description: "Solvent refined.",
          items: [{ name: "SN 150", type: null, description: null }],
          applicationsTitle: null,
          applications: [],
          link: null,
        },
      ],
      typicalValues: { title: null, columnA: null, columnB: null, note: null, rows: [] },
      coa: { title: "Request a COA", text: null, button: { label: "Request", href: "/contact" } },
    };
    // COM-7: the heading's picture is optional; content stored before it reads with none.
    expect(schema.parse(content)).toEqual({
      ...content,
      intro: { ...content.intro, image: null, imageAlt: null },
    });
    expect(schema.safeParse({ ...content, counters: [] }).success).toBe(false);
    const group = content.groups[0]!;
    // Anchors are addresses: one per group, in the anchor format.
    expect(schema.safeParse({ ...content, groups: [group, group] }).success).toBe(false);
    expect(
      schema.safeParse({ ...content, groups: [{ ...group, anchor: "Group 1" }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...content, groups: [] }).success).toBe(false);
  });
});

describe("corporate news list heading (COM-3)", () => {
  it("registers corporate.news-index at /news as an importable corporate designed page", () => {
    expect(cmsDesignTemplate(CORPORATE_NEWS_INDEX_KEY)).toMatchObject({
      site: "CORPORATE",
      kind: "DESIGN",
      path: "/news",
    });
    expect(cmsDesignTemplate(CORPORATE_NEWS_INDEX_KEY)?.fields).toBe(CORPORATE_NEWS_INDEX_FIELDS);
    expect(CORPORATE_NEWS_INDEX_FIELDS).toBe(BV_NEWS_INDEX_FIELDS);
    expect(CMS_SITE_REGISTRY.find((e) => e.key === CORPORATE_NEWS_INDEX_KEY)).toMatchObject({
      site: "CORPORATE",
      kind: "DESIGN",
      path: "/news",
      importable: true,
    });
  });

  it("names one news list heading per site", () => {
    expect(CMS_NEWS_INDEX_KEYS).toEqual({ BV: "bv.news-index", CORPORATE: "corporate.news-index" });
    expect(cmsIsNewsIndex("bv.news-index")).toBe(true);
    expect(cmsIsNewsIndex("corporate.news-index")).toBe(true);
    expect(cmsIsNewsIndex("corporate.home")).toBe(false);
    expect(cmsIsNewsIndex("article")).toBe(false);
  });
});

describe("corporate content of the live site (COM-5)", () => {
  const rows = CORPORATE_CONTENT_REGISTRY;

  it("registers seven content pages and 19 news articles, all importable corporate TEMPLATE rows", () => {
    expect(rows.filter((e) => !e.path!.startsWith("/news/"))).toHaveLength(7);
    expect(rows.filter((e) => e.path!.startsWith("/news/"))).toHaveLength(19);
    for (const e of rows) {
      expect(e).toMatchObject({ site: "CORPORATE", kind: "TEMPLATE", importable: true });
      expect(CMS_SITE_REGISTRY).toContain(e);
      expect(e.key).toMatch(/^corporate\.[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(new Set(CMS_SITE_REGISTRY.map((e) => `${e.site} ${e.path}`)).size).toBe(
      CMS_SITE_REGISTRY.filter((e) => e.path !== null).length +
        new Set(CMS_SITE_REGISTRY.filter((e) => e.path === null).map((e) => e.site)).size,
    );
  });

  it("offers a Turkish proposal for every corporate page, article and menu, never elsewhere", () => {
    for (const e of rows) {
      const page = {
        kind: "TEMPLATE",
        templateKey: e.path!.startsWith("/news/") ? "article" : "standard",
        path: e.path,
      };
      expect(cmsTranslationProposal("CORPORATE", page, "tr"), e.key).not.toBeNull();
      expect(cmsTranslationProposal("CORPORATE", page, "nl")).toBeNull();
      expect(cmsTranslationProposal("BV", page, "tr")).toBeNull();
    }
    const article = rows.find((e) => e.path!.startsWith("/news/"))!;
    expect(
      cmsTranslationProposal(
        "CORPORATE",
        { kind: "TEMPLATE", templateKey: "article", path: article.path },
        "tr",
      )?.slug,
    ).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const key of [
      "corporate.home",
      "corporate.products",
      "corporate.news-index",
      "corporate.site-nav",
      "corporate.site-footer",
    ]) {
      expect(
        cmsTranslationProposal("CORPORATE", { kind: "DESIGN", templateKey: key, path: null }, "tr"),
        key,
      ).not.toBeNull();
    }
    expect(
      cmsCorporateTrPlace({ kind: "TEMPLATE", templateKey: "standard", path: "/about-us" }),
    ).toBe("standard|/about-us");
    // The Dutch BV menus keep their ML-7 proposal.
    expect(
      cmsTranslationProposal(
        "BV",
        { kind: "FRAGMENT", templateKey: "bv.site-nav", path: null },
        "nl",
      ),
    ).toEqual({
      title: null,
      slug: null,
    });
  });

  it("dates an article by its original date at noon UTC, else by its first publication (DP-327)", () => {
    expect(cmsArticleDate("2026-04-16", "2026-11-27T10:00:00.000Z")).toBe(
      "2026-04-16T12:00:00.000Z",
    );
    expect(cmsArticleDate(null, "2026-11-27T10:00:00.000Z")).toBe("2026-11-27T10:00:00.000Z");
    expect(cmsArticleDate("2026-02-30", "2026-11-27T10:00:00.000Z")).toBe(
      "2026-11-27T10:00:00.000Z",
    );
    expect(CmsDateSchema.safeParse("2026-08-13").success).toBe(true);
    expect(CmsDateSchema.safeParse("1989-12-31").success).toBe(false);
  });
});

describe("COM-7: the corporate redesign's content fields", () => {
  const heroFields = CMS_SECTION_TYPES.find((s) => s.type === "hero")!.fields;
  const hero = {
    id: "sec-00001",
    type: "hero",
    title: "Logistics",
    eyebrow: null,
    intro: null,
    cta: null,
  };
  const picture = "/media/visual-pack-v1/hero-logistics-supply.webp";

  it("registers the visual pack as the corporate site's own pictures, none for BV", () => {
    const own = cmsSiteAssets("CORPORATE").map((a) => a.src);
    expect(own).toEqual([
      "/media/visual-pack-v1/hero-energy-trading.webp",
      "/media/visual-pack-v1/hero-logistics-supply.webp",
      "/media/visual-pack-v1/hero-storage-terminal.webp",
      "/media/visual-pack-v1/hero-petrochemicals.webp",
    ]);
    expect(cmsSiteAsset(picture, "BV")).toBeUndefined();
    expect(cmsSiteAsset(picture, "CORPORATE")).toMatchObject({ width: 1672, height: 941 });
  });

  it("a hero picture exists on the corporate site only (BV keeps its four hero fields)", () => {
    expect(cmsFieldsOn(heroFields, "BV").map((f) => f.key)).toEqual([
      "eyebrow",
      "title",
      "intro",
      "cta",
    ]);
    expect(cmsFieldsOn(heroFields, "CORPORATE").map((f) => f.key)).toContain("image");
    const withPicture = { ...hero, image: picture, imageAlt: "Representative scene" };
    expect(
      cmsTemplateContentSchema("CORPORATE").safeParse({ sections: [withPicture] }).success,
    ).toBe(true);
    expect(cmsTemplateContentSchema("BV").safeParse({ sections: [withPicture] }).success).toBe(
      false,
    );
    // Without it the section stays as it was stored (no key added).
    expect(cmsTemplateContentSchema("CORPORATE").parse({ sections: [hero] }).sections[0]).toEqual(
      hero,
    );
    // A picture needs its alt text; another site's file is refused.
    expect(
      cmsTemplateContentSchema("CORPORATE").safeParse({ sections: [{ ...hero, image: picture }] })
        .success,
    ).toBe(false);
  });

  it("reads home content stored before COM-7 (no areas, no news heading)", () => {
    const schema = cmsFieldsSchema(CORPORATE_HOME_FIELDS, "CORPORATE");
    const link = { label: "Contact Us", href: "/contact" };
    const card = { title: "Logistics", description: null, href: null };
    const before = {
      hero: {
        eyebrow: null,
        title: "Global Energy Markets",
        intro: "Intro.",
        primary: link,
        secondary: null,
      },
      overview: { eyebrow: "E", title: "T", body: "B", highlights: [], link: null },
      services: { eyebrow: "E", title: "T", intro: null, items: [card] },
      productGroups: { eyebrow: "E", title: "T", intro: null, items: [card], link: null },
      strengths: { eyebrow: "E", title: "T", items: [{ title: "A", description: "B" }] },
      cta: { title: "T", text: null, points: [], button: link },
    };
    const read = schema.parse(before) as Record<string, Record<string, unknown>>;
    expect(read["hero"]!["slides"]).toEqual([]);
    expect(read["news"]).toBeNull();
    // Five areas are one too many; an area needs a registered picture.
    const area = {
      label: "Logistics",
      title: "T",
      intro: "I",
      image: picture,
      imageAlt: "Representative scene",
      cta: null,
    };
    const withAreas = (slides: unknown[]) => ({ ...before, hero: { ...before.hero, slides } });
    expect(schema.safeParse(withAreas([area, area, area, area])).success).toBe(true);
    expect(schema.safeParse(withAreas([area, area, area, area, area])).success).toBe(false);
    expect(
      schema.safeParse(withAreas([{ ...area, image: "/media/company/team-1.jpg" }])).success,
    ).toBe(false);
  });
});
