// CMS S2 (DP-134, ADR-020 D7): the import seeds of the BV site and the signed preview tokens.
import { describe, expect, it } from "vitest";
import {
  CMS_ARTICLE_SECTION_TYPES,
  CMS_DESIGN_TEMPLATES,
  CMS_RESERVED_SLUGS,
  CmsArticleContentSchema,
  CmsArticleSlugSchema,
  cmsArticlePath,
  cmsIsArticle,
  cmsSlugOfPath,
  CMS_SITE_REGISTRY,
  CmsSlugSchema,
  CmsTemplateContentSchema,
  cmsAsset,
  cmsPathForSlug,
  cmsFieldsSchema,
  type BvHomeContent,
} from "@dream/contracts";
import {
  PREVIEW_TTL_MS,
  assertSiteImage,
  contentIsValid,
  issuePreviewToken,
  validateContent,
  verifyPreviewToken,
} from "../../../src/cms/cms-content.js";
import { BV_FOOTER_SEED, BV_HOME_SEED, BV_NAV_SEED, CMS_SEEDS } from "../../../src/cms/seed/bv.js";
import { CMS_ARTICLE_SEEDS, CMS_PAGE_SEEDS } from "../../../src/cms/seed/bv-pages.js";
import {
  CORPORATE_FOOTER_SEED,
  CORPORATE_HOME_SEED,
  CORPORATE_NAV_SEED,
  CORPORATE_PRODUCTS_SEED,
  CORPORATE_SEEDS,
  CORPORATE_SITE_SEO_SEED,
} from "../../../src/cms/seed/corporate.js";

/** COM-1: the import sources of both sites (the API merges them the same way). */
const ALL_SEEDS = { ...CMS_SEEDS, ...CORPORATE_SEEDS };

describe("BV import seeds", () => {
  it("has exactly one seed per designed template, and each validates unchanged", () => {
    expect(Object.keys(ALL_SEEDS).sort()).toEqual(CMS_DESIGN_TEMPLATES.map((t) => t.key).sort());
    for (const t of CMS_DESIGN_TEMPLATES) {
      const seed = ALL_SEEDS[t.key]!.content;
      const parsed = (t.schema ?? cmsFieldsSchema(t.fields)).safeParse(seed);
      expect(parsed.success, `${t.key}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(
        true,
      );
      // Validation keeps the content as it was (no trimming or defaults change a word); DP-219:
      // the menus only gain their defaults (visible, same tab, no submenu, no social links).
      if (t.schema) expect(parsed.data).toMatchObject(seed as object);
      else expect(parsed.data).toEqual(seed);
    }
  });

  it("COM-1: the corporate fragments carry only what the live site shows", () => {
    // Every corporate seed is a corporate fragment of the registry (imported into that site only).
    for (const key of Object.keys(CORPORATE_SEEDS)) {
      expect(CMS_DESIGN_TEMPLATES.find((t) => t.key === key)?.site, key).toBe("CORPORATE");
    }
    // Pages that do not exist on the new site yet are "not ready yet" (text), never a guessed path.
    const targets = [
      ...CORPORATE_NAV_SEED.items.flatMap((i) => [i, ...(i.children ?? [])]),
      CORPORATE_NAV_SEED.contact,
    ].map((l) => l.target);
    expect(targets.filter((t) => t.type === "path")).toEqual([{ type: "path", path: "/" }]);
    expect(targets.filter((t) => t.type !== "path").every((t) => t.type === "none")).toBe(true);
    expect(CORPORATE_FOOTER_SEED.contact.email.href).toBe("mailto:info@dreampetroleum.com");
    expect(CORPORATE_FOOTER_SEED.contact.phone.href).toBe("tel:+902122181357");
    // No claim of the live site that needs the owner's confirmation (DP-003) is in a fragment.
    expect(JSON.stringify(CORPORATE_SEEDS)).not.toMatch(/Feitian|only official|tek resmi/i);
    // No default image: the corporate site has no media of its own yet.
    expect(CORPORATE_SITE_SEO_SEED.defaultOgImage).toBeNull();
  });

  it("COM-3: the corporate news heading is a valid corporate design seed without claims", () => {
    const key = "corporate.news-index";
    expect(CMS_DESIGN_TEMPLATES.find((x) => x.key === key)).toMatchObject({
      site: "CORPORATE",
      kind: "DESIGN",
      path: "/news",
    });
    expect(validateContent("DESIGN", key, ALL_SEEDS[key]!.content, "CORPORATE")).toEqual(
      ALL_SEEDS[key]!.content,
    );
    expect(ALL_SEEDS[key]!.content).toMatchObject({ eyebrow: "Blogs", title: "News & Insights" });
    expect(JSON.stringify(ALL_SEEDS[key])).not.toMatch(/\d|Feitian|official|leading|guarantee/i);
  });

  it("COM-2b: the corporate home and portfolio carry no unconfirmed claim", () => {
    for (const key of ["corporate.home", "corporate.products"]) {
      const t = CMS_DESIGN_TEMPLATES.find((x) => x.key === key)!;
      expect(t).toMatchObject({ site: "CORPORATE", kind: "DESIGN" });
      // With the corporate site's own rules (no image fields at all).
      expect(validateContent("DESIGN", key, ALL_SEEDS[key]!.content, "CORPORATE")).toEqual(
        ALL_SEEDS[key]!.content,
      );
    }
    const text = JSON.stringify([CORPORATE_HOME_SEED, CORPORATE_PRODUCTS_SEED]);
    // Owner decisions 2026-11-27 (DP-003): no distributorship claim, counter, percentage,
    // testimonial or FAQ commitment; no certification, purity or guarantee statement (DP-002).
    for (const claim of [
      /Feitian|official distributor|only official/i,
      /\d+\s*(\+|%|K\+)/,
      /Daniel Foster|Ahmed Al Mansouri|Michael Chen|Business Partner|Procurement Director/,
      /minimum order|MOQ|Letter of Credit|\bLC\b|SGS|Incoterms|\bFOB\b|\bCIF\b|\bDAP\b/,
      /ASTM|\bISO\b|certified|purity|food grade|guarantee|world-class|terminal/i,
    ]) {
      expect(text, String(claim)).not.toMatch(claim);
    }
    // The typical values table stays hidden: no row until its source is approved.
    expect(CORPORATE_PRODUCTS_SEED.typicalValues.rows).toEqual([]);
    // Links lead only to pages of this package (/products and its sections) or to the contact
    // page; pages that do not exist yet (About Us, the services) are not linked.
    const anchors = new Set(CORPORATE_PRODUCTS_SEED.groups.map((g) => g.anchor));
    const hrefs = [...text.matchAll(/"href":"([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const [path, anchor] = href.split("#");
      expect(["/contact", "/products"], href).toContain(path);
      if (anchor) expect(anchors.has(anchor), href).toBe(true);
    }
    expect(CORPORATE_PRODUCTS_SEED.coa.button.href).toBe("/contact");
  });

  it("keeps the claims and disclosures the source documents require", () => {
    const home: BvHomeContent = BV_HOME_SEED;
    expect(home.applications.status).toBe("Pending Technical Validation");
    expect(
      home.applications.scenes.every((s) => s.disclosure.startsWith("AI-generated concept image")),
    ).toBe(true);
    expect(home.hero.applications.at(-1)?.description).toContain("must be confirmed by testing");
    expect(home.productGroups.groups.find((g) => g.anchor === "group-3-plus")?.note).toContain(
      "not a separate API group",
    );
    expect(home.services.disclosure).toContain("do not show Dream Petroleum facilities");
    expect(home.ctl.stages.every((s) => s.disclosure.length > 0)).toBe(true);
  });

  it("uses only registered assets of the right kind", () => {
    const images = [
      ...BV_HOME_SEED.hero.applications.map((a) => a.image),
      ...BV_HOME_SEED.productGroups.groups.map((g) => g.poster),
      ...BV_HOME_SEED.services.items.flatMap((s) => [s.desktopImage, s.mobileImage]),
      ...BV_HOME_SEED.ctl.stages.map((s) => s.image),
      ...BV_HOME_SEED.applications.scenes.flatMap((s) => [s.image, s.imageSmall]),
    ];
    for (const src of images) expect(cmsAsset(src)?.kind, src).toBe("image");
    for (const g of BV_HOME_SEED.productGroups.groups)
      expect(cmsAsset(g.animation)?.kind).toBe("animation");
  });

  it("keeps the official contact details and pending pages as plain text", () => {
    expect(BV_FOOTER_SEED.contact.phone.href).toBe("tel:+31202101350");
    expect(BV_FOOTER_SEED.contact.email.href).toBe("mailto:info@dreampetroleumbv.com");
    const path = (l: { target: unknown } | undefined) =>
      (l?.target as { path?: string } | undefined)?.path ?? null;
    // DP-153: "Blogs" leads to the news list.
    expect(BV_NAV_SEED.items.filter((i) => i.target.type === "none")).toEqual([]);
    expect(path(BV_NAV_SEED.items.find((i) => i.label === "Blogs"))).toBe("/news");
    // DP-155: "Products" leads to the catalogue, with and without JavaScript.
    expect(path(BV_NAV_SEED.items.find((i) => i.label === "Products"))).toBe("/products");
    expect(path(BV_NAV_SEED.noScriptLinks.find((i) => i.label === "Products"))).toBe("/products");
    expect(
      BV_NAV_SEED.noScriptLinks.every((l) => path(l)?.startsWith("/") || path(l) === "#top"),
    ).toBe(true);
  });

  it("reports invalid content with content.* paths", () => {
    let error: unknown;
    try {
      validateContent("DESIGN", "bv.home", {
        ...BV_HOME_SEED,
        hero: { ...BV_HOME_SEED.hero, brand: "" },
      });
    } catch (e) {
      error = e;
    }
    expect(JSON.stringify(error)).toContain("content.hero.brand");
  });
});

describe("BV content page seeds (DP-135)", () => {
  const seeds = Object.entries(CMS_PAGE_SEEDS);

  it("has one seed per importable content page of the registry, at the registry path", () => {
    // News articles (DP-206) have their own seeds below.
    const importable = CMS_SITE_REGISTRY.filter(
      (e) => e.kind === "TEMPLATE" && e.importable && !e.path?.startsWith("/news/"),
    );
    expect(seeds.map(([k]) => k).sort()).toEqual(importable.map((e) => e.key).sort());
    for (const [key, seed] of seeds) {
      expect(CmsSlugSchema.parse(seed.slug), key).toBe(seed.slug);
      expect(cmsPathForSlug(seed.slug)).toBe(importable.find((e) => e.key === key)?.path);
    }
  });

  it("validates unchanged as template content, with registered images only", () => {
    for (const [key, seed] of seeds) {
      const parsed = CmsTemplateContentSchema.safeParse(seed.content);
      expect(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(
        true,
      );
      expect(parsed.data).toEqual(seed.content);
      for (const s of seed.content.sections) {
        if (s.type === "split") expect(cmsAsset(s["image"] as string)?.kind, key).toBe("image");
      }
    }
  });

  it("keeps the CGI disclosure, drops the leftover brand and the unsourced growth figure", () => {
    const text = JSON.stringify(CMS_PAGE_SEEDS);
    expect(text).not.toContain("Dream Chemicals");
    expect(text).not.toContain("+12%");
    expect(text).not.toContain("contact-us.html");
    // Contact buttons go to the contact page here (DP-150), not to the live site.
    expect(text).not.toContain("dreampetroleumbv.com/en/contact");
    expect(JSON.stringify([BV_HOME_SEED, BV_NAV_SEED, BV_FOOTER_SEED])).not.toContain(
      "dreampetroleumbv.com/en/contact",
    );
    for (const [key, seed] of seeds) {
      for (const s of seed.content.sections.filter((x) => x.type === "split")) {
        // CGI renders on the service pages; the live site's own team image (DP-206).
        expect(s["imageNote"], key).toMatch(/^Illustrative (CGI )?image\./);
      }
    }
  });
});

describe("BV company pages and blog post of the live site (DP-206)", () => {
  it("imports the three company pages from the live site", () => {
    for (const key of ["bv.strategic-partnership", "bv.sustainability", "bv.our-team"]) {
      const sections = CMS_PAGE_SEEDS[key]!.content.sections;
      expect(sections[0]?.type, key).toBe("hero");
      expect(sections.at(-1)?.type, key).toBe("cta");
    }
    // The live counters show 0: left out, never shown as figures.
    expect(JSON.stringify(CMS_PAGE_SEEDS["bv.our-team"])).not.toMatch(/Trading Team Experts/);
  });

  it("has one article seed per news entry of the registry, valid as article content", () => {
    const entries = CMS_SITE_REGISTRY.filter((e) => e.path?.startsWith("/news/"));
    expect(Object.keys(CMS_ARTICLE_SEEDS).sort()).toEqual(entries.map((e) => e.key).sort());
    for (const [key, seed] of Object.entries(CMS_ARTICLE_SEEDS)) {
      expect(CmsArticleSlugSchema.parse(seed.slug), key).toBe(seed.slug);
      expect(cmsArticlePath(seed.slug)).toBe(entries.find((e) => e.key === key)?.path);
      const parsed = CmsArticleContentSchema.safeParse(seed.content);
      expect(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(
        true,
      );
      expect(parsed.data).toEqual(seed.content);
      expect(cmsAsset(seed.content.coverImage!)?.kind, key).toBe("image");
      // Publishable: a summary and at least one body section (DP-020).
      expect(seed.content.excerpt.length).toBeGreaterThan(0);
      expect(seed.content.sections.length).toBeGreaterThan(0);
    }
  });

  it("points the footer's company links at the pages here, not at the live site", () => {
    const footer = JSON.stringify(BV_FOOTER_SEED);
    expect(footer).not.toContain("dreampetroleumbv.com/en/");
    for (const href of ["/strategic-partnership", "/sustainability", "/our-team", "/news"]) {
      expect(footer).toContain(`"path":"${href}"`);
    }
  });
});

describe("preview tokens", () => {
  const key = Buffer.alloc(32, 7);
  const page = "0190f2a1-0000-7000-8000-000000000000";
  const now = new Date("2026-11-13T12:00:00Z");

  it("verifies for its page and site within 15 minutes", () => {
    const { token, expiresAt } = issuePreviewToken(key, page, "BV", now);
    expect(expiresAt.getTime() - now.getTime()).toBe(PREVIEW_TTL_MS);
    expect(verifyPreviewToken(key, token, "BV", now)).toBe(page);
    expect(verifyPreviewToken(key, token, "BV", new Date(now.getTime() + PREVIEW_TTL_MS - 1))).toBe(
      page,
    );
  });

  it("refuses another site, expiry, another key and any change", () => {
    const { token } = issuePreviewToken(key, page, "BV", now);
    expect(verifyPreviewToken(key, token, "CORPORATE", now)).toBeNull();
    expect(
      verifyPreviewToken(key, token, "BV", new Date(now.getTime() + PREVIEW_TTL_MS)),
    ).toBeNull();
    expect(verifyPreviewToken(Buffer.alloc(32, 8), token, "BV", now)).toBeNull();
    const other = token.replace(page, "0190f2a1-0000-7000-8000-000000000001");
    expect(verifyPreviewToken(key, other, "BV", now)).toBeNull();
    const longer = token.replace(/\.(\d+)\./, (_m, exp: string) => `.${Number(exp) + 86_400_000}.`);
    expect(verifyPreviewToken(key, longer, "BV", now)).toBeNull();
    expect(verifyPreviewToken(key, "v1.x", "BV", now)).toBeNull();
  });
});

describe("news articles (DP-020)", () => {
  const text = { id: "sec-text-0001", type: "text", title: null, body: "Body." };
  const valid = {
    excerpt: "Summary.",
    coverImage: "/media/services-showcase/logistics-desktop.webp",
    coverAlt: "Tank terminal",
    sections: [text],
  };

  it("accepts an article with or without a cover; blank optional fields become null", () => {
    expect(CmsArticleContentSchema.parse(valid)).toEqual(valid);
    expect(
      CmsArticleContentSchema.parse({ ...valid, coverImage: "", coverAlt: " ", sections: [] }),
    ).toEqual({ excerpt: "Summary.", coverImage: null, coverAlt: null, sections: [] });
  });

  it("requires a summary, alt text with a cover, registered images and body section types", () => {
    expect(CmsArticleContentSchema.safeParse({ ...valid, excerpt: " " }).success).toBe(false);
    expect(CmsArticleContentSchema.safeParse({ ...valid, coverAlt: null }).success).toBe(false);
    expect(
      CmsArticleContentSchema.safeParse({ ...valid, coverImage: "/media/unknown.webp" }).success,
    ).toBe(false);
    for (const type of ["hero", "contact"]) {
      expect(CMS_ARTICLE_SECTION_TYPES).not.toContain(type);
      expect(
        CmsArticleContentSchema.safeParse({ ...valid, sections: [{ id: "sec-x-00001", type }] })
          .success,
      ).toBe(false);
    }
    expect(CmsArticleContentSchema.safeParse({ ...valid, category: "x" }).success).toBe(false);
  });

  it("puts articles under /news/ and keeps news away from template page slugs", () => {
    expect(cmsArticlePath(CmsArticleSlugSchema.parse(" Market-Update "))).toBe(
      "/news/market-update",
    );
    expect(CmsArticleSlugSchema.safeParse("a/b").success).toBe(false);
    expect(cmsSlugOfPath("/news/market-update")).toBe("market-update");
    expect(cmsSlugOfPath("/about-us")).toBe("about-us");
    expect(CMS_RESERVED_SLUGS).toContain("news");
    expect(CmsSlugSchema.safeParse("news").success).toBe(false);
    expect(cmsIsArticle({ kind: "TEMPLATE", templateKey: "article" })).toBe(true);
    expect(cmsIsArticle({ kind: "TEMPLATE", templateKey: "standard" })).toBe(false);
    expect(validateContent("TEMPLATE", "article", valid)).toEqual(valid);
  });
});

describe("site-scoped media (COM-2a, DP-320)", () => {
  const BV_IMAGE = "/media/services-showcase/logistics-desktop.webp";
  const page = (image: string | null, imageAlt: string | null) => ({
    sections: [
      {
        id: "sec-com2a-01",
        type: "split",
        eyebrow: null,
        title: "Logistics",
        body: "Sea and road.",
        image,
        imageAlt,
        imageNote: null,
      },
    ],
  });

  it("refuses a BV file on a corporate page (400 content.<path> asset)", () => {
    expect(() =>
      validateContent("TEMPLATE", "standard", page(BV_IMAGE, "Alt"), "CORPORATE"),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(validateContent("TEMPLATE", "standard", page(BV_IMAGE, "Alt"), "BV")).toBeTruthy();
  });

  it("a corporate split section without an image is valid; on BV it is not", () => {
    expect(contentIsValid("TEMPLATE", "standard", page(null, null), "CORPORATE")).toBe(true);
    expect(contentIsValid("TEMPLATE", "standard", page(null, null), "BV")).toBe(false);
  });

  it("the link-preview image is the page's own site's file", () => {
    expect(() => assertSiteImage(BV_IMAGE, "BV")).not.toThrow();
    expect(() => assertSiteImage(null, "CORPORATE")).not.toThrow();
    expect(() => assertSiteImage(BV_IMAGE, "CORPORATE")).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("every import seed uses its own site's files only", () => {
    for (const [key, seed] of Object.entries(ALL_SEEDS)) {
      const site = key.startsWith("corporate.") ? "CORPORATE" : "BV";
      const t = CMS_DESIGN_TEMPLATES.find((x) => x.key === key);
      if (!t) continue;
      expect(contentIsValid(t.kind, key, seed.content, site), key).toBe(true);
    }
    for (const [key, seed] of Object.entries(CMS_PAGE_SEEDS)) {
      expect(contentIsValid("TEMPLATE", "standard", seed.content, "BV"), key).toBe(true);
    }
  });
});
