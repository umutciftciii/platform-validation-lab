// ML-2 (DP-074, ADR-028 D6/D7): addresses per language, translation drafts, structure warnings
// and translation state.
import { describe, expect, it } from "vitest";
import {
  CMS_LOCALE_PREFIX_DEFAULT,
  CmsPageResponseSchema,
  CmsPageSummarySchema,
  CmsTemplateContentSchema,
  CmsTranslationCreateRequestSchema,
  cmsAddressLocale,
  cmsLocaleAddress,
  cmsStructureWarnings,
  cmsTranslationDraft,
  cmsTranslationOutdated,
  cmsTranslationSlugSchema,
  cmsTranslationState,
} from "../src/index.js";

describe("addresses per language", () => {
  it("keeps the default language unprefixed until ML-3, every other language under its prefix", () => {
    expect(CMS_LOCALE_PREFIX_DEFAULT).toBe(false);
    expect(cmsLocaleAddress("/about-us", "en", "en")).toBe("/about-us");
    expect(cmsLocaleAddress("/", "en", "en")).toBe("/");
    expect(cmsLocaleAddress("/over-ons", "nl", "en")).toBe("/nl/over-ons");
    expect(cmsLocaleAddress("/", "nl", "en")).toBe("/nl");
    expect(cmsLocaleAddress("/news/x", "nl", "en")).toBe("/nl/news/x");
    // Prepared for ML-3: the default language prefixed too.
    expect(cmsLocaleAddress("/about-us", "en", "en", true)).toBe("/en/about-us");
  });

  it("reads the language back from an address", () => {
    const tags = ["en", "nl"];
    expect(cmsAddressLocale("/over-ons", tags, "en")).toEqual({ locale: "en", path: "/over-ons" });
    expect(cmsAddressLocale("/nl/over-ons", tags, "en")).toEqual({
      locale: "nl",
      path: "/over-ons",
    });
    expect(cmsAddressLocale("/nl", tags, "en")).toEqual({ locale: "nl", path: "/" });
    // An old-site /en/... address is not an English page address while English is unprefixed.
    expect(cmsAddressLocale("/en/about-us", tags, "en")).toEqual({
      locale: "en",
      path: "/en/about-us",
    });
    expect(cmsAddressLocale("/tr/x", tags, "en")).toEqual({ locale: "en", path: "/tr/x" });
    expect(cmsAddressLocale("/en/about-us", tags, "en", true)).toEqual({
      locale: "en",
      path: "/about-us",
    });
    expect(cmsAddressLocale("/about-us", tags, "en", true)).toBeNull();
  });
});

describe("translation drafts", () => {
  it("TEMPLATE pages keep section ids, types, links and images; texts are emptied", () => {
    const content = {
      sections: [
        {
          id: "sec-hero-001",
          type: "hero",
          eyebrow: "Since 1990",
          title: "About",
          intro: "Who we are",
          cta: { label: "Contact", href: "/contact" },
        },
        {
          id: "sec-cards-02",
          type: "cards",
          title: "Services",
          items: [{ title: "Storage", description: "Tanks" }],
        },
      ],
    };
    const draft = cmsTranslationDraft({ kind: "TEMPLATE", templateKey: "standard" }, content);
    const [hero, cards] = draft["sections"] as Record<string, unknown>[];
    expect(hero).toEqual({
      id: "sec-hero-001",
      type: "hero",
      eyebrow: "",
      title: "",
      intro: "",
      cta: { label: "", href: "/contact" },
    });
    expect(cards?.["id"]).toBe("sec-cards-02");
    expect(JSON.stringify(draft)).not.toMatch(/Storage|Tanks|Services|About|Who we are/);
    // The emptied draft is not publishable as is (required texts), so it cannot go live by mistake.
    expect(CmsTemplateContentSchema.safeParse(draft).success).toBe(false);
    // The source is never modified.
    expect((content.sections[0] as { title: string }).title).toBe("About");
  });

  it("articles keep their cover image and empty the summary and alt text", () => {
    const draft = cmsTranslationDraft(
      { kind: "TEMPLATE", templateKey: "article" },
      {
        excerpt: "Summary",
        coverImage: "/media/x.webp",
        coverAlt: "A tank",
        sections: [{ id: "sec-text-0001", type: "text", title: "T", body: "B" }],
      },
    );
    expect(draft).toMatchObject({ excerpt: "", coverImage: "/media/x.webp", coverAlt: "" });
    expect(draft["sections"]).toEqual([{ id: "sec-text-0001", type: "text", title: "", body: "" }]);
  });

  it("menus keep targets, URLs and switches; labels and texts are emptied", () => {
    const draft = cmsTranslationDraft(
      { kind: "FRAGMENT", templateKey: "bv.site-nav" },
      {
        items: [
          {
            label: "About",
            target: { type: "page", pageId: "0190f2a1-0000-7000-8000-000000000001" },
            newTab: false,
            visible: true,
            children: [{ label: "Team", target: { type: "path", path: "/team" } }],
          },
        ],
        contact: { label: "Contact", target: { type: "url", url: "https://x.example" } },
        noScriptLinks: [],
        pendingNote: "Soon",
      },
    );
    expect(draft).toEqual({
      items: [
        {
          label: "",
          target: { type: "page", pageId: "0190f2a1-0000-7000-8000-000000000001" },
          newTab: false,
          visible: true,
          children: [{ label: "", target: { type: "path", path: "/team" } }],
        },
      ],
      contact: { label: "", target: { type: "url", url: "https://x.example" } },
      noScriptLinks: [],
      pendingNote: "",
    });
  });
});

describe("structure warnings", () => {
  const a = {
    sections: [
      { id: "s-hero-0001", type: "hero", title: "A", cta: { label: "x", href: "/c" } },
      { id: "s-text-0002", type: "text", body: "B" },
    ],
  };
  it("texts never count; sections, links and images do", () => {
    const sameShape = {
      sections: [
        { id: "s-hero-0001", type: "hero", title: "Ander", cta: { label: "y", href: "/c" } },
        { id: "s-text-0002", type: "text", body: "Tekst" },
      ],
    };
    expect(cmsStructureWarnings(a, sameShape)).toEqual([]);
    expect(cmsStructureWarnings(a, { sections: [a.sections[0]] })).toEqual(
      expect.arrayContaining(["sections", "lists"]),
    );
    const otherLink = {
      sections: [{ ...a.sections[0], cta: { label: "x", href: "/d" } }, a.sections[1]],
    };
    expect(cmsStructureWarnings(a, otherLink)).toEqual(["links"]);
    expect(
      cmsStructureWarnings({ coverImage: "/media/a.webp" }, { coverImage: "/media/b.webp" }),
    ).toEqual(["images"]);
  });
});

describe("translation state", () => {
  it("missing, draft, published, outdated", () => {
    expect(cmsTranslationState({ exists: false, published: false, outdated: false })).toBe(
      "missing",
    );
    expect(cmsTranslationState({ exists: true, published: false, outdated: true })).toBe("draft");
    expect(cmsTranslationState({ exists: true, published: true, outdated: false })).toBe(
      "published",
    );
    expect(cmsTranslationState({ exists: true, published: true, outdated: true })).toBe("outdated");
  });
  it("outdated when the source has a newer revision than the one the translation was made from", () => {
    expect(cmsTranslationOutdated(1, 1)).toBe(false);
    expect(cmsTranslationOutdated(1, 2)).toBe(true);
    expect(cmsTranslationOutdated(null, 1)).toBe(true);
    expect(cmsTranslationOutdated(null, null)).toBe(false);
  });
  it("responses of an older API still parse (defaults)", () => {
    const summary = CmsPageSummarySchema.parse({
      id: "0190f2a1-0000-7000-8000-000000000001",
      siteId: "0190f2a1-0000-7000-8000-000000000002",
      kind: "TEMPLATE",
      templateKey: "standard",
      path: "/x",
      title: "X",
      locale: "en",
      sectionCount: 0,
      version: 1,
      updatedAt: "2026-11-20T12:00:00.000Z",
      updatedBy: { id: "0190f2a1-0000-7000-8000-000000000003", name: "E" },
      publication: null,
    });
    expect(summary.translations).toEqual([]);
    expect(summary.translationGroupId).toBeUndefined();
    expect(CmsPageResponseSchema.shape.translations.parse(undefined)).toEqual([]);
  });
});

describe("requests", () => {
  it("validates the create request and the slug per kind", () => {
    expect(
      CmsTranslationCreateRequestSchema.safeParse({ locale: "nl", title: "Over ons" }).success,
    ).toBe(true);
    expect(CmsTranslationCreateRequestSchema.safeParse({ locale: "NL", title: "x" }).success).toBe(
      false,
    );
    expect(CmsTranslationCreateRequestSchema.safeParse({ locale: "nl", title: " " }).success).toBe(
      false,
    );
    expect(cmsTranslationSlugSchema(false).safeParse("over-ons").success).toBe(true);
    expect(cmsTranslationSlugSchema(false).safeParse("nl").success).toBe(false);
    expect(cmsTranslationSlugSchema(true).safeParse("nieuws-1").success).toBe(true);
  });
});
