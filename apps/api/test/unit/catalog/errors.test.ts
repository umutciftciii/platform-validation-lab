// PM-1: database refusals of the catalogue become contract errors without echoing values.
import { describe, expect, it } from "vitest";
import { mapDbError } from "../../../src/catalog/errors.js";
import { ApiError } from "../../../src/iam/http/api-error.js";

const caught = (e: unknown): unknown => {
  try {
    mapDbError(e);
  } catch (x) {
    return x;
  }
  throw new Error("mapDbError returned");
};

describe("catalogue database errors", () => {
  it("maps unique indexes to the field", () => {
    const e = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: "Product_slug_key" },
    });
    const out = caught(e) as ApiError;
    expect(out).toBeInstanceOf(ApiError);
    expect(out.code).toBe("CONFLICT_STATE");
    expect(out.details).toEqual([{ path: "slug", rule: "unique" }]);
    const nested = {
      message: "x",
      cause: { message: 'violates "ProductCategory_siteId_slug_key"' },
    };
    expect((caught(Object.assign(nested, { code: "P2002" })) as ApiError).details).toEqual([
      { path: "slug", rule: "unique" },
    ]);
  });

  it("maps the tree guard and foreign keys", () => {
    const tree = (m: string) => (caught(new Error(m)) as ApiError).details;
    expect(tree("catalog: categories have at most three levels")).toEqual([
      { path: "parentId", rule: "too_deep" },
    ]);
    expect(tree("catalog: a category cannot be moved below itself")).toEqual([
      { path: "parentId", rule: "cycle" },
    ]);
    const fk = caught(
      Object.assign(new Error("Foreign key constraint violated"), { code: "P2003" }),
    );
    expect((fk as ApiError).code).toBe("CONFLICT_STATE");
  });

  it("maps the PM-3 workflow guards (separation of duties, states, publications)", () => {
    const m = (msg: string) => {
      const e = caught(new Error(msg)) as ApiError;
      return [e.code, e.details];
    };
    expect(
      m("catalog: separation of duties: the approver changed or submitted this revision"),
    ).toEqual(["FORBIDDEN", [{ path: "(root)", rule: "own_change" }]]);
    expect(m("catalog: product status cannot change from DRAFT to APPROVED")).toEqual([
      "CONFLICT_STATE",
      [{ path: "status", rule: "transition" }],
    ]);
    expect(m("catalog: only the approved version of a product can be published")).toEqual([
      "CONFLICT_STATE",
      [{ path: "status", rule: "not_approved" }],
    ]);
    expect(m("catalog: a published product cannot be archived")).toEqual([
      "CONFLICT_STATE",
      [{ path: "status", rule: "published" }],
    ]);
    expect(m("catalog: a published image cannot be deleted")).toEqual([
      "CONFLICT_STATE",
      [{ path: "(root)", rule: "image_published" }],
    ]);
  });

  it("passes ApiErrors and unknown errors through unchanged", () => {
    const api = new ApiError("NOT_FOUND");
    expect(caught(api)).toBe(api);
    const other = new TypeError("boom");
    expect(caught(other)).toBe(other);
  });
});
