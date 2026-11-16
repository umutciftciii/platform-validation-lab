// DP-180: copying the research proposals' customer text into the listing texts — dry run by
// default, --confirm must match the APPLY count, existing other text is never overwritten, only
// summary and description change, archived/published products are skipped, a second run is
// idempotent and a change between plan and apply is STALE.
import { describe, expect, it } from "vitest";
import { AdminApiError, type AdminApi } from "../../../src/catalog/import/client.js";
import { parseApplyTextArgs } from "../../../src/catalog/proposals/cli.js";
import { runApplyText, textSha256 } from "../../../src/catalog/proposals/apply-text.js";

const SITE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const CAT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

interface L {
  id: string;
  version: number;
  visibility: "HIDDEN" | "VISIBLE";
  sortOrder: number;
  categoryId: string;
  text: { title: string | null; summary: string | null; description: string | null } | null;
}
interface P {
  code: string;
  status: "DRAFT" | "ARCHIVED";
  live: boolean;
  listing: L;
  proposal: { summary: string | null; description: string | null; version: number } | null;
}

const listing = (i: number, text: L["text"]): L => ({
  id: `l-${i}`,
  version: 3,
  visibility: "HIDDEN",
  sortOrder: 10 + i,
  categoryId: CAT,
  text,
});
const t = (summary: string | null, description: string | null) => ({
  title: "Site title",
  summary,
  description,
});

function world(): P[] {
  return [
    {
      code: "A-EMPTY",
      status: "DRAFT",
      live: false,
      listing: listing(0, t(null, null)),
      proposal: { summary: "S0.", description: "D0.", version: 1 },
    },
    {
      code: "B-NOTEXT",
      status: "DRAFT",
      live: false,
      listing: listing(1, null),
      proposal: { summary: null, description: null, version: 1 },
    },
    {
      code: "C-SAME",
      status: "DRAFT",
      live: false,
      listing: listing(2, t("S2.", "D2.")),
      proposal: { summary: "S2.", description: "D2.", version: 2 },
    },
    {
      code: "D-OTHER",
      status: "DRAFT",
      live: false,
      listing: listing(3, t("Own text.", null)),
      proposal: { summary: "S3.", description: "D3.", version: 1 },
    },
    {
      code: "E-ARCHIVED",
      status: "ARCHIVED",
      live: false,
      listing: listing(4, null),
      proposal: { summary: "S4.", description: "D4.", version: 1 },
    },
    {
      code: "F-LIVE",
      status: "DRAFT",
      live: true,
      listing: listing(5, null),
      proposal: { summary: "S5.", description: "D5.", version: 1 },
    },
    {
      code: "G-PARTIAL",
      status: "DRAFT",
      live: false,
      listing: listing(6, t("S6.", null)),
      proposal: { summary: "S6.", description: "D6.", version: 1 },
    },
    {
      code: "H-NOPROPOSAL",
      status: "DRAFT",
      live: false,
      listing: listing(7, null),
      proposal: null,
    },
  ];
}

function fakeApi(
  products: P[],
  hooks: { beforePost?: (code: string) => void; conflict?: string } = {},
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const byId = new Map(products.map((p, i) => [`p-${i}`, p]));
  const api: AdminApi = {
    get: async <T>(path: string) => {
      if (path === "/context") return { sites: [{ id: SITE, key: "BV", canEdit: true }] } as T;
      if (path.startsWith("/products?")) {
        const items = [...byId.entries()].map(([id, p]) => ({
          id,
          code: p.code,
          status: p.status,
        }));
        return { items, total: items.length, pageSize: 100, page: 1 } as T;
      }
      if (path.startsWith("/proposals?")) {
        return {
          proposals: [...byId.entries()]
            .filter(([, p]) => p.proposal)
            .map(([id]) => ({ id: `x-${id}`, productId: id, locale: "en" })),
        } as T;
      }
      const m = /^\/products\/(p-\d+)(\/workflow)?/.exec(path);
      if (m) {
        const p = byId.get(m[1]!)!;
        if (m[2]) {
          return {
            sites: [{ siteId: SITE, publication: p.live ? { status: "PUBLISHED" } : null }],
          } as T;
        }
        return {
          product: { id: m[1], status: p.status },
          listing: { ...p.listing, siteId: SITE, updatedAt: "2026-11-16T00:00:00.000Z" },
        } as T;
      }
      const x = /^\/proposals\/x-(p-\d+)$/.exec(path);
      if (x) {
        const p = byId.get(x[1]!)!;
        return {
          proposal: { id: `x-${x[1]}`, status: "REVIEW_PENDING", ...p.proposal },
        } as T;
      }
      throw new Error(`unexpected GET ${path}`);
    },
    post: async <T>(path: string, body: unknown) => {
      const id = /^\/products\/(p-\d+)\/listings\//.exec(path)![1]!;
      const p = byId.get(id)!;
      hooks.beforePost?.(p.code);
      if (hooks.conflict === p.code) throw new AdminApiError("POST", path, 409, {});
      const b = body as Record<string, unknown>;
      posts.push({ path, body: b });
      p.listing = {
        ...p.listing,
        version: p.listing.version + 1,
        text: {
          title: b["title"] as string | null,
          summary: b["summary"] as string | null,
          description: b["description"] as string | null,
        },
      };
      return { listing: { version: p.listing.version } } as T;
    },
    put: async <T>() => ({}) as T,
  };
  return { api, posts };
}

const run = (api: AdminApi, apply = false, confirm?: number) =>
  runApplyText(api, { siteKey: "BV", locale: "en", only: null, apply, confirm });

describe("DP-180 apply-text plan", () => {
  it("plans every outcome in a dry run and writes nothing", async () => {
    const { api, posts } = fakeApi(world());
    const r = await run(api);
    expect(r.mode).toBe("dry-run");
    expect(r.counts).toEqual({
      APPLY: 2,
      SAME: 1,
      KEEP_EXISTING: 1,
      NO_TEXT: 2,
      SKIP: 2,
      STALE: 0,
    });
    const by = Object.fromEntries(r.plan.map((p) => [p.code, [p.action, p.reason, p.fills]]));
    expect(by).toEqual({
      "A-EMPTY": ["APPLY", null, ["summary", "description"]],
      "B-NOTEXT": ["NO_TEXT", "proposal_without_text", []],
      "C-SAME": ["SAME", null, []],
      "D-OTHER": ["KEEP_EXISTING", "summary_differs", []],
      "E-ARCHIVED": ["SKIP", "archived", []],
      "F-LIVE": ["SKIP", "published", []],
      "G-PARTIAL": ["APPLY", null, ["description"]],
      "H-NOPROPOSAL": ["NO_TEXT", "no_proposal", []],
    });
    expect(r.plan.find((p) => p.code === "A-EMPTY")?.textSha256).toBe(textSha256("S0.", "D0."));
    expect(posts).toEqual([]);
  });

  it("refuses an apply whose --confirm does not match the APPLY count", async () => {
    const { api, posts } = fakeApi(world());
    const r = await run(api, true, 70);
    expect(r.error).toMatch(/does not match the 2 listing/);
    expect(posts).toEqual([]);
  });

  it("fills only summary and description, keeps title, category, order and visibility, names the source", async () => {
    const products = world();
    const { api, posts } = fakeApi(products);
    const r = await run(api, true, 2);
    expect(r.error).toBeNull();
    expect(r.applied.map((a) => a.code)).toEqual(["A-EMPTY", "G-PARTIAL"]);
    expect(posts[0]!.body).toEqual({
      version: 3,
      categoryId: CAT,
      visibility: "HIDDEN",
      sortOrder: 10,
      title: "Site title",
      summary: "S0.",
      description: "D0.",
      source: { proposalId: "x-p-0", proposalVersion: 1, textSha256: textSha256("S0.", "D0.") },
    });
    // The other listings were not written at all.
    expect(posts.map((p) => p.path)).toEqual([
      `/products/p-0/listings/${SITE}`,
      `/products/p-6/listings/${SITE}`,
    ]);
    expect(products[3]!.listing.text?.summary).toBe("Own text.");
  });

  it("a second dry run after the apply is idempotent: the applied ones are SAME", async () => {
    const products = world();
    const { api } = fakeApi(products);
    await run(api, true, 2);
    const again = await run(api);
    expect(again.counts).toEqual({
      APPLY: 0,
      SAME: 3,
      KEEP_EXISTING: 1,
      NO_TEXT: 2,
      SKIP: 2,
      STALE: 0,
    });
    const r = await run(api, true, 0);
    expect(r.error).toBeNull();
    expect(r.applied).toEqual([]);
  });

  it("marks a listing changed between plan and apply as STALE and leaves it alone", async () => {
    const products = world();
    const { api, posts } = fakeApi(products);
    // Someone edits A-EMPTY after the plan: its second detail read (the re-read before writing)
    // already sees a newer listing version.
    const get = api.get.bind(api);
    let reads = 0;
    api.get = async <T>(path: string) => {
      if (path.startsWith("/products/p-0?") && ++reads === 2) {
        products[0]!.listing = { ...products[0]!.listing, version: 4 };
      }
      return get<T>(path);
    };
    const r = await run(api, true, 2);
    expect(r.plan.find((p) => p.code === "A-EMPTY")).toMatchObject({ action: "STALE" });
    expect(r.counts.STALE).toBe(1);
    expect(posts.map((p) => p.path)).toEqual([`/products/p-6/listings/${SITE}`]);
  });

  it("a 409 from the API is STALE, not an error", async () => {
    const { api, posts } = fakeApi(world(), { conflict: "A-EMPTY" });
    const r = await run(api, true, 2);
    expect(r.error).toBeNull();
    expect(r.plan.find((p) => p.code === "A-EMPTY")).toMatchObject({
      action: "STALE",
      reason: "conflict_409",
    });
    expect(posts).toHaveLength(1);
  });
});

describe("DP-180 apply-text arguments", () => {
  it("defaults to a BV, English dry run", () => {
    expect(parseApplyTextArgs([])).toEqual({
      site: "BV",
      locale: "en",
      report: null,
      only: null,
      apply: false,
      confirm: undefined,
    });
  });

  it("needs --confirm with --apply and refuses --confirm alone", () => {
    expect(() => parseApplyTextArgs(["--apply"])).toThrow(/needs --confirm/);
    expect(() => parseApplyTextArgs(["--confirm", "70"])).toThrow(/only valid with --apply/);
    expect(parseApplyTextArgs(["--apply", "--confirm", "70", "--only", "A,B"])).toMatchObject({
      apply: true,
      confirm: 70,
      only: new Set(["A", "B"]),
    });
    expect(() => parseApplyTextArgs(["--confirm", "-1", "--apply"])).toThrow(/whole number/);
  });
});
