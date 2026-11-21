// ML-8a (ADR-028 D8): the v2 snapshot builder. Its English view must equal what the v1 builder
// of before ML-8a (WorkflowService.publish at 0c81985, copied below verbatim in logic) produced
// for the same content, byte for byte after JSON serialisation; other languages carry only their
// own texts.
import { describe, expect, it } from "vitest";
import {
  localizeSnapshot,
  PublishedSnapshotV1Schema,
  snapshotCoverage,
  type PublishedSnapshot,
} from "@dream/contracts";
import {
  buildSnapshotV2,
  snapshotLocalesOf,
  type SnapshotInput,
} from "../../../src/catalog/snapshot.js";

/** The v1 builder of before ML-8a (English columns, listing SEO columns). */
function legacyV1(input: {
  product: SnapshotInput["product"];
  listing: SnapshotInput["listing"] & {
    seoTitle: string | null;
    seoDescription: string | null;
    seoOgTitle: string | null;
    seoOgDescription: string | null;
  };
  text: { title: string | null; summary: string | null; description: string | null } | null;
  category: { slug: string; name: string };
  values: {
    definitionId: string;
    basis: "SPECIFICATION" | "TYPICAL";
    value: never;
    unit: string | null;
    testMethod: string | null;
  }[];
  defs: { id: string; key: string; name: string; sortOrder: number }[];
  images: { id: string; altText: string | null; isCover: boolean; width: number; height: number }[];
}): PublishedSnapshot {
  const defsById = new Map(input.defs.map((d) => [d.id, d]));
  const { listing, text, product } = input;
  return PublishedSnapshotV1Schema.parse({
    schemaVersion: 1,
    slug: product.slug,
    code: product.code,
    name: text?.title ?? product.name,
    summary: text?.summary ?? product.summary,
    description: text?.description ?? product.description,
    category: input.category,
    sortOrder: listing.sortOrder,
    specs: input.values
      .map((v) => ({ v, d: defsById.get(v.definitionId) }))
      .filter((x): x is { v: (typeof input.values)[number]; d: NonNullable<typeof x.d> } => !!x.d)
      .sort(
        (x, y) =>
          x.d.sortOrder - y.d.sortOrder ||
          x.d.name.localeCompare(y.d.name) ||
          (x.v.basis === y.v.basis ? 0 : x.v.basis === "SPECIFICATION" ? -1 : 1),
      )
      .map(({ v, d }) => ({
        key: d.key,
        name: d.name,
        basis: v.basis,
        value: v.value,
        unit: v.unit,
        testMethod: v.testMethod,
      })),
    images: input.images.map((i) => ({
      id: i.id,
      altText: i.altText,
      isCover: i.isCover,
      width: i.width,
      height: i.height,
    })),
    seo: {
      title: listing.seoTitle,
      description: listing.seoDescription,
      ogTitle: listing.seoOgTitle,
      ogDescription: listing.seoOgDescription,
      canonicalPath: listing.seoCanonicalPath,
      noindex: listing.seoNoindex,
      ogImageId: input.images.some((i) => i.id === listing.seoOgImageId)
        ? listing.seoOgImageId
        : null,
    },
  });
}

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uuid = (n: number) => `0190a8c4-7c1e-7000-8000-${n.toString(16).padStart(12, "0")}`;

function scenario(seed: number) {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const maybe = <T>(v: T) => (r() < 0.5 ? v : null);
  const names = [
    "Pour point",
    "Flash point",
    "Kinematic viscosity",
    "Density",
    "Colour",
    "Água",
    "Zeta",
    "alpha",
  ];
  const defs = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({
    id: uuid(100 + i),
    key: `k_${i}`,
    name: pick(names) + (r() < 0.3 ? "" : ` ${i}`),
    sortOrder: Math.floor(r() * 3),
  }));
  const values = defs.flatMap((d) =>
    (["SPECIFICATION", "TYPICAL"] as const)
      .filter(() => r() < 0.7)
      .map((basis) => ({
        definitionId: d.id,
        basis,
        value: { type: "NUMBER", number: Math.round(r() * 1000) / 10 } as never,
        unit: maybe("mm²/s"),
        testMethod: maybe("ASTM D445"),
      })),
  );
  const images = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
    id: uuid(200 + i),
    altText: maybe(`Alt ${i}`),
    isCover: i === 0,
    width: 1600,
    height: 1200,
  }));
  const product = {
    slug: `p-${seed}`,
    code: `P-${seed}`,
    name: `Product ${seed}`,
    summary: maybe("Master summary"),
    description: maybe("Master description"),
  };
  const listing = {
    sortOrder: Math.floor(r() * 5),
    seoTitle: maybe("SEO title"),
    seoDescription: maybe("SEO description"),
    seoOgTitle: maybe("OG title"),
    seoOgDescription: maybe("OG description"),
    seoCanonicalPath: maybe("/products/x"),
    seoNoindex: r() < 0.2,
    seoOgImageId: pick([null, uuid(200), uuid(201), uuid(999)]),
  };
  const text =
    r() < 0.8
      ? {
          title: maybe("Listing title"),
          summary: maybe("Listing summary"),
          description: maybe("Listing description"),
        }
      : null;
  const category = { slug: "base-oils", name: pick(["Base oils", "White oils", "Ölje"]) };
  return { product, listing, text, category, values, defs, images };
}

/** The input the API builds from the per-language rows, whose "en" rows mirror the columns. */
function inputOf(
  s: ReturnType<typeof scenario>,
  extra: Partial<SnapshotInput> = {},
): SnapshotInput {
  const hasSeo = [
    s.listing.seoTitle,
    s.listing.seoDescription,
    s.listing.seoOgTitle,
    s.listing.seoOgDescription,
  ].some((v) => v !== null);
  return {
    defaultLocale: "en",
    locales: ["en", "nl"],
    product: s.product,
    listing: s.listing,
    listingTexts:
      s.text || hasSeo
        ? [
            {
              locale: "en",
              title: s.text?.title ?? null,
              summary: s.text?.summary ?? null,
              description: s.text?.description ?? null,
              seoTitle: s.listing.seoTitle,
              seoDescription: s.listing.seoDescription,
              seoOgTitle: s.listing.seoOgTitle,
              seoOgDescription: s.listing.seoOgDescription,
            },
          ]
        : [],
    category: { slug: s.category.slug },
    categoryTexts: [{ locale: "en", name: s.category.name }],
    specs: s.values.map((v) => {
      const d = s.defs.find((x) => x.id === v.definitionId)!;
      return { ...v, key: d.key, sortOrder: d.sortOrder };
    }),
    specTexts: s.defs.map((d) => ({ definitionId: d.id, locale: "en", name: d.name })),
    images: s.images.map(({ altText: _a, ...i }) => (void _a, i)),
    imageTexts: s.images
      .filter((i) => i.altText)
      .map((i) => ({ imageId: i.id, locale: "en", altText: i.altText })),
    ...extra,
  };
}

describe("ML-8a buildSnapshotV2", () => {
  it("English view = v1 builder of before ML-8a, byte for byte (500 generated products)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const s = scenario(seed);
      const before = legacyV1(s);
      const after = localizeSnapshot(buildSnapshotV2(inputOf(s)), "en");
      expect(JSON.stringify(after), `seed ${seed}`).toBe(JSON.stringify(before));
    }
  });

  it("writes only the default language when no other language has its own listing text", () => {
    const s = scenario(7);
    const snap = buildSnapshotV2(inputOf(s));
    expect(Object.keys(snap.locales)).toEqual(["en"]);
    expect(localizeSnapshot(snap, "nl")).toBeNull();
    // an NL row with only SEO texts is not a listing text: still not written
    const seoOnly = inputOf(s, {
      listingTexts: [
        ...inputOf(s).listingTexts,
        {
          locale: "nl",
          title: null,
          summary: null,
          description: null,
          seoTitle: "NL SEO",
          seoDescription: null,
          seoOgTitle: null,
          seoOgDescription: null,
        },
      ],
    });
    expect(snapshotLocalesOf(seoOnly)).toEqual(["en"]);
  });

  it("a Dutch listing text adds Dutch; nothing is copied from English", () => {
    const s = scenario(11);
    const base = inputOf(s);
    const snap = buildSnapshotV2({
      ...base,
      listingTexts: [
        ...base.listingTexts,
        {
          locale: "nl",
          title: null,
          summary: "NL samenvatting",
          description: null,
          seoTitle: null,
          seoDescription: null,
          seoOgTitle: null,
          seoOgDescription: null,
        },
      ],
    });
    expect(Object.keys(snap.locales)).toEqual(["en", "nl"]);
    const nl = snap.locales.nl!;
    expect(nl.name).toBe(s.product.name); // names are not translated (ADR-028 §1.2)
    expect(nl.summary).toBe("NL samenvatting");
    expect(nl.description).toBeNull(); // not the English or master description
    expect(nl.categoryName).toBeNull();
    expect(nl.specNames).toEqual({});
    expect(nl.imageAlts).toEqual({});
    expect(nl.seo).toEqual({ title: null, description: null, ogTitle: null, ogDescription: null });
    // incomplete Dutch is not shown; English unchanged
    expect(localizeSnapshot(snap, "nl")).toBeNull();
    expect(JSON.stringify(localizeSnapshot(snap, "en"))).toBe(JSON.stringify(legacyV1(s)));
    expect(snapshotCoverage(snap)[1]?.complete).toBe(false);
  });

  it("a complete Dutch text is shown with shared values and the default language's order", () => {
    const s = scenario(23);
    const base = inputOf(s);
    const snap = buildSnapshotV2({
      ...base,
      listingTexts: [
        ...base.listingTexts,
        {
          locale: "nl",
          title: "NL titel",
          summary: null,
          description: null,
          seoTitle: "NL SEO",
          seoDescription: null,
          seoOgTitle: null,
          seoOgDescription: null,
        },
      ],
      categoryTexts: [...base.categoryTexts, { locale: "nl", name: "Basisoliën" }],
      specTexts: [
        ...base.specTexts,
        ...s.defs.map((d) => ({ definitionId: d.id, locale: "nl", name: `NL ${d.key}` })),
      ],
    });
    const en = localizeSnapshot(snap, "en")!;
    const nl = localizeSnapshot(snap, "nl")!;
    expect(nl.name).toBe("NL titel");
    expect(nl.category).toEqual({ slug: "base-oils", name: "Basisoliën" });
    expect(nl.specs.map((x) => x.key)).toEqual(en.specs.map((x) => x.key));
    expect(nl.specs.map((x) => x.value)).toEqual(en.specs.map((x) => x.value));
    expect(nl.seo).toMatchObject({
      title: "NL SEO",
      canonicalPath: en.seo?.canonicalPath,
      noindex: en.seo?.noindex,
    });
  });

  it("a language that is not enabled is never written", () => {
    const s = scenario(31);
    const base = inputOf(s, { locales: ["en"] });
    const snap = buildSnapshotV2({
      ...base,
      listingTexts: [
        ...base.listingTexts,
        {
          locale: "nl",
          title: "x",
          summary: "y",
          description: null,
          seoTitle: null,
          seoDescription: null,
          seoOgTitle: null,
          seoOgDescription: null,
        },
      ],
    });
    expect(Object.keys(snap.locales)).toEqual(["en"]);
  });

  it("refuses when the default language lacks a category or specification name", () => {
    const s = scenario(41);
    expect(() => buildSnapshotV2(inputOf(s, { categoryTexts: [] }))).toThrow();
    if (s.values.length) {
      expect(() => buildSnapshotV2(inputOf(s, { specTexts: [] }))).toThrow();
    }
  });
});
