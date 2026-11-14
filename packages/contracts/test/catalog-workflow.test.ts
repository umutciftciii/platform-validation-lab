// PM-3: review/publication contracts — request schemas, the publication readiness check that the
// API enforces and the console shows, and the public view of a snapshot (no private fields).
import { describe, expect, it } from "vitest";
import {
  checkPublication,
  PublicProductSchema,
  PublishedSnapshotSchema,
  RequestChangesRequestSchema,
  SubmitReviewRequestSchema,
  toPublicProduct,
  toPublicSummary,
  validateProductData,
  type ReadinessInput,
} from "../src/index.js";

// A master with technical data and nothing to report.
const ok: ReadinessInput["validation"] = { ok: true, blocking: [], warnings: [] };
const base: ReadinessInput = {
  product: { status: "APPROVED", summary: "Synthetic base oil", description: "Long text" },
  listing: { visibility: "VISIBLE", text: null },
  validation: ok,
  images: [{ id: "0190a8c4-7c1e-7000-8000-000000000001", isCover: true, altText: "Drum" }],
};
const codes = (r: ReturnType<typeof checkPublication>) => r.blocking.map((i) => i.code);

describe("checkPublication", () => {
  it("passes an approved, visible, complete product", () => {
    const r = checkPublication(base);
    expect(r).toEqual({ ok: true, blocking: [], warnings: [] });
  });

  it("blocks every state but APPROVED, and names archived separately", () => {
    for (const status of ["DRAFT", "IN_REVIEW"] as const) {
      expect(codes(checkPublication({ ...base, product: { ...base.product, status } }))).toEqual([
        "not_approved",
      ]);
    }
    expect(
      codes(checkPublication({ ...base, product: { ...base.product, status: "ARCHIVED" } })),
    ).toEqual(["archived"]);
  });

  it("needs a visible listing and a cover image; a missing summary only warns (DP-161)", () => {
    expect(codes(checkPublication({ ...base, listing: null }))).toEqual(["listing_missing"]);
    expect(
      codes(checkPublication({ ...base, listing: { visibility: "HIDDEN", text: null } })),
    ).toEqual(["listing_hidden"]);
    expect(
      codes(checkPublication({ ...base, images: [{ ...base.images[0]!, isCover: false }] })),
    ).toEqual(["cover_missing"]);
    expect(codes(checkPublication({ ...base, images: [] }))).toEqual(["cover_missing"]);
    const noSummary = checkPublication({ ...base, product: { ...base.product, summary: null } });
    expect(codes(noSummary)).toEqual([]);
    expect(noSummary.ok).toBe(true);
    expect(noSummary.warnings.map((i) => [i.severity, i.code])).toContainEqual([
      "WARNING",
      "summary_missing",
    ]);
  });

  it("accepts the listing's own summary and description instead of the master's", () => {
    const r = checkPublication({
      ...base,
      product: { status: "APPROVED", summary: null, description: null },
      listing: {
        visibility: "VISIBLE",
        text: { title: null, summary: "BV text", description: "D" },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("carries the validation engine's BLOCKING issues and WARNINGS (one engine, PM-2)", () => {
    const validation = validateProductData({
      definitions: [
        {
          id: "d1",
          key: "kv100",
          name: "KV100",
          dataType: "NUMBER",
          units: ["mm²/s"],
          testMethods: ["ASTM D445"],
          required: true,
          minValue: null,
          maxValue: null,
          decimals: null,
          maxLength: null,
          archived: false,
        },
        {
          id: "d2",
          key: "flash",
          name: "Flash point",
          dataType: "NUMBER",
          units: ["°C"],
          testMethods: ["ASTM D92"],
          required: false,
          minValue: null,
          maxValue: null,
          decimals: null,
          maxLength: null,
          archived: false,
        },
      ],
      values: [
        {
          definitionId: "d2",
          value: { type: "NUMBER", number: 230 },
          unit: "°C",
          testMethod: null,
        },
      ],
      images: [{ id: "i1", altText: null }],
    });
    const r = checkPublication({ ...base, validation });
    expect(r.ok).toBe(false);
    expect(r.blocking.map((i) => [i.code, i.target])).toEqual([["required_missing", "spec:kv100"]]);
    expect(r.warnings.map((i) => i.code).sort()).toEqual([
      "alt_text_missing",
      "test_method_missing",
    ]);
  });

  it("DP-161: a product without any technical data is published with a warning", () => {
    const none = validateProductData({ definitions: [], values: [], images: [] });
    const r = checkPublication({ ...base, validation: none });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((i) => i.code)).toEqual(["specs_missing"]);
  });

  it("warns, but does not block, when there is no description", () => {
    const r = checkPublication({ ...base, product: { ...base.product, description: null } });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((i) => i.code)).toEqual(["description_missing"]);
  });
});

describe("review requests", () => {
  it("needs a reason to request changes, trims comments and turns blanks into null", () => {
    expect(RequestChangesRequestSchema.safeParse({ version: 3 }).success).toBe(false);
    expect(RequestChangesRequestSchema.safeParse({ version: 3, comment: "  " }).success).toBe(
      false,
    );
    expect(RequestChangesRequestSchema.parse({ version: 3, comment: " Fix KV100 " }).comment).toBe(
      "Fix KV100",
    );
    expect(SubmitReviewRequestSchema.parse({ version: 1, comment: "   " }).comment).toBeNull();
    expect(SubmitReviewRequestSchema.safeParse({ version: 1, extra: true }).success).toBe(false);
    expect(SubmitReviewRequestSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe("public view of a snapshot", () => {
  const snapshot = PublishedSnapshotSchema.parse({
    schemaVersion: 1,
    slug: "iccsyn-6",
    code: "ICC-SYN-6",
    name: "ICCSYN 6",
    summary: "Synthetic base oil",
    description: null,
    category: { slug: "base-oils", name: "Base oils" },
    sortOrder: 0,
    specs: [
      {
        key: "kv100",
        name: "KV100",
        value: { type: "NUMBER", number: 6.1 },
        unit: "mm²/s",
        testMethod: "ASTM D445",
      },
    ],
    images: [
      {
        id: "0190a8c4-7c1e-7000-8000-000000000002",
        altText: "Side",
        isCover: false,
        width: 1600,
        height: 1200,
      },
      {
        id: "0190a8c4-7c1e-7000-8000-000000000001",
        altText: "Drum",
        isCover: true,
        width: 1600,
        height: 1200,
      },
    ],
  });

  it("puts the cover first and exposes only public fields", () => {
    const p = PublicProductSchema.parse(toPublicProduct(snapshot, "2026-11-11T10:00:00.000Z"));
    expect(p.cover?.id).toBe("0190a8c4-7c1e-7000-8000-000000000001");
    expect(p.images.map((i) => i.altText)).toEqual(["Drum", "Side"]);
    expect(Object.keys(p.images[0]!).sort()).toEqual(["altText", "height", "id", "width"]);
    const summary = toPublicSummary(snapshot, "2026-11-11T10:00:00.000Z");
    expect(Object.keys(summary).sort()).toEqual([
      "category",
      "code",
      "cover",
      "name",
      "publishedAt",
      "slug",
      "summary",
    ]);
  });

  it("DP-161: a product without a summary is published with summary null", () => {
    const none = PublishedSnapshotSchema.parse({ ...snapshot, summary: null });
    expect(toPublicSummary(none, "2026-11-11T10:00:00.000Z").summary).toBeNull();
  });

  it("refuses snapshots with unexpected fields (strict)", () => {
    expect(
      PublishedSnapshotSchema.safeParse({ ...snapshot, storageKey: "products/x/original" }).success,
    ).toBe(false);
  });
});
