// ML-9 (DP-240, ADR-028 D10): the language of a technical document in the contracts.
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_DEFAULT_LANGUAGE,
  DOCUMENT_SITE_STATES,
  DocumentCreateRequestSchema,
  DocumentUpdateRequestSchema,
  PublicDocumentSchema,
} from "../src/index.js";

describe("document language", () => {
  it("a new document without a language is English (callers of before ML-9)", () => {
    expect(DOCUMENT_DEFAULT_LANGUAGE).toBe("en");
    expect(DocumentCreateRequestSchema.parse({ type: "TDS", title: "TDS" }).language).toBe("en");
    expect(
      DocumentCreateRequestSchema.parse({ type: "TDS", title: "TDS", language: "nl" }).language,
    ).toBe("nl");
  });

  it("an update without a language keeps it (undefined, not English)", () => {
    const base = { type: "TDS", title: "TDS", accessPolicy: "PUBLIC", version: 1 };
    expect(DocumentUpdateRequestSchema.parse(base).language).toBeUndefined();
    expect(DocumentUpdateRequestSchema.parse({ ...base, language: "nl" }).language).toBe("nl");
  });

  it("accepts BCP 47 tags only (the database CHECK)", () => {
    for (const bad of ["NL", "english", "", "nl_NL", "n", 12]) {
      expect(
        DocumentCreateRequestSchema.safeParse({ type: "TDS", title: "T", language: bad }).success,
        String(bad),
      ).toBe(false);
    }
    expect(
      DocumentCreateRequestSchema.safeParse({ type: "TDS", title: "T", language: "pt-BR" }).success,
    ).toBe(true);
  });

  it("public documents carry their language (English by default); a closed language has a state", () => {
    const doc = {
      id: "0190f2a1-0000-7000-8000-000000000001",
      type: "TDS",
      title: "TDS",
      description: null,
      access: "PUBLIC",
      downloadable: true,
      requestable: false,
      revisionNumber: 1,
      byteSize: 10,
      pageCount: 1,
      updatedAt: "2026-11-22T10:00:00.000Z",
    };
    // an answer of before ML-9 (mixed deployment) reads as English
    expect(PublicDocumentSchema.parse(doc).language).toBe("en");
    expect(PublicDocumentSchema.parse({ ...doc, language: "nl" }).language).toBe("nl");
    expect(DOCUMENT_SITE_STATES).toContain("language_not_public");
  });
});
