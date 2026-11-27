// COM-5 (DP-038, DP-327): the corporate content of the live site — seven content pages and 19
// news articles in English as import seeds, their Turkish proposals for "Create translation",
// and the rules of the import: valid on the corporate site, no unconfirmed claim, no image, every
// link to a page of the corporate import set, original dates kept per language.
import { describe, expect, it } from "vitest";
import {
  CMS_SITE_REGISTRY,
  CORPORATE_CONTENT_REGISTRY,
  CORPORATE_TR_PROPOSAL_INDEX,
  CmsArticleSlugSchema,
  cmsArticleContentSchema,
  cmsContentTexts,
  cmsCorporateTrPlace,
  cmsDesignTemplate,
  cmsSlugOfPath,
  cmsTemplateContentSchema,
  type CmsArticleContent,
} from "@dream/contracts";
import { contentIsValid } from "../../../src/cms/cms-content.js";
import { CMS_SEEDS } from "../../../src/cms/seed/bv.js";
import { CMS_ARTICLE_SEEDS, CMS_PAGE_SEEDS } from "../../../src/cms/seed/bv-pages.js";
import { CORPORATE_SEEDS } from "../../../src/cms/seed/corporate.js";
import { CORPORATE_ARTICLE_SEEDS } from "../../../src/cms/seed/corporate-articles.js";
import { CORPORATE_PAGE_SEEDS } from "../../../src/cms/seed/corporate-pages.js";
import { CORPORATE_TR_PROPOSALS } from "../../../src/cms/seed/corporate-tr.js";
import { corporateSeedMenuTargets } from "../../../src/cms/seed/menu-targets.js";

const UNCONFIRMED =
  /Feitian|distributor|distribütör|\b\d+\s*(\+|%)|%\s?\d+|world[- ]class|guarantee|garanti|production of base oils|1M\+/i;
const corporatePaths = new Set(
  CMS_SITE_REGISTRY.filter((e) => e.site === "CORPORATE" && e.path).map((e) => e.path as string),
);

/** Every href in a content tree. */
function hrefs(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => hrefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "href" && typeof x === "string") out.push(x);
      else hrefs(x, out);
    }
  }
  return out;
}

describe("corporate content pages (COM-5)", () => {
  it("has the seven live pages, imported into the corporate site at their registry path", () => {
    expect(Object.keys(CORPORATE_PAGE_SEEDS).sort()).toEqual(
      [
        "corporate.about-us",
        "corporate.energy-trading",
        "corporate.logistics",
        "corporate.our-team",
        "corporate.storage-distribution",
        "corporate.strategic-partnership",
        "corporate.sustainability",
      ].sort(),
    );
    for (const [key, seed] of Object.entries(CORPORATE_PAGE_SEEDS)) {
      expect(CMS_PAGE_SEEDS[key]).toBe(seed);
      expect(CORPORATE_CONTENT_REGISTRY.find((e) => e.key === key)?.path).toBe(`/${seed.slug}`);
      expect(cmsTemplateContentSchema("CORPORATE").parse(seed.content), key).toEqual(seed.content);
    }
  });

  it("carries no figure, superlative or commitment that waits for the owner (DP-003), no image", () => {
    const text = JSON.stringify(CORPORATE_PAGE_SEEDS);
    expect(text).not.toMatch(UNCONFIRMED);
    expect(text).not.toMatch(/\/media\/|\.jpe?g|\.png|\.webp/);
    expect(JSON.stringify(CORPORATE_TR_PROPOSALS)).not.toMatch(
      /Feitian|tek resmi|dünya standartlarında/i,
    );
  });

  it("links only to pages of the corporate import set (no broken link once they are published)", () => {
    const all = [
      ...Object.values(CORPORATE_PAGE_SEEDS),
      CMS_PAGE_SEEDS["corporate.contact"],
      ...["corporate.home", "corporate.products"].map((k) => CORPORATE_SEEDS[k]),
    ];
    for (const href of hrefs(all)) {
      if (!href.startsWith("/")) continue;
      const path = href.split("#")[0] || "/";
      expect(corporatePaths.has(path), href).toBe(true);
    }
  });

  it("keeps the live contact page's texts and the news list's live heading", () => {
    const contact = CMS_PAGE_SEEDS["corporate.contact"]!.content.sections;
    expect(contact[0]).toMatchObject({ type: "hero", title: "Contact Us" });
    expect(contact[1]).toMatchObject({ type: "contact", formTitle: "Get In Touch" });
    expect(CORPORATE_SEEDS["corporate.news-index"]!.content).toMatchObject({
      title: "News & Insights",
      intro:
        "Industry updates, market commentary and operational news from the Dream Petroleum team.",
    });
  });
});

describe("corporate news articles (COM-5, DP-327)", () => {
  const entries = Object.entries(CORPORATE_ARTICLE_SEEDS);

  it("has the 19 live posts, valid as corporate articles, each with its original date", () => {
    expect(entries).toHaveLength(19);
    for (const [key, seed] of entries) {
      expect(CMS_ARTICLE_SEEDS[key]).toBe(seed);
      expect(CmsArticleSlugSchema.parse(seed.slug)).toBe(seed.slug);
      const parsed = cmsArticleContentSchema("CORPORATE").parse(seed.content);
      expect(parsed, key).toEqual(seed.content);
      expect(seed.content.originalDate, key).toMatch(/^2026-(0[4-8])-\d{2}$/);
      expect(seed.content.coverImage).toBeNull();
      expect(seed.content.excerpt.length).toBeLessThanOrEqual(400);
      expect(contentIsValid("TEMPLATE", "article", seed.content, "CORPORATE")).toBe(true);
    }
    const dates = entries.map(([, s]) => s.content.originalDate);
    expect(dates.slice().sort()[0]).toBe("2026-04-16");
    expect(dates.slice().sort().at(-1)).toBe("2026-08-13");
  });

  it("keeps the shortened slugs unique and within the limit", () => {
    const slugs = entries.map(([, s]) => s.slug);
    expect(new Set(slugs).size).toBe(19);
    expect(slugs.every((s) => s.length <= 80)).toBe(true);
  });
});

describe("Turkish proposals (COM-5)", () => {
  it("has one proposal per corporate source page, article and menu, and its index", () => {
    expect(Object.keys(CORPORATE_TR_PROPOSAL_INDEX).sort()).toEqual(
      Object.keys(CORPORATE_TR_PROPOSALS).sort(),
    );
    expect(Object.keys(CORPORATE_TR_PROPOSALS)).toHaveLength(7 + 19 + 1 + 6);
    for (const [key, seed] of Object.entries(CORPORATE_PAGE_SEEDS)) {
      const place = cmsCorporateTrPlace({
        kind: "TEMPLATE",
        templateKey: "standard",
        path: `/${seed.slug}`,
      });
      expect(CORPORATE_TR_PROPOSALS[place], key).toBeDefined();
    }
  });

  it("is valid Turkish content of the same kind, with the Turkish slug and original date", () => {
    for (const [place, p] of Object.entries(CORPORATE_TR_PROPOSALS)) {
      const [templateKey, path] = place.includes("|") ? place.split("|") : [place, null];
      if (templateKey === "article") {
        const c = cmsArticleContentSchema("CORPORATE").parse(p.content) as CmsArticleContent;
        expect(c.originalDate, place).toMatch(/^2026-\d{2}-\d{2}$/);
        expect(CmsArticleSlugSchema.parse(p.slug)).toBe(p.slug);
        // Turkish text, not the English one.
        const en = Object.values(CORPORATE_ARTICLE_SEEDS).find((s) => `/news/${s.slug}` === path)!;
        expect(c.excerpt).not.toBe(en.content.excerpt);
      } else if (templateKey === "standard") {
        expect(cmsTemplateContentSchema("CORPORATE").safeParse(p.content).success, place).toBe(
          true,
        );
      } else {
        const t = cmsDesignTemplate(templateKey!)!;
        const texts = cmsContentTexts({ kind: t.kind, templateKey: t.key }, p.content);
        // Every text of a designed page or menu has its Turkish counterpart (one gap: the news
        // list's empty state, which the live site does not have).
        const empty = texts.filter((x) => x.value === "").map((x) => x.path);
        expect(empty, place).toEqual(
          templateKey === "corporate.news-index" ? ["empty.title", "empty.text"] : [],
        );
      }
    }
  });

  it("keeps each language's own original date (the first five live posts differ)", () => {
    const differ = Object.values(CORPORATE_ARTICLE_SEEDS).filter((s) => {
      const tr = CORPORATE_TR_PROPOSALS[`article|/news/${s.slug}`]!;
      return (tr.content as { originalDate: string }).originalDate !== s.content.originalDate;
    });
    expect(differ).toHaveLength(5);
  });

  it("starts the Turkish contact page at its Turkish address", () => {
    expect(CORPORATE_TR_PROPOSALS["standard|/contact"]).toMatchObject({
      title: "Bize Ulaşın",
      slug: "iletisim",
    });
    expect(cmsSlugOfPath("/news/x")).toBe("x");
    expect(CMS_SEEDS).toBeDefined();
  });
});

describe("corporate menu targets on import (COM-5)", () => {
  const nav = CORPORATE_SEEDS["corporate.site-nav"]!.content;
  const footer = CORPORATE_SEEDS["corporate.site-footer"]!.content;
  const targets = (v: unknown, out: unknown[] = []): unknown[] => {
    if (Array.isArray(v)) v.forEach((x) => targets(x, out));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "target") out.push(x);
        else targets(x, out);
      }
    return out;
  };

  it("points every menu link at the imported page of its address", () => {
    const pages = new Map([...corporatePaths].map((p, i) => [p, `page-${i}`]));
    for (const content of [nav, footer]) {
      const resolved = targets(corporateSeedMenuTargets(content, pages)) as {
        type: string;
        path?: string;
      }[];
      // Page references, the privacy policy's address, mail links and the submenu parents only.
      for (const t of resolved) {
        if (t.type === "path") expect(t.path).toBe("/privacy");
        else expect(["page", "none", "url"]).toContain(t.type);
      }
    }
    const resolvedNav = targets(corporateSeedMenuTargets(nav, pages)) as { type: string }[];
    expect(resolvedNav.filter((t) => t.type === "page").length).toBeGreaterThanOrEqual(11);
  });

  it("makes a link to a page that is not imported yet 'not ready', never a broken address", () => {
    const resolved = targets(corporateSeedMenuTargets(nav, new Map([["/", "home"]]))) as {
      type: string;
      pageId?: string;
    }[];
    expect(resolved.filter((t) => t.type === "page")).toEqual(
      expect.arrayContaining([{ type: "page", pageId: "home" }]),
    );
    expect(resolved.every((t) => t.type === "page" || t.type === "none")).toBe(true);
  });
});
