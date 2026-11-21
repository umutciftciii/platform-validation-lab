// ML-8a (ADR-028 D8): v1 and v2 publication snapshots and how they are read per language.
import { describe, expect, it } from "vitest";
import {
  localizeSnapshot,
  parseStoredSnapshot,
  PublishedSnapshotV2Schema,
  readSnapshot,
  readSnapshotAddress,
  snapshotCoverage,
  snapshotLocales,
  storedSnapshotSlug,
  toPublicProduct,
  type PublishedSnapshotV2,
} from "../src/index.js";

const IMG1 = "0190a8c4-7c1e-7000-8000-000000000001";
const IMG2 = "0190a8c4-7c1e-7000-8000-000000000002";

/** A v1 snapshot as stored before ML-8a (JSON order of PostgreSQL jsonb does not matter). */
const v1 = {
  schemaVersion: 1,
  slug: "iccsyn-6",
  code: "ICC-SYN-6",
  name: "ICCSYN 6",
  summary: "Synthetic base oil",
  description: "Long text.",
  category: { slug: "base-oils", name: "Base oils" },
  sortOrder: 3,
  specs: [
    {
      key: "kv100",
      name: "Kinematic viscosity at 100 °C",
      basis: "SPECIFICATION",
      value: { type: "NUMBER", number: 6.1 },
      unit: "mm²/s",
      testMethod: "ASTM D445",
    },
    {
      key: "kv100",
      name: "Kinematic viscosity at 100 °C",
      basis: "TYPICAL",
      value: { type: "NUMBER", number: 6.0 },
      unit: "mm²/s",
      testMethod: null,
    },
  ],
  images: [
    { id: IMG1, altText: "Drum", isCover: true, width: 1600, height: 1200 },
    { id: IMG2, altText: null, isCover: false, width: 800, height: 600 },
  ],
  seo: {
    title: "ICCSYN 6 base oil",
    description: null,
    ogTitle: null,
    ogDescription: "Share text",
    canonicalPath: null,
    noindex: false,
    ogImageId: IMG1,
  },
};

/** The same content as v2, English only. */
const v2en: PublishedSnapshotV2 = PublishedSnapshotV2Schema.parse({
  schemaVersion: 2,
  defaultLocale: "en",
  slug: "iccsyn-6",
  code: "ICC-SYN-6",
  category: { slug: "base-oils" },
  sortOrder: 3,
  specs: v1.specs.map(({ name: _n, ...s }) => (void _n, s)),
  images: v1.images.map(({ altText: _a, ...i }) => (void _a, i)),
  seo: { canonicalPath: null, noindex: false, ogImageId: IMG1 },
  locales: {
    en: {
      name: "ICCSYN 6",
      summary: "Synthetic base oil",
      description: "Long text.",
      categoryName: "Base oils",
      specNames: { kv100: "Kinematic viscosity at 100 °C" },
      imageAlts: { [IMG1]: "Drum" },
      seo: {
        title: "ICCSYN 6 base oil",
        description: null,
        ogTitle: null,
        ogDescription: "Share text",
      },
    },
  },
});

const nl = {
  name: "ICCSYN 6",
  summary: "Synthetische basisolie",
  description: null,
  categoryName: "Basisoliën",
  specNames: { kv100: "Kinematische viscositeit bij 100 °C" },
  imageAlts: { [IMG1]: "Vat" },
  seo: { title: null, description: null, ogTitle: null, ogDescription: null },
};

describe("ML-8a snapshot versions", () => {
  it("reads a v1 snapshot in English only", () => {
    const s = parseStoredSnapshot(v1);
    expect(s?.schemaVersion).toBe(1);
    expect(snapshotLocales(s!)).toEqual(["en"]);
    expect(readSnapshot(v1, "en")).toEqual(v1);
    expect(readSnapshot(v1, "nl")).toBeNull();
  });

  it("the English view of a v2 snapshot is the v1 snapshot of the same content (deep and in key order)", () => {
    const view = localizeSnapshot(v2en, "en");
    expect(view).toEqual(v1);
    const fromV1 = readSnapshot(v1, "en");
    expect(JSON.stringify(view)).toBe(JSON.stringify(fromV1));
    expect(JSON.stringify(toPublicProduct(view!, "2026-11-21T00:00:00.000Z"))).toBe(
      JSON.stringify(toPublicProduct(fromV1!, "2026-11-21T00:00:00.000Z")),
    );
  });

  it("v1 snapshots without basis or SEO stay readable (defaults as before)", () => {
    const old = {
      ...v1,
      seo: undefined,
      specs: [{ ...v1.specs[0], basis: undefined }],
    };
    const view = readSnapshot(JSON.parse(JSON.stringify(old)), "en");
    expect(view?.specs[0]?.basis).toBe("SPECIFICATION");
    expect(view?.seo).toBeUndefined();
  });

  it("a language without its own texts is not served: no fake translation", () => {
    expect(localizeSnapshot(v2en, "nl")).toBeNull();
    expect(snapshotCoverage(v2en)).toEqual([{ locale: "en", complete: true, missing: [] }]);
  });

  it("serves Dutch from its own texts only, with language-neutral values shared", () => {
    const both = PublishedSnapshotV2Schema.parse({ ...v2en, locales: { ...v2en.locales, nl } });
    expect(snapshotLocales(both)).toEqual(["en", "nl"]);
    const view = localizeSnapshot(both, "nl")!;
    expect(view.summary).toBe("Synthetische basisolie");
    expect(view.description).toBeNull(); // not copied from English
    expect(view.category).toEqual({ slug: "base-oils", name: "Basisoliën" });
    expect(view.specs.map((s) => s.name)).toEqual([
      "Kinematische viscositeit bij 100 °C",
      "Kinematische viscositeit bij 100 °C",
    ]);
    expect(view.specs.map((s) => s.value)).toEqual(v1.specs.map((s) => s.value));
    expect(view.images.map((i) => i.altText)).toEqual(["Vat", null]);
    expect(view.seo).toMatchObject({ title: null, ogImageId: IMG1, noindex: false });
    // English unchanged by the Dutch entry
    expect(localizeSnapshot(both, "en")).toEqual(v1);
  });

  it("an incomplete language (category or a specification untranslated) is not shown and is reported", () => {
    const partial = PublishedSnapshotV2Schema.parse({
      ...v2en,
      locales: { ...v2en.locales, nl: { ...nl, categoryName: null, specNames: {}, imageAlts: {} } },
    });
    expect(localizeSnapshot(partial, "nl")).toBeNull();
    const cov = snapshotCoverage(partial).find((c) => c.locale === "nl");
    expect(cov).toEqual({
      locale: "nl",
      complete: false,
      missing: ["category", "spec:kv100", `image:${IMG1}`],
    });
    // only the alt text missing: shown (alt null), reported
    const altOnly = PublishedSnapshotV2Schema.parse({
      ...v2en,
      locales: { ...v2en.locales, nl: { ...nl, imageAlts: {} } },
    });
    expect(localizeSnapshot(altOnly, "nl")?.images[0]?.altText).toBeNull();
    expect(snapshotCoverage(altOnly)[1]).toMatchObject({
      complete: true,
      missing: [`image:${IMG1}`],
    });
  });

  it("refuses a v2 snapshot without its default language, unknown fields or a bad tag", () => {
    expect(PublishedSnapshotV2Schema.safeParse({ ...v2en, locales: { nl } }).success).toBe(false);
    expect(PublishedSnapshotV2Schema.safeParse({ ...v2en, storageKey: "x" }).success).toBe(false);
    expect(
      PublishedSnapshotV2Schema.safeParse({ ...v2en, locales: { ...v2en.locales, NL: nl } })
        .success,
    ).toBe(false);
    expect(parseStoredSnapshot({ schemaVersion: 3 })).toBeNull();
    expect(readSnapshot({ schemaVersion: 1, name: "tampered" }, "en")).toBeNull();
  });

  it("slug, noindex and canonical path are language-neutral in both versions", () => {
    expect(storedSnapshotSlug(v1)).toBe("iccsyn-6");
    expect(storedSnapshotSlug(v2en)).toBe("iccsyn-6");
    expect(readSnapshotAddress(v1)).toEqual({
      slug: "iccsyn-6",
      noindex: false,
      canonicalPath: null,
    });
    expect(readSnapshotAddress(v2en)).toEqual(readSnapshotAddress(v1));
    expect(readSnapshotAddress({ ...v1, seo: undefined })).toEqual({
      slug: "iccsyn-6",
      noindex: false,
      canonicalPath: null,
    });
    expect(readSnapshotAddress(null)).toBeNull();
  });
});
