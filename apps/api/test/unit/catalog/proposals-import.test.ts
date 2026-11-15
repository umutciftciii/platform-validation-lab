// DP-171: the content proposal import — dry run by default, --confirm must match the CREATE
// count, existing proposals are never overwritten and unknown codes are only reported.
import type { ProposalDataset } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import type { AdminApi } from "../../../src/catalog/import/client.js";
import { parseArgs } from "../../../src/catalog/proposals/cli.js";
import { canonical, runProposals } from "../../../src/catalog/proposals/import.js";

const SITE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const reviewData = { schemaVersion: 1 as const, family: null, items: [], sources: [] };
const dataset: ProposalDataset = {
  schemaVersion: 1,
  dp: "DP-171",
  site: "BV",
  locale: "en",
  sourceRef: "docs/catalog/proposals/test.json",
  generatedAt: "2026-11-15T12:00:00.000Z",
  proposals: [
    { code: "NEW-1", summary: "New one.", description: "Text.", reviewData },
    { code: "SAME-1", summary: "Same.", description: "Text.", reviewData },
    { code: "DIFF-1", summary: "Changed.", description: "Text.", reviewData },
    { code: "GONE-1", summary: "Gone.", description: null, reviewData },
    { code: "PLACE-1", summary: null, description: null, reviewData },
  ],
};

function fakeApi() {
  const posts: { path: string; body: unknown }[] = [];
  const products = ["NEW-1", "SAME-1", "DIFF-1", "PLACE-1"].map((code, i) => ({
    id: `p-${i}`,
    code,
    listing: {},
  }));
  const existing = [
    { id: "x-same", productId: "p-1", locale: "en" },
    { id: "x-diff", productId: "p-2", locale: "en" },
  ];
  const details: Record<string, unknown> = {
    "x-same": { proposal: { summary: "Same.", description: "Text.", reviewData } },
    "x-diff": { proposal: { summary: "Old.", description: "Text.", reviewData } },
  };
  const api: AdminApi = {
    get: async <T>(path: string) => {
      if (path === "/context") return { sites: [{ id: SITE, key: "BV" }] } as T;
      if (path.startsWith("/products?")) return { items: products, total: 4, pageSize: 100 } as T;
      if (path.startsWith("/proposals?")) return { proposals: existing } as T;
      const id = path.split("/").pop()!;
      return details[id] as T;
    },
    post: async <T>(path: string, body: unknown) => {
      posts.push({ path, body });
      return { proposal: { id: `new-${posts.length}` } } as T;
    },
    put: async <T>() => ({}) as T,
  };
  return { api, posts };
}

describe("proposal import", () => {
  it("plans without writing in a dry run", async () => {
    const { api, posts } = fakeApi();
    const r = await runProposals(api, dataset, "f".repeat(64), {
      only: null,
      apply: false,
      confirm: undefined,
    });
    expect(r.counts).toEqual({ CREATE: 2, SAME: 1, EXISTS_DIFFERENT: 1, MISSING_PRODUCT: 1 });
    expect(r.plan.find((p) => p.code === "PLACE-1")?.hasText).toBe(false);
    expect(posts).toEqual([]);
  });

  it("refuses an apply whose --confirm does not match", async () => {
    const { api, posts } = fakeApi();
    const r = await runProposals(api, dataset, "f".repeat(64), {
      only: null,
      apply: true,
      confirm: 3,
    });
    expect(r.error).toMatch(/does not match/);
    expect(posts).toEqual([]);
  });

  it("creates only the CREATE rows, never touching existing proposals", async () => {
    const { api, posts } = fakeApi();
    const r = await runProposals(api, dataset, "f".repeat(64), {
      only: null,
      apply: true,
      confirm: 2,
    });
    expect(r.error).toBeNull();
    expect(posts.map((p) => p.path)).toEqual([
      `/sites/${SITE}/proposals`,
      `/sites/${SITE}/proposals`,
    ]);
    expect(posts.map((p) => (p.body as { productId: string }).productId)).toEqual(["p-0", "p-3"]);
    expect((posts[0]?.body as { sourceSha256: string }).sourceSha256).toBe("f".repeat(64));
  });

  it("limits the plan with --only", async () => {
    const { api } = fakeApi();
    const r = await runProposals(api, dataset, "f".repeat(64), {
      only: new Set(["NEW-1"]),
      apply: false,
      confirm: undefined,
    });
    expect(r.plan.map((p) => p.code)).toEqual(["NEW-1"]);
  });

  it("compares review data independent of key order", () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it("parses the command line", () => {
    expect(parseArgs(["--dataset", "d.json"]).apply).toBe(false);
    expect(parseArgs(["--dataset", "d.json", "--apply", "--confirm", "5"]).confirm).toBe(5);
    expect(() => parseArgs(["--dataset", "d.json", "--confirm", "5"])).toThrow(
      /only valid with --apply/,
    );
    expect(() => parseArgs([])).toThrow(/required/);
    expect(parseArgs(["--dataset", "d.json", "--only", "A, B"]).only).toEqual(new Set(["A", "B"]));
  });
});
