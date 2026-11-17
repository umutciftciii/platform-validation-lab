// PM-3: review/publication contracts — request schemas, the publication readiness check that the
// API enforces and the console shows, and the public view of a snapshot (no private fields).
import { describe, expect, it } from "vitest";
import {
  checkPublication,
  findSensitiveClaims,
  PublishRequestSchema,
  PublicProductSchema,
  PublicProductSummarySchema,
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
      "hasDocuments",
      "hasTechnicalData",
      "name",
      "publishedAt",
      "slug",
      "summary",
    ]);
    // the product page carries no list flags
    expect(Object.keys(p)).not.toContain("hasDocuments");
  });

  it("DP-163: flags technical data from the snapshot and documents from the caller", () => {
    const at = "2026-11-11T10:00:00.000Z";
    const withSpecs = toPublicSummary(snapshot, at, { hasDocuments: true });
    expect(PublicProductSummarySchema.parse(withSpecs)).toMatchObject({
      hasTechnicalData: true,
      hasDocuments: true,
    });
    const bare = toPublicSummary(PublishedSnapshotSchema.parse({ ...snapshot, specs: [] }), at);
    expect(bare).toMatchObject({ hasTechnicalData: false, hasDocuments: false });
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

// DP-193 (ADR-023): direct publication and the new warnings.
describe("DP-193 publish request", () => {
  it("defaults to APPROVED without makeVisible, so older clients keep their behaviour", () => {
    expect(PublishRequestSchema.parse({ version: 3, listingVersion: 2 })).toEqual({
      version: 3,
      listingVersion: 2,
      approvalMode: "APPROVED",
      makeVisible: false,
    });
  });

  it("DP-198: accepts makeVisible in the APPROVED mode too", () => {
    expect(
      PublishRequestSchema.parse({ version: 3, listingVersion: 2, makeVisible: true }),
    ).toEqual({ version: 3, listingVersion: 2, approvalMode: "APPROVED", makeVisible: true });
  });

  it("accepts DIRECT with makeVisible and refuses unknown modes and fields", () => {
    expect(
      PublishRequestSchema.parse({
        version: 3,
        listingVersion: 2,
        approvalMode: "DIRECT",
        makeVisible: true,
      }),
    ).toMatchObject({ approvalMode: "DIRECT", makeVisible: true });
    expect(
      PublishRequestSchema.safeParse({ version: 3, listingVersion: 2, approvalMode: "SELF" })
        .success,
    ).toBe(false);
    expect(
      PublishRequestSchema.safeParse({ version: 3, listingVersion: 2, approvedBy: "x" }).success,
    ).toBe(false);
  });
});

describe("DP-193 checkPublication in DIRECT mode", () => {
  const draft: ReadinessInput = { ...base, product: { ...base.product, status: "DRAFT" } };
  const warn = (r: ReturnType<typeof checkPublication>) => r.warnings.map((i) => i.code);

  it("turns a missing technical review into a warning, for DRAFT and IN_REVIEW", () => {
    for (const status of ["DRAFT", "IN_REVIEW"] as const) {
      const r = checkPublication({
        ...base,
        product: { ...base.product, status },
        mode: "DIRECT",
      });
      expect(r.ok).toBe(true);
      expect(codes(r)).toEqual([]);
      expect(warn(r)).toEqual(["not_reviewed"]);
    }
  });

  it("an APPROVED master has nothing to warn about in either mode", () => {
    expect(checkPublication({ ...base, mode: "DIRECT" })).toEqual({
      ok: true,
      blocking: [],
      warnings: [],
    });
  });

  it("the APPROVED mode still blocks a draft (unchanged PM-3 rule)", () => {
    expect(codes(checkPublication(draft))).toEqual(["not_approved"]);
    expect(codes(checkPublication({ ...draft, mode: "APPROVED" }))).toEqual(["not_approved"]);
  });

  it("shows a hidden listing only when the publisher may; otherwise it still blocks", () => {
    const hidden = { ...draft, listing: { visibility: "HIDDEN" as const, text: null } };
    const may = checkPublication({ ...hidden, mode: "DIRECT", canShowListing: true });
    expect(may.ok).toBe(true);
    expect(warn(may)).toEqual(["not_reviewed", "listing_shown_on_publish"]);
    expect(codes(checkPublication({ ...hidden, mode: "DIRECT", canShowListing: false }))).toEqual([
      "listing_hidden",
    ]);
    // DP-198: the APPROVED mode may show it too; without the right it still blocks.
    const approved = checkPublication({
      ...hidden,
      product: { ...base.product },
      mode: "APPROVED",
      canShowListing: true,
    });
    expect(approved.ok).toBe(true);
    expect(warn(approved)).toEqual(["listing_shown_on_publish"]);
    expect(
      codes(checkPublication({ ...hidden, product: { ...base.product }, mode: "APPROVED" })),
    ).toEqual(["listing_hidden"]);
    // A draft stays blocked in the APPROVED mode, shown listing or not.
    expect(codes(checkPublication({ ...hidden, mode: "APPROVED", canShowListing: true }))).toEqual([
      "not_approved",
    ]);
  });

  it("keeps archived, missing listing, missing cover and invalid data blocking", () => {
    const d = { mode: "DIRECT" as const, canShowListing: true };
    expect(
      codes(checkPublication({ ...base, ...d, product: { ...base.product, status: "ARCHIVED" } })),
    ).toEqual(["archived"]);
    expect(codes(checkPublication({ ...draft, ...d, listing: null }))).toEqual(["listing_missing"]);
    expect(codes(checkPublication({ ...draft, ...d, images: [] }))).toEqual(["cover_missing"]);
    const invalid = {
      ok: false,
      blocking: [
        {
          severity: "BLOCKING" as const,
          code: "invalid_unit" as const,
          target: "spec:kv100",
          message: "KV100: unit",
        },
      ],
      warnings: [],
    };
    expect(codes(checkPublication({ ...draft, ...d, validation: invalid }))).toEqual([
      "invalid_unit",
    ]);
  });

  it("no technical data and no documents only warn", () => {
    const validation = validateProductData({ definitions: [], values: [], images: [] });
    const r = checkPublication({ ...draft, mode: "DIRECT", validation });
    expect(r.ok).toBe(true);
    expect(warn(r)).toContain("specs_missing");
  });
});

describe("DP-193 company review and sensitive claims (warnings only)", () => {
  it("warns while the site's proposal is not company-approved; never blocks", () => {
    for (const status of ["REVIEW_PENDING", "CHANGES_REQUESTED"] as const) {
      const r = checkPublication({ ...base, proposal: { status } });
      expect(r.ok).toBe(true);
      expect(r.warnings.map((i) => i.code)).toEqual(["company_review_pending"]);
    }
    expect(checkPublication({ ...base, proposal: { status: "APPROVED" } }).warnings).toEqual([]);
    expect(checkPublication({ ...base, proposal: null }).warnings).toEqual([]);
  });

  it("finds sensitive wording in the public title, summary or description", () => {
    const r = checkPublication({
      ...base,
      listing: {
        visibility: "VISIBLE",
        text: {
          title: "Base oil for SAF blending",
          summary: "Offered under the pharmaceutical grade designation.",
          description: "Suitable for incidental food contact (NSF H1).",
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((i) => [i.code, i.target])).toEqual([
      ["sensitive_claim", "text:saf"],
      ["sensitive_claim", "text:pharmaceutical"],
      ["sensitive_claim", "text:food"],
    ]);
  });

  it("matches acronyms only in capitals as whole words", () => {
    expect(findSensitiveClaims("A safe, useful product for ctl lines and safety.")).toEqual([]);
    expect(findSensitiveClaims("CTL base oil").map((c) => c.key)).toEqual(["ctl_gtl"]);
    expect(findSensitiveClaims("Cosmetic Grade Petroleum Jelly").map((c) => c.key)).toEqual([
      "cosmetic",
    ]);
    expect(findSensitiveClaims(null, undefined, "")).toEqual([]);
  });

  it("reads the master text when the listing has none", () => {
    const r = checkPublication({
      ...base,
      product: { ...base.product, description: "A biodegradable fluid." },
    });
    expect(r.warnings.map((i) => i.target)).toEqual(["text:environmental"]);
  });
});
