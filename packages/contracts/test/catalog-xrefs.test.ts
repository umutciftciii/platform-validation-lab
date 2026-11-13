// DP-091: publication acknowledgement and the fixed public wording of cross-references.
import { describe, expect, it } from "vitest";
import {
  CrossReferenceSiteRequestSchema,
  XREF_PUBLIC_LABELS,
  XREF_PUBLICATION_ACK_TEXT,
  XREF_PUBLICATION_ACK_VERSION,
  xrefPublicNotice,
} from "../src/index.js";

const ACK = { version: XREF_PUBLICATION_ACK_VERSION, accepted: true };

describe("CrossReferenceSiteRequestSchema", () => {
  it("needs the current acknowledgement to show, none to hide", () => {
    expect(CrossReferenceSiteRequestSchema.safeParse({ visible: true, version: 1 }).success).toBe(
      false,
    );
    expect(
      CrossReferenceSiteRequestSchema.safeParse({ visible: true, version: 1, acknowledgement: ACK })
        .success,
    ).toBe(true);
    for (const acknowledgement of [
      { ...ACK, accepted: false },
      { ...ACK, version: "DP-091/2020-01-01" },
      { ...ACK, extra: 1 },
    ]) {
      expect(
        CrossReferenceSiteRequestSchema.safeParse({ visible: true, version: 1, acknowledgement })
          .success,
      ).toBe(false);
    }
    expect(CrossReferenceSiteRequestSchema.safeParse({ visible: false, version: 1 }).success).toBe(
      true,
    );
  });
});

describe("public wording", () => {
  const notice = xrefPublicNotice("Dream Petroleum BV");

  it("identifies and compares only, with no affiliation, approval or performance claim", () => {
    expect(notice).toMatch(/trademarks of their respective owners/);
    expect(notice).toMatch(/only to identify and compare products/);
    expect(notice).toMatch(/not affiliated with, endorsed by or approved by/);
    expect(notice).toMatch(/not a verified equivalent/);
    expect(notice).toMatch(/not a manufacturer approval/);
    expect(notice).toMatch(/no claim of exact equivalence or superior performance/);
    expect(XREF_PUBLIC_LABELS.SIMILAR).toBe("Comparable product, not a verified equivalent");
    // No positive superiority or equivalence wording anywhere.
    for (const text of [notice, XREF_PUBLIC_LABELS.SIMILAR, XREF_PUBLIC_LABELS.VERIFIED]) {
      expect(text).not.toMatch(/\b(better|superior to|outperforms|same as|identical|replaces)\b/i);
    }
  });

  it("the acknowledgement covers every publication rule", () => {
    expect(XREF_PUBLICATION_ACK_TEXT).toMatch(/identify and compare/);
    expect(XREF_PUBLICATION_ACK_TEXT).toMatch(
      /no partnership, affiliation, endorsement or manufacturer approval/,
    );
    expect(XREF_PUBLICATION_ACK_TEXT).toMatch(/never as a verified equivalent/);
    expect(XREF_PUBLICATION_ACK_TEXT).toMatch(/recorded technical evidence and approval/);
    expect(XREF_PUBLICATION_ACK_TEXT).toMatch(
      /no claim of exact equivalence or superior performance/,
    );
  });
});
