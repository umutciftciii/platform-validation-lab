// ML-13a (DP-244, ADR-028 D13): translation package format, unit keys and the CMS text slots
// (the same texts "Create translation" empties).
import { describe, expect, it } from "vitest";
import {
  TRANSLATION_PACKAGE_BODY_PATH,
  TRANSLATION_PACKAGE_MAX_BODY_BYTES,
  TranslationExportQuerySchema,
  TranslationImportReportSchema,
  TranslationImportRequestSchema,
  TranslationPackageSchema,
  cmsContentTexts,
  cmsTranslationDraft,
  cmsWithContentTexts,
  parseTranslationUnitKey,
  translationUnitKey,
  translationUnitType,
  type TranslationPackage,
  type TranslationUnit,
} from "../src/index.js";

const SITE = "0190f2a1-0000-7000-8000-00000000000a";
const GROUP = "0190f2a1-0000-7000-8000-000000000001";
const LISTING = "0190f2a1-0000-7000-8000-000000000002";
const HASH = "a".repeat(64);

const unit = (over: Partial<TranslationUnit> = {}): TranslationUnit => ({
  key: translationUnitKey("cms", GROUP, "title"),
  kind: "cms",
  context: "/about-us · About us",
  maxLength: 200,
  multiline: false,
  source: "About us",
  sourceHash: HASH,
  current: null,
  currentHash: null,
  target: "Over ons",
  ...over,
});

const pkg = (over: Partial<TranslationPackage> = {}): TranslationPackage => ({
  format: "dream-translation-package",
  version: 1,
  site: { id: SITE, key: "BV" },
  sourceLocale: "en",
  targetLocale: "nl",
  exportedAt: "2026-11-25T10:00:00.000Z",
  types: ["cms", "catalog"],
  pages: [
    {
      groupId: GROUP,
      sourcePageId: GROUP,
      sourceRevisionNumber: 3,
      kind: "TEMPLATE",
      templateKey: "standard",
      path: "/about-us",
      targetPageId: null,
    },
  ],
  units: [unit()],
  ...over,
});

const issues = (value: unknown) => {
  const r = TranslationPackageSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("unit keys", () => {
  it("round-trips kind, id and field; refuses anything else", () => {
    const key = translationUnitKey("cms", GROUP, "content.sections.@sec-hero-001.title");
    expect(parseTranslationUnitKey(key)).toEqual({
      kind: "cms",
      id: GROUP,
      field: "content.sections.@sec-hero-001.title",
    });
    expect(parseTranslationUnitKey(`listing:${LISTING}:seo.title`)?.field).toBe("seo.title");
    expect(parseTranslationUnitKey(`page:${GROUP}:title`)).toBeNull();
    expect(parseTranslationUnitKey(`cms:not-a-uuid:title`)).toBeNull();
    expect(parseTranslationUnitKey(`cms:${GROUP}:has space`)).toBeNull();
    expect(translationUnitType("cms")).toBe("cms");
    expect(translationUnitType("image")).toBe("catalog");
  });
});

describe("package schema (a bad package is refused as a whole)", () => {
  it("accepts a well-formed package", () => {
    expect(issues(pkg())).toEqual([]);
    expect(TranslationImportRequestSchema.safeParse({ package: pkg() }).success).toBe(true);
  });

  it("refuses unknown keys, another format or version, and the same source and target", () => {
    expect(issues({ ...pkg(), extra: 1 }).length).toBeGreaterThan(0);
    expect(issues({ ...pkg(), format: "xliff" }).length).toBeGreaterThan(0);
    expect(issues({ ...pkg(), version: 2 }).length).toBeGreaterThan(0);
    expect(issues(pkg({ targetLocale: "en" }))).toContain("targetLocale:same_as_source");
    expect(issues({ ...pkg(), units: [{ ...unit(), note: "x" }] }).length).toBeGreaterThan(0);
    expect(TranslationImportRequestSchema.safeParse({ package: pkg(), force: true }).success).toBe(
      false,
    );
  });

  it("refuses duplicate keys and groups, units of an undeclared type or unknown page", () => {
    expect(issues(pkg({ units: [unit(), unit()] }))).toContain("units.1.key:duplicate");
    const page = pkg().pages[0]!;
    expect(issues(pkg({ pages: [page, page] }))).toContain("pages.1.groupId:duplicate");
    expect(issues(pkg({ types: ["catalog"] }))).toEqual(
      expect.arrayContaining(["pages:type_not_declared", "units.0.kind:type_not_declared"]),
    );
    expect(issues(pkg({ pages: [] }))).toContain("units.0.key:unknown_page");
  });

  it("refuses a kind that does not match the key and unknown fields", () => {
    expect(issues(pkg({ units: [unit({ kind: "listing" })] }))).toContain(
      "units.0.kind:key_mismatch",
    );
    expect(
      issues(pkg({ units: [unit({ key: translationUnitKey("cms", GROUP, "noindex") })] })),
    ).toContain("units.0.key:unknown_field");
    expect(
      issues(
        pkg({
          units: [unit({ kind: "listing", key: translationUnitKey("listing", LISTING, "sku") })],
        }),
      ),
    ).toContain("units.0.key:unknown_field");
    for (const field of ["title", "summary", "description", "seo.ogDescription"]) {
      expect(
        issues(
          pkg({
            units: [unit({ kind: "listing", key: translationUnitKey("listing", LISTING, field) })],
          }),
        ),
      ).toEqual([]);
    }
  });

  it("refuses a current text without its hash (and the other way round), bad hashes, empty sources and too long texts", () => {
    expect(issues(pkg({ units: [unit({ current: "x" })] }))).toContain(
      "units.0.currentHash:mismatch",
    );
    expect(issues(pkg({ units: [unit({ currentHash: HASH })] }))).toContain(
      "units.0.currentHash:mismatch",
    );
    expect(issues(pkg({ units: [unit({ sourceHash: "XYZ" })] })).length).toBeGreaterThan(0);
    expect(issues(pkg({ units: [unit({ source: "" })] })).length).toBeGreaterThan(0);
    expect(issues(pkg({ units: [unit({ target: "x".repeat(20_001) })] })).length).toBeGreaterThan(
      0,
    );
  });
});

describe("export query and limits", () => {
  it("parses the types list (default both, duplicates folded), refuses unknown ones", () => {
    const q = (types?: string) =>
      TranslationExportQuerySchema.safeParse({ siteId: SITE, locale: "nl", types });
    expect(q().data?.types).toEqual(["cms", "catalog"]);
    expect(q("catalog").data?.types).toEqual(["catalog"]);
    expect(q("cms,cms").data?.types).toEqual(["cms"]);
    expect(q("cms,media").success).toBe(false);
    expect(
      TranslationExportQuerySchema.safeParse({ siteId: SITE, locale: "nl", page: "1" }).success,
    ).toBe(false);
  });

  it("names the two body routes with the larger limit", () => {
    expect(TRANSLATION_PACKAGE_MAX_BODY_BYTES).toBe(4 * 1024 * 1024);
    expect(TRANSLATION_PACKAGE_BODY_PATH.test("/api/v1/admin/translation-packages/import")).toBe(
      true,
    );
    expect(TRANSLATION_PACKAGE_BODY_PATH.test("/api/v1/admin/translation-packages/dry-run")).toBe(
      true,
    );
    expect(TRANSLATION_PACKAGE_BODY_PATH.test("/api/v1/admin/translation-packages/export")).toBe(
      false,
    );
    expect(TRANSLATION_PACKAGE_BODY_PATH.test("/api/v1/admin/translation-packages/import/x")).toBe(
      false,
    );
  });

  it("the report schema accepts a report", () => {
    expect(
      TranslationImportReportSchema.safeParse({
        dryRun: true,
        digest: HASH,
        siteId: SITE,
        sourceLocale: "en",
        targetLocale: "nl",
        canImport: false,
        missingPermissions: ["content:edit"],
        counts: {
          create: 1,
          update: 0,
          unchanged: 0,
          empty: 0,
          outdated: 0,
          conflict: 0,
          invalid: 0,
          not_found: 0,
        },
        pages: [{ groupId: GROUP, targetPageId: null, action: "create", rule: null }],
        units: [{ key: unit().key, status: "create", rule: null }],
        written: {
          cmsPagesCreated: 0,
          cmsPagesUpdated: 0,
          listings: 0,
          categories: 0,
          specs: 0,
          images: 0,
        },
      }).success,
    ).toBe(true);
  });
});

describe("CMS text slots", () => {
  const TEMPLATE = { kind: "TEMPLATE", templateKey: "standard" };
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
        items: [
          { title: "Storage", description: "Tanks" },
          { title: "Trading", description: null },
        ],
      },
    ],
  };

  it("lists every translatable text with a stable path (sections by id), never structure", () => {
    const texts = cmsContentTexts(TEMPLATE, content);
    expect(texts.map((t) => [t.path, t.value])).toEqual([
      ["sections.@sec-hero-001.eyebrow", "Since 1990"],
      ["sections.@sec-hero-001.title", "About"],
      ["sections.@sec-hero-001.intro", "Who we are"],
      ["sections.@sec-hero-001.cta.label", "Contact"],
      ["sections.@sec-cards-02.title", "Services"],
      ["sections.@sec-cards-02.items.0.title", "Storage"],
      ["sections.@sec-cards-02.items.0.description", "Tanks"],
      ["sections.@sec-cards-02.items.1.title", "Trading"],
      ["sections.@sec-cards-02.items.1.description", null],
    ]);
    expect(texts.find((t) => t.path.endsWith("cta.label"))?.max).toBe(80);
    expect(JSON.stringify(texts)).not.toContain("/contact");
  });

  it("the paths are the same in a translation draft of the page (the ids are copied)", () => {
    const draft = cmsTranslationDraft(TEMPLATE, content);
    expect(cmsContentTexts(TEMPLATE, draft).map((t) => t.path)).toEqual(
      cmsContentTexts(TEMPLATE, content).map((t) => t.path),
    );
    // The draft rule is unchanged: texts empty, a field without a value stays without.
    expect(cmsContentTexts(TEMPLATE, draft).map((t) => t.value)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      null,
    ]);
  });

  it("replaces only the named texts; structure and other texts stay; the input is not changed", () => {
    const out = cmsWithContentTexts(
      TEMPLATE,
      content,
      new Map([
        ["sections.@sec-hero-001.title", "Over ons"],
        ["sections.@sec-hero-001.cta.label", "Contact opnemen"],
        ["sections.@sec-cards-02.items.1.description", "Handel"],
        ["sections.@sec-cards-02.missing", "ignored"],
      ]),
    );
    const [hero, cards] = out["sections"] as Record<string, unknown>[];
    expect(hero).toEqual({
      id: "sec-hero-001",
      type: "hero",
      eyebrow: "Since 1990",
      title: "Over ons",
      intro: "Who we are",
      cta: { label: "Contact opnemen", href: "/contact" },
    });
    expect((cards?.["items"] as Record<string, unknown>[])[1]).toEqual({
      title: "Trading",
      description: "Handel",
    });
    expect(JSON.stringify(out)).not.toContain("ignored");
    expect(content.sections[0]!.title).toBe("About");
  });

  it("articles: summary and cover alt text are slots, the cover image is not", () => {
    const texts = cmsContentTexts(
      { kind: "TEMPLATE", templateKey: "article" },
      {
        excerpt: "Summary",
        coverImage: "/media/x.webp",
        coverAlt: "A tank",
        sections: [{ id: "sec-text-0001", type: "text", title: "T", body: "B" }],
      },
    );
    expect(texts.map((t) => t.path)).toEqual([
      "excerpt",
      "coverAlt",
      "sections.@sec-text-0001.title",
      "sections.@sec-text-0001.body",
    ]);
  });

  it("menus: labels and notes are slots; targets, URLs and the shared contact details are not", () => {
    const texts = cmsContentTexts(
      { kind: "FRAGMENT", templateKey: "bv.site-footer" },
      {
        headline: "Let’s Move Energy Forward.",
        intro: "Intro",
        contact: {
          title: "Contact Us",
          company: "Dream Petroleum B.V.",
          addressLines: [{ text: "Herengracht 420" }],
          phone: { label: "020 210 13 50", href: "tel:+31202101350", note: "Mon–Fri" },
        },
        social: [{ network: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/x" }],
        legal: [{ label: "Privacy Policy", target: { type: "path", path: "/privacy" } }],
      },
    );
    expect(texts.map((t) => t.path)).toEqual([
      "headline",
      "intro",
      "contact.title",
      "contact.phone.note",
      "legal.0.label",
    ]);
    expect(texts.every((t) => t.max === null)).toBe(true);
  });
});
