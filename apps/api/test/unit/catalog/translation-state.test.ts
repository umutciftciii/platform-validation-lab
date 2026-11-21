// ML-8b (ADR-028 D8, DP-239, DP-257): translation states of a product's texts per language, the
// source revision (hash) that drives OUTDATED, and the publication's language choice in the
// snapshot builder (`only`, `carry`): a draft in one language never reaches the publication of
// another, the live texts of a language not chosen are kept.
import { describe, expect, it } from "vitest";
import { localizeSnapshot, type SnapshotLocaleTexts, type StoredSnapshot } from "@dream/contracts";
import { buildSnapshotV2, type SnapshotInput } from "../../../src/catalog/snapshot.js";
import {
  categoryHash,
  listingSeoHash,
  listingSource,
  listingTextsHash,
  localeView,
  nameHash,
  sourceHash,
  type ProductTextRows,
} from "../../../src/catalog/translation-state.js";

const IMG = "0190a8c4-7c1e-7000-8000-0000000000c1";
const IMG2 = "0190a8c4-7c1e-7000-8000-0000000000c2";
const DEF = "0190a8c4-7c1e-7000-8000-0000000000d1";
const CAT = "0190a8c4-7c1e-7000-8000-0000000000e1";
const LISTING = "0190a8c4-7c1e-7000-8000-0000000000f1";

const product = { name: "SN 150", summary: "Shared summary", description: "Shared description" };
const enText = {
  locale: "en",
  title: "Base oil SN 150",
  summary: "Group I base oil",
  description: null,
  seoTitle: "SN 150 base oil",
  seoDescription: null,
  seoOgTitle: null,
  seoOgDescription: null,
  sourceHash: null,
  seoSourceHash: null,
};
const enSource = listingSource(product, enText);

function rows(over: Partial<ProductTextRows> = {}): ProductTextRows {
  return {
    defaultLocale: "en",
    siteLocales: [
      { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
      { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
    ],
    product,
    listing: { id: LISTING, version: 3, categoryId: CAT, texts: [enText] },
    category: { id: CAT, version: 1 },
    categoryTexts: [{ locale: "en", name: "Base oils", description: "Mineral", sourceHash: null }],
    specs: [{ definitionId: DEF, key: "kv100", version: 1 }],
    specTexts: [{ definitionId: DEF, locale: "en", name: "Kinematic viscosity", sourceHash: null }],
    images: [
      { id: IMG, version: 1, isPublic: true, originalFilename: "drum.jpg" },
      { id: IMG2, version: 1, isPublic: false, originalFilename: "lab.jpg" },
    ],
    imageTexts: [
      { imageId: IMG, locale: "en", altText: "Steel drum", sourceHash: null },
      { imageId: IMG2, locale: "en", altText: "Lab", sourceHash: null },
    ],
    live: null,
    ...over,
  };
}

const nlText = (over: Partial<typeof enText> = {}) => ({
  ...enText,
  locale: "nl",
  title: "Basisolie SN 150",
  summary: "Groep I basisolie",
  description: null,
  seoTitle: null,
  sourceHash: listingTextsHash(enSource),
  seoSourceHash: null,
  ...over,
});

describe("ML-8b source hash", () => {
  it("is stable, ordered and distinguishes null from an empty or changed text", () => {
    expect(sourceHash(["a", null])).toBe(sourceHash(["a", undefined]));
    expect(sourceHash(["a", null])).not.toBe(sourceHash([null, "a"]));
    expect(sourceHash(["a"])).not.toBe(sourceHash(["a "]));
    expect(sourceHash(["a"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the listing source falls back to the shared product text, as the page does", () => {
    expect(enSource).toEqual({
      title: "Base oil SN 150",
      summary: "Group I base oil",
      description: "Shared description",
      shared: { title: false, summary: false, description: true },
    });
    // a changed master description changes the source of a listing without its own description
    expect(listingTextsHash(listingSource({ ...product, description: "New" }, enText))).not.toBe(
      listingTextsHash(enSource),
    );
    expect(listingSeoHash(enText)).not.toBe(listingSeoHash(undefined));
    expect(categoryHash({ name: "A", description: null })).not.toBe(
      categoryHash({ name: "A", description: "x" }),
    );
    expect(nameHash("x")).toBe(sourceHash(["x"]));
  });
});

describe("ML-8b localeView", () => {
  it("a language without any text: everything required is missing, nothing is invented", () => {
    const v = localeView(rows(), "nl");
    expect(v.hasText).toBe(false);
    expect(v.listing?.state).toBe("MISSING");
    expect(v.category?.state).toBe("MISSING");
    expect(v.specs[0]?.state).toBe("MISSING");
    expect(v.requiredMissing).toEqual(["listing", "category", "spec:kv100"]);
    // optional units are listed; a hidden image's alt text is not needed for the site
    expect(v.missing).toEqual([
      "title",
      "summary",
      "description",
      "seo.title",
      "category.name",
      "category.description",
      "spec:kv100",
      `image:${IMG}`,
    ]);
    expect(v.state).toBe("MISSING");
  });

  it("the default language is the source: complete, never outdated, Draft until published", () => {
    const v = localeView(rows(), "en");
    expect(v.requiredMissing).toEqual([]);
    expect(v.missing).toEqual([]);
    expect(v.listing?.state).toBe("DRAFT");
    expect(v.specs[0]?.state).toBe("DRAFT");
  });

  it("saved translations are Draft; a changed English source makes them Outdated", () => {
    const saved = rows({
      listing: { id: LISTING, version: 4, categoryId: CAT, texts: [enText, nlText()] },
      categoryTexts: [
        { locale: "en", name: "Base oils", description: "Mineral", sourceHash: null },
        {
          locale: "nl",
          name: "Basisoliën",
          description: null,
          sourceHash: categoryHash({ name: "Base oils", description: "Mineral" }),
        },
      ],
      specTexts: [
        { definitionId: DEF, locale: "en", name: "Kinematic viscosity", sourceHash: null },
        {
          definitionId: DEF,
          locale: "nl",
          name: "Kinematische viscositeit",
          sourceHash: nameHash("Kinematic viscosity"),
        },
      ],
    });
    const v = localeView(saved, "nl");
    expect(v.requiredMissing).toEqual([]);
    expect([v.listing?.state, v.category?.state, v.specs[0]?.state]).toEqual([
      "DRAFT",
      "DRAFT",
      "DRAFT",
    ]);
    expect(v.state).toBe("DRAFT");

    const changed = {
      ...saved,
      listing: {
        ...saved.listing!,
        texts: [{ ...enText, summary: "Group I base oil, solvent refined" }, nlText()],
      },
      specTexts: [
        {
          definitionId: DEF,
          locale: "en",
          name: "Kinematic viscosity at 100 °C",
          sourceHash: null,
        },
        saved.specTexts[1]!,
      ],
    };
    const o = localeView(changed, "nl");
    expect(o.listing?.state).toBe("OUTDATED");
    expect(o.specs[0]?.state).toBe("OUTDATED");
    expect(o.category?.state).toBe("DRAFT");
    expect(o.state).toBe("OUTDATED");
    // the English view is unaffected
    expect(localeView(changed, "en").listing?.state).toBe("DRAFT");
  });

  it("a translation saved without a recorded source (before ML-8b) is Outdated until checked", () => {
    const v = localeView(
      rows({
        listing: {
          id: LISTING,
          version: 4,
          categoryId: CAT,
          texts: [enText, nlText({ sourceHash: null })],
        },
      }),
      "nl",
    );
    expect(v.listing?.state).toBe("OUTDATED");
  });

  it("Published when the live snapshot carries exactly the text in that language", () => {
    const nlLive: SnapshotLocaleTexts = {
      name: "Basisolie SN 150",
      summary: "Groep I basisolie",
      description: null,
      categoryName: "Basisoliën",
      specNames: { kv100: "Kinematische viscositeit" },
      imageAlts: {},
      seo: { title: null, description: null, ogTitle: null, ogDescription: null },
    };
    const live = {
      schemaVersion: 2,
      defaultLocale: "en",
      slug: "sn-150",
      code: "SN150",
      category: { slug: "base-oils" },
      sortOrder: 0,
      specs: [],
      images: [{ id: IMG, isCover: true, width: 1, height: 1 }],
      seo: { canonicalPath: null, noindex: false, ogImageId: null },
      locales: { nl: nlLive },
    } as unknown as StoredSnapshot;
    const r = rows({
      listing: { id: LISTING, version: 4, categoryId: CAT, texts: [enText, nlText()] },
      categoryTexts: [
        { locale: "en", name: "Base oils", description: "Mineral", sourceHash: null },
        {
          locale: "nl",
          name: "Basisoliën",
          description: null,
          sourceHash: categoryHash({ name: "Base oils", description: "Mineral" }),
        },
      ],
      live,
    });
    const v = localeView(r, "nl");
    expect(v.live).toBe(true);
    expect(v.listing?.state).toBe("PUBLISHED");
    expect(v.category?.state).toBe("PUBLISHED");
    // a later edit of the Dutch text is a draft again
    const edited = localeView(
      {
        ...r,
        listing: { ...r.listing!, texts: [enText, nlText({ summary: "Nieuwe samenvatting" })] },
      },
      "nl",
    );
    expect(edited.listing?.state).toBe("DRAFT");
  });
});

// --- snapshot builder: language choice ------------------------------------------------------------

function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    defaultLocale: "en",
    locales: ["en", "nl"],
    product: { slug: "sn-150", code: "SN150", ...product },
    listing: { sortOrder: 0, seoCanonicalPath: null, seoNoindex: false, seoOgImageId: null },
    listingTexts: [enText, nlText()],
    category: { slug: "base-oils" },
    categoryTexts: [
      { locale: "en", name: "Base oils" },
      { locale: "nl", name: "Basisoliën" },
    ],
    specs: [
      {
        definitionId: DEF,
        key: "kv100",
        sortOrder: 0,
        basis: "SPECIFICATION",
        value: { type: "NUMBER", number: 5.2 },
        unit: "mm²/s",
        testMethod: "ASTM D445",
      },
    ],
    specTexts: [
      { definitionId: DEF, locale: "en", name: "Kinematic viscosity" },
      { definitionId: DEF, locale: "nl", name: "Kinematische viscositeit" },
    ],
    images: [{ id: IMG, isCover: true, width: 10, height: 10 }],
    imageTexts: [
      { imageId: IMG, locale: "en", altText: "Steel drum" },
      { imageId: IMG, locale: "nl", altText: "Stalen vat" },
    ],
    ...over,
  };
}

describe("ML-8b snapshot builder: languages of a publication", () => {
  it("without a choice (ML-8a callers) every language with own text is written", () => {
    expect(Object.keys(buildSnapshotV2(input()).locales)).toEqual(["en", "nl"]);
  });

  it("only: an unchosen Dutch draft is not written; the English view is identical", () => {
    const withNl = buildSnapshotV2(input());
    const enOnly = buildSnapshotV2(input({ only: [] }));
    expect(Object.keys(enOnly.locales)).toEqual(["en"]);
    expect(JSON.stringify(localizeSnapshot(enOnly, "en"))).toBe(
      JSON.stringify(localizeSnapshot(withNl, "en")),
    );
    expect(localizeSnapshot(enOnly, "nl")).toBeNull();
  });

  it("carry: the live Dutch texts are kept as published, reduced to what is still shown", () => {
    const live = buildSnapshotV2(input()).locales["nl"]!;
    const carried = buildSnapshotV2(
      input({
        only: [],
        // the Dutch draft changed meanwhile: it must not be published
        listingTexts: [enText, nlText({ summary: "Concept, niet gecontroleerd" })],
        // a specification and an image were removed since the live publication
        specs: [],
        images: [{ id: IMG2, isCover: true, width: 10, height: 10 }],
        carry: { nl: live },
      }),
    );
    expect(carried.locales["nl"]?.summary).toBe("Groep I basisolie");
    expect(carried.locales["nl"]?.specNames).toEqual({});
    expect(carried.locales["nl"]?.imageAlts).toEqual({});
  });

  it("carry never overrides the default language, a chosen language or a disabled one", () => {
    const live = buildSnapshotV2(input()).locales;
    const s = buildSnapshotV2(
      input({
        only: ["nl"],
        listingTexts: [enText, nlText({ summary: "Gecontroleerd" })],
        carry: { en: { ...live["en"]!, name: "OLD" }, nl: live["nl"]!, de: live["nl"]! },
      }),
    );
    expect(s.locales["en"]?.name).toBe("Base oil SN 150");
    expect(s.locales["nl"]?.summary).toBe("Gecontroleerd");
    expect(Object.keys(s.locales).sort()).toEqual(["en", "nl"]);
  });
});
