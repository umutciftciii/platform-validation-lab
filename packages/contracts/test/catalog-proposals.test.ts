// DP-171 (ADR-022): content proposal schemas — customer text never carries review notes, review
// data is strict, requests for changes need a reason and the dataset refuses duplicate codes.
import { describe, expect, it } from "vitest";
import {
  CreateProposalRequestSchema,
  ProposalDatasetSchema,
  ProposalReviewDataSchema,
  RequestProposalChangesRequestSchema,
  ReviseProposalRequestSchema,
  proposalContentKey,
} from "../src/index.js";

const reviewData = {
  schemaVersion: 1,
  family: "Group II base oil",
  items: [
    {
      kind: "DP002_HELD",
      field: "spec:pour_point",
      text: "Two pour point limits on one page (GOST 20287 / GOST 32463).",
      sourceIds: ["A-S02"],
      heldValue: {
        definition: "pour_point",
        basis: "SPECIFICATION",
        raw: "Pour point, max: Minus 15 °C [GOST 20287]",
        conflict: true,
        finding: "Method letter of GOST 20287 not stated.",
      },
    },
    {
      kind: "CONFIRM",
      field: "packaging",
      text: "Packaging options.",
      sourceIds: [],
      heldValue: null,
    },
  ],
  sources: [
    {
      id: "A-S02",
      title: "GOST 20287-91",
      url: "https://example.test/gost",
      level: "B",
      documentDate: "1991",
    },
  ],
};

const sha = "a".repeat(64);
const create = {
  productId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  locale: "en",
  summary: "Group II base oil for lubricant blending.",
  description: "A base oil offered as a blending component.",
  reviewData,
  sourceRef: "docs/catalog/proposals/bv-content-proposals.json",
  sourceSha256: sha,
};

describe("content proposal requests", () => {
  it("accepts a proposal and a placeholder without text", () => {
    expect(CreateProposalRequestSchema.parse(create).summary).toBe(create.summary);
    const placeholder = CreateProposalRequestSchema.parse({
      ...create,
      summary: null,
      description: null,
    });
    expect(placeholder.summary).toBeNull();
  });

  it("refuses review notes in customer text", () => {
    for (const field of ["summary", "description"] as const) {
      const r = CreateProposalRequestSchema.safeParse({
        ...create,
        [field]: "Text `[CONFIRM: TDS]`",
      });
      expect(r.success).toBe(false);
    }
    expect(
      ReviseProposalRequestSchema.safeParse({ ...create, version: 1, productId: undefined })
        .success,
    ).toBe(false);
  });

  it("DP-191: a revision may carry only the changed text; left out is not null", () => {
    const only = ReviseProposalRequestSchema.parse({ version: 3, description: "New text." });
    expect(only).toEqual({ version: 3, description: "New text.", comment: null });
    expect("summary" in only).toBe(false);
    expect("reviewData" in only).toBe(false);
    // null clears a text; it is not the same as leaving the field out.
    expect(ReviseProposalRequestSchema.parse({ version: 3, summary: null }).summary).toBeNull();
    // null is not a value for the review data, the source reference or the source hash.
    for (const field of ["reviewData", "sourceRef", "sourceSha256"] as const) {
      expect(ReviseProposalRequestSchema.safeParse({ version: 3, [field]: null }).success).toBe(
        false,
      );
    }
    // The full body of the import tool is still accepted, and the rules still apply.
    const full = {
      summary: create.summary,
      description: create.description,
      reviewData,
      sourceRef: create.sourceRef,
      sourceSha256: create.sourceSha256,
    };
    expect(ReviseProposalRequestSchema.safeParse({ ...full, version: 1 }).success).toBe(true);
    expect(
      ReviseProposalRequestSchema.safeParse({ version: 1, summary: "[CONFIRM: grade]" }).success,
    ).toBe(false);
    expect(ReviseProposalRequestSchema.safeParse({ version: 1, summary: "  " }).success).toBe(
      false,
    );
    expect(
      ReviseProposalRequestSchema.safeParse({ version: 1, description: "x".repeat(8001) }).success,
    ).toBe(false);
    expect(
      ReviseProposalRequestSchema.safeParse({ version: 1, description: "x".repeat(8000) }).success,
    ).toBe(true);
    expect(ReviseProposalRequestSchema.safeParse({ description: "x" }).success).toBe(false);
  });

  it("is strict about review data and limits", () => {
    expect(ProposalReviewDataSchema.safeParse({ ...reviewData, extra: 1 }).success).toBe(false);
    const badKind = { ...reviewData, items: [{ ...reviewData.items[1], kind: "OTHER" }] };
    expect(ProposalReviewDataSchema.safeParse(badKind).success).toBe(false);
    expect(
      CreateProposalRequestSchema.safeParse({ ...create, summary: "x".repeat(501) }).success,
    ).toBe(false);
    expect(CreateProposalRequestSchema.safeParse({ ...create, sourceSha256: "ABC" }).success).toBe(
      false,
    );
    // ML-8a: any well-formed language tag (the API checks it is enabled on the site).
    expect(CreateProposalRequestSchema.safeParse({ ...create, locale: "nl" }).success).toBe(true);
    expect(CreateProposalRequestSchema.safeParse({ ...create, locale: "NL" }).success).toBe(false);
    expect(CreateProposalRequestSchema.safeParse({ ...create, locale: "" }).success).toBe(false);
  });

  it("DP-172: accepts English review data with origin references, and only short hex refs", () => {
    const item = { ...reviewData.items[1], originRef: "0123456789abcdef" };
    const en = { ...reviewData, language: "en", items: [item] };
    expect(ProposalReviewDataSchema.parse(en).language).toBe("en");
    expect(ProposalReviewDataSchema.safeParse({ ...en, language: "de" }).success).toBe(false);
    expect(
      ProposalReviewDataSchema.safeParse({ ...en, items: [{ ...item, originRef: "a".repeat(64) }] })
        .success,
    ).toBe(false);
    expect(ProposalReviewDataSchema.safeParse(reviewData).success).toBe(true);
  });

  it("needs a reason to request changes", () => {
    expect(
      RequestProposalChangesRequestSchema.safeParse({ version: 2, comment: " " }).success,
    ).toBe(false);
    expect(
      RequestProposalChangesRequestSchema.parse({ version: 2, comment: "Shorter text" }).comment,
    ).toBe("Shorter text");
  });

  it("hashes text with a separator so that moved words change the key", () => {
    expect(proposalContentKey("ab", "c")).not.toBe(proposalContentKey("a", "bc"));
    expect(proposalContentKey(null, null)).toBe("\u0000");
  });
});

describe("proposal dataset", () => {
  const dataset = {
    schemaVersion: 1,
    dp: "DP-171",
    site: "BV",
    locale: "en",
    sourceRef: "docs/catalog/proposals/bv-content-proposals.json",
    generatedAt: "2026-11-15T12:00:00.000Z",
    proposals: [{ code: "G2-HVI-4", summary: "S", description: "D", reviewData }],
  };

  it("parses and refuses duplicate codes", () => {
    expect(ProposalDatasetSchema.parse(dataset).proposals).toHaveLength(1);
    const dup = { ...dataset, proposals: [dataset.proposals[0], dataset.proposals[0]] };
    expect(ProposalDatasetSchema.safeParse(dup).success).toBe(false);
  });
});
