// ML-13a (DP-244): the decision for one unit of a translation package and its helpers.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalDigest,
  decideUnit,
  issuePathOf,
  norm,
  normHash,
  textHash,
  textProblem,
  verified,
  writes,
} from "../../../src/translation-packages/units.js";

const h = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("hashes and normal form", () => {
  it("hashes UTF-8 text; the digest does not depend on key order", () => {
    expect(textHash("Über uns")).toBe(h("Über uns"));
    expect(canonicalDigest({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      canonicalDigest({ a: { c: null, d: [1, 2] }, b: 1 }),
    );
    expect(canonicalDigest({ a: [1, 2] })).not.toBe(canonicalDigest({ a: [2, 1] }));
  });

  it("trims; blank and null are no text", () => {
    expect(norm("  Over ons \n")).toBe("Over ons");
    expect(norm("   ")).toBeNull();
    expect(norm(null)).toBeNull();
    expect(norm(undefined)).toBeNull();
    expect(normHash(null)).toBeNull();
    expect(normHash("x")).toBe(h("x"));
  });

  it("refuses control characters and texts over the limit (line breaks and tabs are fine)", () => {
    expect(textProblem("a\u0007b", 10)).toBe("control_characters");
    expect(textProblem("x".repeat(11), 10)).toBe("too_long");
    expect(textProblem("line\nline\tx", 20)).toBeNull();
    expect(textProblem("x".repeat(500), null)).toBeNull();
  });
});

describe("decideUnit", () => {
  const base = {
    sourceHash: h("About us"),
    sourceNow: "About us",
    target: "Over ons",
    problem: null,
    currentHash: null,
    currentNow: null,
  };

  it("outdated first: a removed or changed source is never written", () => {
    expect(decideUnit({ ...base, sourceNow: null })).toEqual({
      status: "outdated",
      rule: "source_removed",
    });
    expect(decideUnit({ ...base, sourceNow: "About" })).toEqual({
      status: "outdated",
      rule: "source_changed",
    });
    // Even without a translation the report says the source changed.
    expect(decideUnit({ ...base, sourceNow: "About", target: null }).status).toBe("outdated");
  });

  it("no translation: empty; an invalid one: invalid with its rule", () => {
    expect(decideUnit({ ...base, target: null })).toEqual({ status: "empty", rule: null });
    expect(decideUnit({ ...base, problem: "too_long" })).toEqual({
      status: "invalid",
      rule: "too_long",
    });
  });

  it("the same text already there: unchanged (a repeated import writes nothing)", () => {
    expect(
      decideUnit({ ...base, currentNow: "Over ons", currentHash: h("Something else") }),
    ).toEqual({ status: "unchanged", rule: null });
  });

  it("the target changed since the export: conflict; else create or update", () => {
    expect(decideUnit({ ...base, currentNow: "Wie wij zijn", currentHash: null })).toEqual({
      status: "conflict",
      rule: "target_changed",
    });
    expect(decideUnit({ ...base, currentNow: null, currentHash: h("Oud") })).toEqual({
      status: "conflict",
      rule: "target_changed",
    });
    expect(decideUnit(base)).toEqual({ status: "create", rule: null });
    expect(decideUnit({ ...base, currentNow: "Oud", currentHash: h("Oud") })).toEqual({
      status: "update",
      rule: null,
    });
  });

  it("verified and writes", () => {
    expect(verified({ status: "unchanged", rule: null })).toBe(true);
    expect(verified({ status: "create", rule: null })).toBe(true);
    expect(verified({ status: "conflict", rule: "x" })).toBe(false);
    expect(verified(undefined)).toBe(false);
    expect(writes({ status: "unchanged", rule: null })).toBe(false);
    expect(writes({ status: "update", rule: null })).toBe(true);
  });
});

describe("issuePathOf", () => {
  it("maps a section id to its position; other paths unchanged", () => {
    const content = { sections: [{ id: "sec-a-000001" }, { id: "sec-b-000002" }] };
    expect(issuePathOf("sections.@sec-b-000002.items.0.title", content)).toBe(
      "sections.1.items.0.title",
    );
    expect(issuePathOf("sections.@sec-x-000009.title", content)).toBe(
      "sections.@sec-x-000009.title",
    );
    expect(issuePathOf("excerpt", content)).toBe("excerpt");
  });
});
