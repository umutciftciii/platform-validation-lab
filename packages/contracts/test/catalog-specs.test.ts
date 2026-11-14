// PM-2: specification contracts and the shared validation engine (BLOCKING vs WARNING), the one
// PM-3 will use to gate publication.
import { describe, expect, it } from "vitest";
import {
  checkSpecValue,
  ImageUpdateRequestSchema,
  SpecDefinitionCreateRequestSchema,
  SpecDefinitionUpdateRequestSchema,
  SpecValueDataSchema,
  SpecValuesSaveRequestSchema,
  validateProductData,
  type DefinitionRule,
} from "../src/index.js";

const visc: DefinitionRule = {
  id: "d1",
  key: "kv100",
  name: "Kinematic viscosity at 100 °C",
  dataType: "NUMBER",
  units: ["mm²/s", "cSt"],
  testMethods: ["ASTM D445"],
  required: true,
  minValue: 0,
  maxValue: 1000,
  decimals: 2,
  maxLength: null,
  archived: false,
};
const pour: DefinitionRule = {
  ...visc,
  id: "d2",
  key: "pour_point",
  name: "Pour point",
  dataType: "RANGE",
  units: ["°C"],
  required: false,
  minValue: -80,
  maxValue: 50,
};
const appearance: DefinitionRule = {
  ...visc,
  id: "d3",
  key: "appearance",
  name: "Appearance",
  dataType: "TEXT",
  units: [],
  testMethods: [],
  required: false,
  minValue: null,
  maxValue: null,
  decimals: null,
  maxLength: 20,
};
const food: DefinitionRule = {
  ...appearance,
  id: "d4",
  key: "food_grade",
  name: "Food grade",
  dataType: "BOOLEAN",
  maxLength: null,
};
const old: DefinitionRule = {
  ...appearance,
  id: "d5",
  key: "old",
  name: "Old",
  required: true,
  archived: true,
};
const defs = [visc, pour, appearance, food, old];

const codes = (list: { code: string }[]) => list.map((i) => i.code);

describe("definition contracts", () => {
  it("accepts a numeric definition and normalises its key", () => {
    const d = SpecDefinitionCreateRequestSchema.parse({
      key: " KV100 ",
      name: "KV",
      dataType: "NUMBER",
      units: ["mm²/s"],
      minValue: 0,
      maxValue: 10,
    });
    expect(d).toMatchObject({ key: "kv100", required: false, testMethods: [], decimals: null });
  });
  it("refuses rules that do not fit the type, bad keys and inverted bounds", () => {
    const bad = (x: object) =>
      SpecDefinitionCreateRequestSchema.safeParse({ key: "k1", name: "n", dataType: "TEXT", ...x })
        .success;
    expect(bad({ units: ["°C"] })).toBe(false);
    expect(bad({ minValue: 1 })).toBe(false);
    expect(bad({ dataType: "NUMBER", maxLength: 3 })).toBe(false);
    expect(bad({ dataType: "NUMBER", minValue: 5, maxValue: 1 })).toBe(false);
    expect(bad({ key: "9bad" })).toBe(false);
    expect(bad({ dataType: "NUMBER", units: ["a", "a"] })).toBe(false);
    expect(bad({ testMethods: ["<script>"] })).toBe(false);
    expect(
      SpecDefinitionUpdateRequestSchema.safeParse({ name: "n", dataType: "TEXT" }).success,
    ).toBe(false);
  });
  it("values are a typed union; alt text is trimmed to null", () => {
    expect(
      SpecValuesSaveRequestSchema.safeParse({
        version: 1,
        values: [
          {
            definitionId: "0190f2a1-0000-7000-8000-000000000000",
            value: { type: "NUMBER", number: "5" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(ImageUpdateRequestSchema.parse({ altText: "   ", version: 1 }).altText).toBeNull();
  });
});

describe("validation engine", () => {
  it("BLOCKING: wrong type, unit, inverted range, bounds, precision and length", () => {
    expect(
      codes(
        checkSpecValue(visc, {
          definitionId: "d1",
          value: { type: "TEXT", text: "x" },
          unit: "cSt",
          testMethod: "ASTM D445",
        }),
      ),
    ).toEqual(["invalid_type"]);
    expect(
      codes(
        checkSpecValue(visc, {
          definitionId: "d1",
          value: { type: "NUMBER", number: 5.8 },
          unit: "°C",
          testMethod: "ASTM D445",
        }),
      ),
    ).toEqual(["invalid_unit"]);
    expect(
      codes(
        checkSpecValue(visc, {
          definitionId: "d1",
          value: { type: "NUMBER", number: 5.8 },
          unit: null,
          testMethod: "ASTM D445",
        }),
      ),
    ).toEqual(["invalid_unit"]);
    expect(
      codes(
        checkSpecValue(appearance, {
          definitionId: "d3",
          value: { type: "TEXT", text: "Clear" },
          unit: "mm",
          testMethod: null,
        }),
      ),
    ).toEqual(["invalid_unit"]);
    expect(
      codes(
        checkSpecValue(pour, {
          definitionId: "d2",
          value: { type: "RANGE", min: 10, max: -10, minExclusive: false, maxExclusive: false },
          unit: "°C",
          testMethod: "ASTM D445",
        }),
      ),
    ).toEqual(["invalid_range"]);
    // DP-156: one-sided and open ranges; shape problems are invalid_range
    const range = (r: object) =>
      codes(
        checkSpecValue(pour, {
          definitionId: "d2",
          value: SpecValueDataSchema.parse({ type: "RANGE", ...r }),
          unit: "°C",
          testMethod: "ASTM D445",
        }),
      );
    expect(range({ min: null, max: -30 })).toEqual([]);
    expect(range({ min: -30, max: null, minExclusive: true })).toEqual([]);
    expect(range({ min: -45, max: -30, maxExclusive: true })).toEqual([]);
    expect(range({ min: -42, max: -42 })).toEqual([]);
    expect(range({ min: null, max: null })).toEqual(["invalid_range"]);
    expect(range({ min: null, max: -30, minExclusive: true })).toEqual(["invalid_range"]);
    expect(range({ min: -42, max: -42, maxExclusive: true })).toEqual(["invalid_range"]);
    expect(
      codes(
        checkSpecValue(visc, {
          definitionId: "d1",
          value: { type: "NUMBER", number: 1001 },
          unit: "cSt",
          testMethod: "ASTM D445",
        }),
      ),
    ).toEqual(["out_of_bounds"]);
    expect(
      codes(
        checkSpecValue(visc, {
          definitionId: "d1",
          value: { type: "NUMBER", number: 5.123 },
          unit: "cSt",
          testMethod: "ASTM D445",
        }),
      ),
    ).toEqual(["too_precise"]);
    expect(
      codes(
        checkSpecValue(appearance, {
          definitionId: "d3",
          value: { type: "TEXT", text: "x".repeat(21) },
          unit: null,
          testMethod: null,
        }),
      ),
    ).toEqual(["too_long"]);
    expect(
      checkSpecValue(visc, {
        definitionId: "d1",
        value: { type: "NUMBER", number: 5.85 },
        unit: "mm²/s",
        testMethod: "ASTM D445",
      }),
    ).toEqual([]);
  });

  it("WARNING: missing test method; precision handles exponent notation", () => {
    const r = checkSpecValue(visc, {
      definitionId: "d1",
      value: { type: "NUMBER", number: 5 },
      unit: "cSt",
      testMethod: null,
    });
    expect(r.map((i) => [i.severity, i.code])).toEqual([["WARNING", "test_method_missing"]]);
    expect(
      codes(
        checkSpecValue(
          { ...visc, minValue: null },
          {
            definitionId: "d1",
            value: { type: "NUMBER", number: 1e-7 },
            unit: "cSt",
            testMethod: "x1",
          },
        ),
      ),
    ).toEqual(["too_precise"]);
  });

  it("DP-156: a typical value never satisfies a required specification", () => {
    const typicalOnly = validateProductData({
      definitions: [visc],
      values: [
        {
          definitionId: "d1",
          basis: "TYPICAL",
          value: { type: "NUMBER", number: 5.8 },
          unit: "mm²/s",
          testMethod: null,
        },
      ],
      images: [],
    });
    expect(typicalOnly.blocking.map((i) => [i.code, i.target])).toEqual([
      ["required_missing", "spec:kv100"],
    ]);
    expect(typicalOnly.warnings.map((i) => [i.code, i.target])).toEqual([
      ["test_method_missing", "spec:kv100:typical"],
    ]);
    // the save request defaults the basis and the open ends
    const req = SpecValuesSaveRequestSchema.parse({
      version: 1,
      values: [
        {
          definitionId: "0190a8f0-0000-7000-8000-000000000001",
          value: { type: "RANGE", min: null, max: -30 },
        },
      ],
    });
    expect(req.values[0]).toMatchObject({
      basis: "SPECIFICATION",
      value: { type: "RANGE", min: null, max: -30, minExclusive: false, maxExclusive: false },
    });
  });

  it("reports required as BLOCKING, optional and alt text as WARNING, ignores archived", () => {
    const empty = validateProductData({
      definitions: defs,
      values: [],
      images: [
        { id: "i1", altText: null },
        { id: "i2", altText: "Drum" },
      ],
    });
    expect(empty.ok).toBe(false);
    expect(empty.blocking.map((i) => [i.code, i.target])).toEqual([
      ["required_missing", "spec:kv100"],
    ]);
    expect(empty.warnings.map((i) => [i.code, i.target])).toEqual([
      ["optional_missing", "spec:pour_point"],
      ["optional_missing", "spec:appearance"],
      ["optional_missing", "spec:food_grade"],
      ["alt_text_missing", "image:i1"],
    ]);
    const full = validateProductData({
      definitions: defs,
      values: [
        {
          definitionId: "d1",
          value: { type: "NUMBER", number: 5.8 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
        {
          definitionId: "d2",
          value: { type: "RANGE", min: -30, max: -20, minExclusive: false, maxExclusive: false },
          unit: "°C",
          testMethod: "ASTM D445",
        },
        {
          definitionId: "d3",
          value: { type: "TEXT", text: "Clear" },
          unit: null,
          testMethod: null,
        },
        {
          definitionId: "d4",
          value: { type: "BOOLEAN", boolean: false },
          unit: null,
          testMethod: null,
        },
        {
          definitionId: "gone",
          value: { type: "BOOLEAN", boolean: true },
          unit: null,
          testMethod: null,
        },
      ],
      images: [],
    });
    expect(full.blocking.map((i) => i.code)).toEqual(["unknown_definition"]);
    expect(full.warnings).toEqual([]);
  });
});
