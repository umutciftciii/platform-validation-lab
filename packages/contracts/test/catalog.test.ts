// PM-1: catalogue contracts — normalisation, strictness and limits.
import { describe, expect, it } from "vitest";
import {
  CategoryCreateRequestSchema,
  ListingUpsertRequestSchema,
  ProductCreateRequestSchema,
  ProductListQuerySchema,
  ProductUpdateRequestSchema,
} from "../src/index.js";

const UUID = "0190f2a1-0000-7000-8000-000000000000";

describe("catalogue contracts", () => {
  it("normalises product codes, slugs and optional texts", () => {
    expect(
      ProductCreateRequestSchema.parse({
        code: " icc-6 ",
        slug: " ICC-6 ",
        name: " ICC 6 ",
        summary: "   ",
      }),
    ).toEqual({ code: "ICC-6", slug: "icc-6", name: "ICC 6", summary: null, description: null });
  });

  it("refuses unknown keys, bad formats and oversize text", () => {
    expect(
      ProductCreateRequestSchema.safeParse({ code: "A", slug: "a", name: "a", x: 1 }).success,
    ).toBe(false);
    expect(
      ProductCreateRequestSchema.safeParse({ code: "A B", slug: "a", name: "a" }).success,
    ).toBe(false);
    expect(
      ProductCreateRequestSchema.safeParse({ code: "A", slug: "a--b", name: "a" }).success,
    ).toBe(false);
    expect(
      ProductCreateRequestSchema.safeParse({
        code: "A",
        slug: "a",
        name: "a",
        description: "x".repeat(8001),
      }).success,
    ).toBe(false);
    expect(ProductUpdateRequestSchema.safeParse({ code: "A", slug: "a", name: "a" }).success).toBe(
      false,
    );
  });

  it("listing upserts need a visibility and a nullable version", () => {
    expect(ListingUpsertRequestSchema.parse({ version: null, visibility: "HIDDEN" })).toMatchObject(
      {
        version: null,
        sortOrder: 0,
        title: null,
      },
    );
    expect(ListingUpsertRequestSchema.safeParse({ visibility: "HIDDEN" }).success).toBe(false);
    expect(ListingUpsertRequestSchema.safeParse({ version: 0, visibility: "HIDDEN" }).success).toBe(
      false,
    );
  });

  it("categories need a parent (or null) and a slug", () => {
    expect(
      CategoryCreateRequestSchema.parse({ name: "A", slug: "a", parentId: null }),
    ).toMatchObject({
      sortOrder: 0,
      description: null,
    });
    expect(CategoryCreateRequestSchema.safeParse({ name: "A", slug: "a" }).success).toBe(false);
  });

  it("coerces list queries and applies defaults and limits", () => {
    expect(ProductListQuerySchema.parse({ siteId: UUID, page: "2", pageSize: "10" })).toEqual({
      siteId: UUID,
      listing: "all",
      sort: "name",
      order: "asc",
      page: 2,
      pageSize: 10,
    });
    expect(ProductListQuerySchema.safeParse({ siteId: UUID, pageSize: "101" }).success).toBe(false);
    expect(ProductListQuerySchema.safeParse({ siteId: UUID, sort: "secret" }).success).toBe(false);
    expect(ProductListQuerySchema.safeParse({}).success).toBe(false);
  });
});

// DP-180: the optional provenance of a listing's summary and description.
describe("listing text source (DP-180)", () => {
  const base = { version: 2, visibility: "HIDDEN" as const, summary: "S", description: "D" };
  const source = {
    proposalId: "0190a8c4-7c1e-7000-8000-000000000001",
    proposalVersion: 1,
    textSha256: "a".repeat(64),
  };
  it("is optional and, when given, strict", () => {
    expect(ListingUpsertRequestSchema.parse(base).source).toBeUndefined();
    expect(ListingUpsertRequestSchema.parse({ ...base, source: null }).source).toBeNull();
    expect(ListingUpsertRequestSchema.parse({ ...base, source }).source).toEqual(source);
    for (const bad of [
      { ...source, textSha256: "A".repeat(64) },
      { ...source, textSha256: "a".repeat(63) },
      { ...source, proposalVersion: 0 },
      { ...source, proposalId: "x" },
      { ...source, extra: true },
    ]) {
      expect(ListingUpsertRequestSchema.safeParse({ ...base, source: bad }).success).toBe(false);
    }
  });
});
