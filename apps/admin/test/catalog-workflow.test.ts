// PM-3: the specification form's live validation (one engine for field messages, summary and the
// server) and the workflow's error messages.
import type { ProductValidation, SpecDefinition } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { messageForIssues } from "../lib/catalog-client";
import { draftsDiffer, liveValidation, type Draft } from "../lib/spec-validation";

const def = (over: Partial<SpecDefinition>): SpecDefinition => ({
  id: "d-kv",
  key: "kv100",
  name: "KV100",
  dataType: "NUMBER",
  units: ["mm²/s"],
  testMethods: ["ASTM D445"],
  required: true,
  minValue: null,
  maxValue: null,
  decimals: 2,
  maxLength: null,
  sortOrder: 0,
  archived: false,
  version: 1,
  valueCount: 0,
  updatedAt: "2026-11-11T10:00:00.000Z",
  ...over,
});
const KV = def({});
const FLASH = def({
  id: "d-fp",
  key: "flash",
  name: "Flash point",
  units: ["°C"],
  testMethods: ["ASTM D92"],
  required: false,
});
const blank: Draft = {
  on: false,
  basis: "SPECIFICATION",
  number: "",
  min: "",
  max: "",
  minExclusive: false,
  maxExclusive: false,
  text: "",
  bool: "",
  unit: "mm²/s",
  testMethod: "",
};
const server: ProductValidation = {
  ok: false,
  blocking: [],
  warnings: [
    { severity: "WARNING", code: "test_method_missing", target: "spec:kv100", message: "saved" },
    {
      severity: "WARNING",
      code: "alt_text_missing",
      target: "image:i1",
      message: "An image has no alt text.",
    },
  ],
};
const codes = (v: ProductValidation) => ({
  blocking: v.blocking.map((i) => `${i.code}@${i.target}`),
  warnings: v.warnings.map((i) => `${i.code}@${i.target}`),
});

describe("live specification validation (unsaved values)", () => {
  it("a test method typed but not saved clears the warning in the summary at once", () => {
    const typed = { "d-kv": { ...blank, on: true, number: "6.1", testMethod: "ASTM D445" } };
    const v = liveValidation([KV], typed, server);
    expect(codes(v)).toEqual({ blocking: [], warnings: ["alt_text_missing@image:i1"] });
    const without = liveValidation(
      [KV],
      { "d-kv": { ...typed["d-kv"], testMethod: "  " } },
      server,
    );
    expect(codes(without).warnings).toEqual([
      "test_method_missing@spec:kv100",
      "alt_text_missing@image:i1",
    ]);
  });

  it("a cleared required value is BLOCKING before it is saved; a half-typed one only once", () => {
    expect(codes(liveValidation([KV], { "d-kv": blank }, server)).blocking).toEqual([
      "required_missing@spec:kv100",
    ]);
    const half = liveValidation([KV], { "d-kv": { ...blank, on: true, number: "abc" } }, server);
    expect(codes(half).blocking).toEqual(["invalid_type@spec:kv100"]);
    expect(half.ok).toBe(false);
  });

  it("uses the engine's own rules for typed values (precision, unit); no optional noise", () => {
    const v = liveValidation(
      [KV, FLASH],
      {
        "d-kv": { ...blank, on: true, number: "6.123", testMethod: "ASTM D445" },
        "d-fp": { ...blank, unit: "°C" },
      },
      { ok: true, blocking: [], warnings: [] },
    );
    expect(codes(v)).toEqual({
      blocking: ["too_precise@spec:kv100"],
      warnings: [],
    });
  });

  it("DP-156: a typical value is checked on its own target and never satisfies required", () => {
    const v = liveValidation(
      [KV],
      {
        "d-kv": blank,
        "d-kv:typical": { ...blank, basis: "TYPICAL", on: true, number: "6.123" },
      },
      { ok: true, blocking: [], warnings: [] },
    );
    expect(codes(v).blocking).toEqual([
      "required_missing@spec:kv100",
      "too_precise@spec:kv100:typical",
    ]);
  });

  it("knows when the form differs from the saved values", () => {
    const a = { "d-kv": { ...blank, on: true, number: "6.1" } };
    expect(draftsDiffer(a, { "d-kv": { ...blank, on: true, number: "6.1" } })).toBe(false);
    expect(draftsDiffer(a, { "d-kv": { ...blank, on: true, number: "6.2" } })).toBe(true);
    // A switched-off value's leftover text is not a difference.
    expect(draftsDiffer({ "d-kv": blank }, { "d-kv": { ...blank, number: "9" } })).toBe(false);
  });
});

describe("workflow messages", () => {
  it("explains separation of duties, stale listings and blocked publication", () => {
    expect(messageForIssues("FORBIDDEN", [{ path: "(root)", rule: "own_change" }])).toMatch(
      /another reviewer must decide/,
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "listingVersion", rule: "stale" }])).toMatch(
      /listing changed/,
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "images", rule: "cover_missing" }])).toMatch(
      /cover image/,
    );
    expect(
      messageForIssues("VALIDATION_FAILED", [{ path: "spec:kv100", rule: "required_missing" }]),
    ).toMatch(/blocking specification issues/);
  });
});
