// DP-157: the catalogue import plan (pure), the mapping schema's guards and the CLI arguments.
import { CatalogMappingSchema, type CatalogMapping } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../../src/catalog/import/cli.js";
import { planImport, type CatalogState } from "../../../src/catalog/import/plan.js";

const range = (min: number | null, max: number | null) => ({
  type: "RANGE" as const,
  min,
  max,
  minExclusive: false,
  maxExclusive: false,
});

function product(code: string, slug: string, category: string, specs: object[] = []) {
  return {
    liveSlug: slug,
    sourceUrl: `https://example.test/en/products/${slug}`,
    code,
    slug,
    name: `Product ${code}`,
    readiness: specs.length ? "READY" : "READY_NO_SPECS",
    import: {
      master: { code, slug, name: `Product ${code}`, status: "DRAFT" },
      listing: {
        site: "BV",
        categorySlug: category,
        visibility: "HIDDEN",
        sortOrder: 10,
        texts: { en: { title: `Product ${code}` } },
      },
      specs,
    },
  };
}

const raw = {
  schemaVersion: 1,
  site: "BV",
  definitions: [
    { key: "vi", name: "VI", dataType: "RANGE", units: [], testMethods: [], decimals: 0 },
    { key: "pour", name: "Pour", dataType: "RANGE", units: ["°C"], testMethods: [], decimals: 0 },
  ],
  categories: [
    { slug: "oil", name: "Oil", parentSlug: null, sortOrder: 10 },
    { slug: "oil-g1", name: "G1", parentSlug: "oil", sortOrder: 20 },
    { slug: "wax", name: "Wax", parentSlug: null, sortOrder: 30 },
  ],
  products: [
    product("A-1", "a-1", "oil-g1", [
      { key: "vi", basis: "SPECIFICATION", value: range(95, null), unit: null, testMethod: null },
      { key: "pour", basis: "TYPICAL", value: range(-9, -9), unit: "°C", testMethod: null },
    ]),
    product("A-2", "a-2", "oil-g1"),
    product("B-1", "b-1", "wax"),
  ],
};
const mapping: CatalogMapping = CatalogMappingSchema.parse(raw);

const empty: CatalogState = { siteId: "site", definitions: [], categories: [], products: [] };
const existing = (code: string, slug: string, name: string, listed: boolean, status = "DRAFT") => ({
  id: `id-${code}`,
  code,
  slug,
  name,
  status,
  version: 1,
  listed,
});

describe("import plan", () => {
  it("plans everything on an empty catalogue, parents first", () => {
    const p = planImport(mapping, empty);
    expect(p.products.map((x) => [x.code, x.action, x.specs])).toEqual([
      ["A-1", "CREATE", 2],
      ["A-2", "CREATE", 0],
      ["B-1", "CREATE", 0],
    ]);
    expect(p.categories.map((c) => [c.slug, c.action])).toEqual([
      ["oil", "CREATE"],
      ["oil-g1", "CREATE"],
      ["wax", "CREATE"],
    ]);
    expect(p.definitions.map((d) => [d.key, d.action])).toEqual([
      ["vi", "CREATE"],
      ["pour", "CREATE"],
    ]);
    expect(p.confirmCount).toBe(3);
  });

  it("never touches existing products: imported, partial and conflicting ones", () => {
    const state: CatalogState = {
      ...empty,
      products: [
        existing("A-1", "a-1", "Product A-1", true),
        existing("A-2", "a-2", "Product A-2", false),
        existing("B-1", "other-slug", "Product B-1", true),
      ],
    };
    const p = planImport(mapping, state);
    expect(p.products.map((x) => [x.code, x.action])).toEqual([
      ["A-1", "ALREADY_IMPORTED"],
      ["A-2", "PARTIAL"],
      ["B-1", "CONFLICT"],
    ]);
    expect(p.products[2]!.reasons).toEqual(["code B-1 exists with slug other-slug"]);
    // nothing is created for products that are not written
    expect(p.definitions).toEqual([]);
    expect(p.categories.filter((c) => c.action === "CREATE")).toEqual([]);
    expect(p.confirmCount).toBe(0);
  });

  it("reports a slug or name taken by another product as a conflict", () => {
    const p = planImport(mapping, {
      ...empty,
      products: [
        existing("X-9", "a-1", "Other", true),
        existing("A-2", "a-2", "Renamed by an editor", true),
      ],
    });
    expect(p.products.slice(0, 2).map((x) => [x.action, x.reasons])).toEqual([
      ["CONFLICT", ["slug a-1 exists with code X-9"]],
      ["CONFLICT", ['exists with name "Renamed by an editor"']],
    ]);
  });

  it("resumes a partial product only when asked, DRAFT and without values", () => {
    const state: CatalogState = {
      ...empty,
      products: [existing("A-2", "a-2", "Product A-2", false)],
      specCounts: new Map([["id-A-2", 0]]),
    };
    expect(planImport(mapping, state).products[1]!.action).toBe("PARTIAL");
    const resumed = planImport(mapping, state, { resumePartial: true });
    expect(resumed.products[1]!.action).toBe("RESUME");
    expect(resumed.confirmCount).toBe(3);
    const withValues = planImport(
      mapping,
      { ...state, specCounts: new Map([["id-A-2", 2]]) },
      { resumePartial: true },
    );
    expect(withValues.products[1]!.action).toBe("PARTIAL");
    const approved = planImport(
      mapping,
      { ...state, products: [existing("A-2", "a-2", "Product A-2", false, "APPROVED")] },
      { resumePartial: true },
    );
    expect(approved.products[1]!.action).toBe("PARTIAL");
  });

  it("reuses compatible definitions and skips the whole set on an incompatible one", () => {
    const p = planImport(mapping, {
      ...empty,
      definitions: [
        { id: "d-vi", key: "vi", dataType: "NUMBER", units: [], archived: false },
        { id: "d-pour", key: "pour", dataType: "RANGE", units: ["°C", "°F"], archived: false },
      ],
    });
    expect(p.definitions.map((d) => [d.key, d.action])).toEqual([
      ["vi", "CONFLICT"],
      ["pour", "REUSE"],
    ]);
    const a1 = p.products[0]!;
    expect([a1.action, a1.specs, a1.specsSkipped]).toEqual(["CREATE", 0, 2]);
    expect(a1.reasons[0]).toContain("definition vi (existing data type NUMBER, mapping RANGE)");
    const units = planImport(mapping, {
      ...empty,
      definitions: [
        { id: "d-pour", key: "pour", dataType: "RANGE", units: ["°F"], archived: true },
      ],
    });
    expect(units.definitions.find((d) => d.key === "pour")?.reason).toBe(
      "existing units do not accept °C; existing definition is archived",
    );
  });

  it("reuses a category under the same parent and skips products of a moved one", () => {
    const p = planImport(mapping, {
      ...empty,
      categories: [
        { id: "c-oil", slug: "oil", parentId: null },
        { id: "c-g1", slug: "oil-g1", parentId: "c-wax" },
        { id: "c-wax", slug: "wax", parentId: null },
      ],
    });
    expect(p.categories.map((c) => [c.slug, c.action])).toEqual([
      ["oil", "REUSE"],
      ["oil-g1", "CONFLICT"],
      ["wax", "REUSE"],
    ]);
    expect(p.products.map((x) => x.action)).toEqual(["CONFLICT", "CONFLICT", "CREATE"]);
    expect(p.confirmCount).toBe(1);
  });

  it("limits the plan to --only codes", () => {
    const p = planImport(mapping, empty, { only: new Set(["B-1"]) });
    expect(p.products.map((x) => x.code)).toEqual(["B-1"]);
    expect(p.categories.map((c) => c.slug)).toEqual(["wax"]);
    expect(p.definitions).toEqual([]);
  });
});

describe("mapping schema guards", () => {
  const variant = (patch: (m: typeof raw) => void) => {
    const m = structuredClone(raw);
    patch(m);
    return CatalogMappingSchema.safeParse(m).success;
  };
  it("accepts only DRAFT masters and HIDDEN BV listings", () => {
    expect(variant(() => {})).toBe(true);
    expect(
      variant((m) => {
        (m.products[0]!.import.listing as { visibility: string }).visibility = "VISIBLE";
      }),
    ).toBe(false);
    expect(
      variant((m) => {
        (m.products[0]!.import.master as { status: string }).status = "APPROVED";
      }),
    ).toBe(false);
  });
  it("refuses values on a held product, unknown categories and duplicate codes", () => {
    expect(
      variant((m) => {
        m.products[0]!.readiness = "SPEC_HOLD";
      }),
    ).toBe(false);
    expect(
      variant((m) => {
        m.products[1]!.import.listing.categorySlug = "nowhere";
      }),
    ).toBe(false);
    expect(
      variant((m) => {
        m.products[2]!.code = "A-1";
        m.products[2]!.import.master.code = "A-1";
      }),
    ).toBe(false);
  });
});

describe("cli arguments", () => {
  it("is a dry run unless --apply; --confirm only with --apply", () => {
    expect(parseArgs(["--mapping", "m.json"])).toMatchObject({ apply: false, confirm: undefined });
    expect(
      parseArgs(["--mapping", "m.json", "--apply", "--confirm", "3", "--only", "A-1, B-1"]),
    ).toMatchObject({ apply: true, confirm: 3, only: new Set(["A-1", "B-1"]) });
    expect(() => parseArgs(["--mapping", "m.json", "--confirm", "3"])).toThrow(/only used/);
    expect(() => parseArgs(["--apply"])).toThrow(/--mapping/);
    expect(() => parseArgs(["--mapping", "m.json", "--confirm", "x", "--apply"])).toThrow();
    expect(() => parseArgs(["--mapping", "m.json", "--force"])).toThrow(/unknown/);
  });
});
