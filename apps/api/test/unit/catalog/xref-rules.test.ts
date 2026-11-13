// PM-6 (DP-036): pure cross-reference rules: specification fingerprint, stale verifications,
// what a public site may show, and the site state shown in the admin.
import { globalNameKey } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import {
  crossReferenceSiteState,
  publicRelation,
  specFingerprint,
  staleReasons,
  verificationState,
  type SpecValueFact,
  type VerificationFacts,
} from "../../../src/catalog/xref-rules.js";

const dec = (v: string) => ({ toString: () => v });
const kv: SpecValueFact = {
  key: "kv100",
  numberValue: dec("6.120000"),
  rangeMin: null,
  rangeMax: null,
  textValue: null,
  booleanValue: null,
  unit: "mm²/s",
  testMethod: "ASTM D445",
};
const vi: SpecValueFact = {
  ...kv,
  key: "vi",
  numberValue: dec("128"),
  unit: null,
  testMethod: null,
};

const HASH = specFingerprint([kv, vi]);
const current: VerificationFacts = {
  status: "VERIFIED",
  sourceRevisionActive: true,
  sourceDocumentActive: true,
  verifiedSpecHash: HASH,
  currentSpecHash: HASH,
  verifiedGlobalVersion: 3,
  globalVersion: 3,
  globalActive: true,
};

describe("specFingerprint", () => {
  it("is stable under order and changes with any value, unit or method", () => {
    expect(specFingerprint([vi, kv])).toBe(HASH);
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(specFingerprint([{ ...kv, numberValue: dec("6.130000") }, vi])).not.toBe(HASH);
    expect(specFingerprint([{ ...kv, unit: "cSt" }, vi])).not.toBe(HASH);
    expect(specFingerprint([{ ...kv, testMethod: "ISO 3104" }, vi])).not.toBe(HASH);
    expect(specFingerprint([kv])).not.toBe(HASH);
    expect(specFingerprint([])).not.toBe(HASH);
  });
});

describe("verification state", () => {
  it("is current only while source, specs and global product are unchanged", () => {
    expect(verificationState(current)).toBe("current");
    expect(staleReasons(current)).toEqual([]);
    expect(staleReasons({ ...current, sourceRevisionActive: false })).toEqual([
      "source_revision_replaced",
    ]);
    expect(staleReasons({ ...current, sourceDocumentActive: false })).toEqual([
      "source_document_archived",
    ]);
    expect(staleReasons({ ...current, currentSpecHash: "f".repeat(64) })).toEqual([
      "specs_changed",
    ]);
    expect(staleReasons({ ...current, globalVersion: 4 })).toEqual(["global_product_changed"]);
    expect(staleReasons({ ...current, globalActive: false })).toEqual(["global_product_archived"]);
    expect(verificationState({ ...current, globalVersion: 4 })).toBe("stale");
  });

  it("knows pending and plain relations", () => {
    expect(verificationState({ ...current, status: "PENDING_VERIFICATION" })).toBe("pending");
    expect(verificationState({ ...current, status: "SIMILAR" })).toBe("none");
    expect(staleReasons({ ...current, status: "SIMILAR", sourceRevisionActive: null })).toEqual([]);
    // A pending request names evidence that must still be the active revision.
    expect(
      staleReasons({ ...current, status: "PENDING_VERIFICATION", sourceRevisionActive: false }),
    ).toEqual(["source_revision_replaced"]);
  });
});

describe("publicRelation", () => {
  it("never shows a stale, removed or archived relation, nor an unverified one as VERIFIED", () => {
    expect(publicRelation(current)).toBe("VERIFIED");
    expect(publicRelation({ ...current, currentSpecHash: "0".repeat(64) })).toBeNull();
    expect(publicRelation({ ...current, status: "PENDING_VERIFICATION" })).toBe("SIMILAR");
    expect(publicRelation({ ...current, status: "SIMILAR" })).toBe("SIMILAR");
    expect(publicRelation({ ...current, status: "REMOVED" })).toBeNull();
    expect(publicRelation({ ...current, status: "SIMILAR", globalActive: false })).toBeNull();
  });
});

describe("crossReferenceSiteState", () => {
  it("is shown only when enabled, live and the relation holds", () => {
    const s = (f: Partial<VerificationFacts>, enabled = true, productLive = true) =>
      crossReferenceSiteState({ facts: { ...current, ...f }, enabled, productLive });
    expect(s({})).toEqual({ state: "shown", shownAs: "VERIFIED" });
    expect(s({ status: "SIMILAR" })).toEqual({ state: "shown", shownAs: "SIMILAR" });
    expect(s({}, false)).toEqual({ state: "hidden", shownAs: null });
    expect(s({}, true, false)).toEqual({ state: "product_not_live", shownAs: null });
    expect(s({ globalVersion: 9 })).toEqual({ state: "verification_stale", shownAs: null });
    expect(s({ status: "REMOVED" })).toEqual({ state: "not_publishable", shownAs: null });
  });
});

describe("globalNameKey", () => {
  it("collapses whitespace and case; the grade is part of the key", () => {
    expect(globalNameKey("  Example   BRAND ")).toBe("example brand");
    expect(globalNameKey("Base 6", "Group III")).toBe("base 6 | group iii");
    expect(globalNameKey("Base 6", null)).toBe("base 6");
  });
});
