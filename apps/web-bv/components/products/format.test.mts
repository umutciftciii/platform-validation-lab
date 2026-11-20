// DP-156 + ML-6: specification values per language; numbers in the locale's format, units,
// signs and symbols never translated.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicProduct } from "@dream/contracts";

import { formatSpecValue } from "./format.ts";

type Spec = PublicProduct["specs"][number];

const spec = (value: Spec["value"], unit: string | null = "mm²/s", key = "kv40"): Spec =>
  ({ key, name: "x", unit, value, basis: "SPECIFICATION", testMethod: null }) as unknown as Spec;

const range = (min: number | null, max: number | null, minExclusive = false, maxExclusive = false) =>
  ({ type: "RANGE", min, max, minExclusive, maxExclusive }) as Spec["value"];

describe("formatSpecValue", () => {
  it("English: unchanged by ML-6 (default locale)", () => {
    assert.equal(formatSpecValue(spec({ type: "NUMBER", number: 6.1 } as Spec["value"])), "6.1 mm²/s");
    assert.equal(formatSpecValue(spec(range(3.8, 4.5, false, true))), "3.8 to < 4.5 mm²/s");
    assert.equal(formatSpecValue(spec(range(-45, -36), "°C")), "-45 to -36 °C");
    assert.equal(formatSpecValue(spec(range(null, 1800, false, true), "mPa·s")), "< 1,800 mPa·s");
    assert.equal(formatSpecValue(spec(range(200, null), "°C")), "≥ 200 °C");
    assert.equal(formatSpecValue(spec(range(30, null), null, "color_saybolt")), "≥ +30");
    assert.equal(formatSpecValue(spec({ type: "BOOLEAN", boolean: true } as Spec["value"], null)), "Yes");
    assert.equal(formatSpecValue(spec({ type: "TEXT", text: "Clear & bright" } as Spec["value"], null)), "Clear & bright");
  });

  it("English with the explicit locale is the same", () => {
    assert.equal(formatSpecValue(spec(range(3.8, 4.5, false, true)), "en"), "3.8 to < 4.5 mm²/s");
  });

  it("Dutch: decimal comma, grouping point, 'tot', Ja/Nee; units and signs as specified", () => {
    assert.equal(formatSpecValue(spec({ type: "NUMBER", number: 6.1 } as Spec["value"]), "nl"), "6,1 mm²/s");
    assert.equal(formatSpecValue(spec(range(3.8, 4.5, false, true)), "nl"), "3,8 tot < 4,5 mm²/s");
    assert.equal(formatSpecValue(spec(range(-45, -36), "°C"), "nl"), "-45 tot -36 °C");
    assert.equal(formatSpecValue(spec(range(null, 1800, false, true), "mPa·s"), "nl"), "< 1.800 mPa·s");
    assert.equal(formatSpecValue(spec(range(30, null), null, "color_saybolt"), "nl"), "≥ +30");
    assert.equal(formatSpecValue(spec({ type: "BOOLEAN", boolean: false } as Spec["value"], null), "nl"), "Nee");
    // Text values are catalogue content (ML-8), never translated here.
    assert.equal(formatSpecValue(spec({ type: "TEXT", text: "Clear & bright" } as Spec["value"], null), "nl"), "Clear & bright");
  });
});
