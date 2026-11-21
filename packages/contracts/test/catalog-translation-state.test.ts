// ML-8b (ADR-028 D8, DP-239, DP-257): translation states, the listing save request, the
// publication's language fields and the per-language raw texts of a stored snapshot.
import { describe, expect, it } from "vitest";
import {
  claimScanOf,
  CLAIM_SCAN_LOCALES,
  combinedTranslationState,
  findSensitiveClaims,
  ListingTranslationUpdateRequestSchema,
  PublishRequestSchema,
  PublishedSnapshotV2Schema,
  SitePublicationSchema,
  snapshotLocaleTexts,
  translationState,
  type PublishedSnapshotV1,
} from "../src/index.js";

const base = {
  hasValue: true,
  hasSource: true,
  isDefault: false,
  sourceChanged: false,
  live: false,
};

describe("ML-8b translation state", () => {
  it("MISSING when there is a source and no translation; null when there is nothing to translate", () => {
    expect(translationState({ ...base, hasValue: false })).toBe("MISSING");
    expect(translationState({ ...base, hasValue: false, hasSource: false })).toBeNull();
    // the default language without a text is missing too (there is no other source)
    expect(translationState({ ...base, hasValue: false, hasSource: false, isDefault: true })).toBe(
      "MISSING",
    );
  });

  it("OUTDATED when the source changed, before DRAFT or PUBLISHED; never for the default language", () => {
    expect(translationState({ ...base, sourceChanged: true })).toBe("OUTDATED");
    expect(translationState({ ...base, sourceChanged: true, live: true })).toBe("OUTDATED");
    expect(translationState({ ...base, sourceChanged: true, isDefault: true })).toBe("DRAFT");
  });

  it("PUBLISHED only when the live publication carries exactly the text, else DRAFT", () => {
    expect(translationState({ ...base, live: true })).toBe("PUBLISHED");
    expect(translationState(base)).toBe("DRAFT");
  });

  it("the combined state is the most urgent one", () => {
    expect(combinedTranslationState(["PUBLISHED", "DRAFT", null])).toBe("DRAFT");
    expect(combinedTranslationState(["PUBLISHED", "MISSING", "DRAFT"])).toBe("MISSING");
    expect(combinedTranslationState(["MISSING", "OUTDATED"])).toBe("OUTDATED");
    expect(combinedTranslationState(["PUBLISHED", "PUBLISHED"])).toBe("PUBLISHED");
    expect(combinedTranslationState([null])).toBeNull();
  });
});

describe("ML-8b listing translation request", () => {
  it("checks both parts by default (the behaviour of before ML-8b) and accepts one part", () => {
    expect(ListingTranslationUpdateRequestSchema.parse({ version: 1 }).sections).toEqual([
      "texts",
      "seo",
    ]);
    expect(
      ListingTranslationUpdateRequestSchema.parse({ version: 1, sections: ["seo", "seo"] })
        .sections,
    ).toEqual(["seo"]);
    expect(
      ListingTranslationUpdateRequestSchema.parse({ version: 1, sections: [] }).sections,
    ).toEqual([]);
  });

  it("refuses unknown parts, control characters and too long texts", () => {
    expect(
      ListingTranslationUpdateRequestSchema.safeParse({ version: 1, sections: ["specs"] }).success,
    ).toBe(false);
    expect(
      ListingTranslationUpdateRequestSchema.safeParse({ version: 1, title: "a\u0007b" }).success,
    ).toBe(false);
    expect(
      ListingTranslationUpdateRequestSchema.safeParse({ version: 1, title: "x".repeat(201) })
        .success,
    ).toBe(false);
    expect(ListingTranslationUpdateRequestSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe("ML-8b publication languages", () => {
  it("sorts and de-duplicates the chosen languages and the manual checks", () => {
    const r = PublishRequestSchema.parse({
      version: 1,
      listingVersion: 1,
      locales: ["nl", "de", "nl"],
      manualReview: ["nl", "nl"],
    });
    expect(r.locales).toEqual(["de", "nl"]);
    expect(r.manualReview).toEqual(["nl"]);
  });

  it("refuses malformed language tags", () => {
    for (const locales of [["NL"], ["nl_NL"], ["x"], [""]]) {
      expect(
        PublishRequestSchema.safeParse({ version: 1, listingVersion: 1, locales }).success,
      ).toBe(false);
    }
  });

  it("DP-257: only English has a reviewed claim word list; Dutch needs a manual check", () => {
    expect(CLAIM_SCAN_LOCALES).toEqual(["en"]);
    expect(claimScanOf("en")).toBe("AUTOMATIC");
    expect(claimScanOf("nl")).toBe("MANUAL");
    // the English list still finds acronyms in a Dutch text, but not Dutch words
    expect(findSensitiveClaims("Geschikt voor SAF-productie").map((c) => c.key)).toEqual(["saf"]);
    expect(findSensitiveClaims("Biologisch afbreekbaar, voedselveilig")).toEqual([]);
  });

  it("an older publication view without languages still parses (empty list)", () => {
    const site = SitePublicationSchema.shape.languages.parse(undefined);
    expect(site).toEqual([]);
  });
});

describe("ML-8b raw texts of one language of a stored snapshot", () => {
  const img = "0190a8c4-7c1e-7000-8000-0000000000c1";
  const v1: PublishedSnapshotV1 = {
    schemaVersion: 1,
    slug: "sn-150",
    code: "SN150",
    name: "Base oil SN 150",
    summary: "Group I",
    description: null,
    category: { slug: "base-oils", name: "Base oils" },
    sortOrder: 0,
    specs: [
      {
        key: "kv100",
        name: "Kinematic viscosity at 100 °C",
        basis: "SPECIFICATION",
        value: { type: "NUMBER", number: 5.2 },
        unit: "mm²/s",
        testMethod: "ASTM D445",
      },
    ],
    images: [{ id: img, altText: "Drum", isCover: true, width: 10, height: 10 }],
  };

  it("v1 answers in English only, with the names and alt texts in the v2 shape", () => {
    expect(snapshotLocaleTexts(v1, "nl")).toBeNull();
    expect(snapshotLocaleTexts(v1, "en")).toEqual({
      name: "Base oil SN 150",
      summary: "Group I",
      description: null,
      categoryName: "Base oils",
      specNames: { kv100: "Kinematic viscosity at 100 °C" },
      imageAlts: { [img]: "Drum" },
      seo: { title: null, description: null, ogTitle: null, ogDescription: null },
    });
  });

  it("v2 answers per language, also for an incomplete language", () => {
    const v2 = PublishedSnapshotV2Schema.parse({
      schemaVersion: 2,
      defaultLocale: "en",
      slug: "sn-150",
      code: "SN150",
      category: { slug: "base-oils" },
      sortOrder: 0,
      specs: [],
      images: [],
      seo: { canonicalPath: null, noindex: false, ogImageId: null },
      locales: {
        en: {
          name: "Base oil SN 150",
          summary: null,
          description: null,
          categoryName: "Base oils",
          specNames: {},
          imageAlts: {},
          seo: { title: null, description: null, ogTitle: null, ogDescription: null },
        },
        nl: {
          name: "Basisolie SN 150",
          summary: null,
          description: null,
          categoryName: null,
          specNames: {},
          imageAlts: {},
          seo: { title: null, description: null, ogTitle: null, ogDescription: null },
        },
      },
    });
    expect(snapshotLocaleTexts(v2, "nl")?.name).toBe("Basisolie SN 150");
    expect(snapshotLocaleTexts(v2, "nl")?.categoryName).toBeNull();
    expect(snapshotLocaleTexts(v2, "de")).toBeNull();
  });
});
