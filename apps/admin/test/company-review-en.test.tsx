// ML-12b (DP-243) EN regression of the Company Review area. Every render below goes through
// support/en-baseline-render: it is compared with the HTML recorded on private main 7b543f6 (before
// ML-12b) in fixtures/catalog-en/company-review-en.json.gz (record with ML12B_RECORD_EN=1).
// Covered beyond company-review-render.test.tsx (recorded on 88251eb): no access, load errors,
// every decision-block reason, the text editor in every state, a full history, empty tabs, the
// research notes of the product page and the texts the screens only show after an action
// (validation, save errors, labels) as returned by the view-model functions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "./support/en-baseline-render";
import {
  BV,
  C,
  CAT,
  context,
  documents,
  FAIL,
  fullReviewData,
  P1,
  P2,
  P3,
  PR1,
  PR2,
  productQuery,
  proposal,
  seedReviewReads,
  specs,
} from "./support/review-fixtures";
import { reviewEnTexts, renderResearchNotes } from "./support/review-en-texts";

const reads = new Map<string, unknown>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(path);
    if (v === FAIL) return { ok: false, status: 500, code: "INTERNAL_ERROR" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const { default: ListPage } = await import("../app/(console)/company-review/page");
const { default: DetailPage } = await import("../app/(console)/company-review/[id]/page");

beforeEach(() => seedReviewReads(reads));

const render = async (node: Promise<React.ReactNode>) => renderToStaticMarkup(await node);
const listPage = (query: Record<string, string> = {}) =>
  render(ListPage({ searchParams: Promise.resolve(query) } as never));
const detailPage = (id: string, query: Record<string, string> = {}) =>
  render(
    DetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) } as never),
  );

describe("company review list (EN)", () => {
  it("lists every status, badges and filters", async () => {
    const html = await listPage();
    expect(html).toContain("Company review");
    expect(html).toContain("No text proposed");
  });

  it("narrows by status, search and category", async () => {
    await listPage({ status: "APPROVED" });
    await listPage({ q: "zzz-none" });
    await listPage({ q: "hvi", category: CAT });
  });

  it("says when products cannot be read, the list fails or there is no access", async () => {
    reads.delete(productQuery());
    await listPage();
    reads.set(`${C}/proposals?siteId=${BV}`, FAIL);
    await listPage();
    reads.set(`${C}/proposals/context`, context({ canRead: false }));
    const html = await listPage();
    expect(html).toContain("No access to the company review");
  });

  it("offers a site switch with two sites", async () => {
    const CORP = "0190f2a1-0000-7000-8000-0000000000c1";
    reads.set(
      `${C}/proposals/context`,
      context({}, [
        {
          id: BV,
          key: "BV",
          name: "Dream Petroleum BV",
          canRead: true,
          canReview: true,
          canRevise: true,
        },
        {
          id: CORP,
          key: "CORPORATE",
          name: "Dream Petroleum",
          canRead: true,
          canReview: false,
          canRevise: false,
        },
      ]),
    );
    reads.set(`${C}/proposals?siteId=${CORP}`, {
      proposals: [],
      counts: { REVIEW_PENDING: 0, CHANGES_REQUESTED: 0, APPROVED: 0 },
    });
    reads.set(`${C}/sites/${CORP}/categories`, { items: [] });
    reads.set(productQuery().replace(BV, CORP), { items: [], page: 1, pageSize: 100, total: 0 });
    await listPage({ site: "corporate" });
  });
});

describe("company review product page (EN)", () => {
  it("renders every tab of a pending proposal a reviewer can decide", async () => {
    await detailPage(P1);
    await detailPage(P1, { tab: "verification", site: "bv" });
  });

  it.each(["no_permission", "not_in_review", "own_change", null] as const)(
    "explains a blocked decision (%s)",
    async (reason) => {
      reads.set(
        `${C}/proposals/${P1}`,
        proposal(P1, PR1, {}, { canDecide: false, decisionBlocked: reason }),
      );
      const html = await detailPage(P1);
      expect(html).toContain("data-decision-blocked");
    },
  );

  it("gives an editor the text editor (pending, approved, placeholder)", async () => {
    reads.set(`${C}/proposals/${P1}`, proposal(P1, PR1, {}, { canRevise: true }));
    await detailPage(P1);
    reads.set(
      `${C}/proposals/${P1}`,
      proposal(
        P1,
        PR1,
        { status: "APPROVED" },
        { canRevise: true, canDecide: false, decisionBlocked: "not_in_review" },
      ),
    );
    await detailPage(P1);
    reads.set(
      `${C}/proposals/${P2}`,
      proposal(
        P2,
        PR2,
        {
          summary: null,
          description: null,
          reviewData: { ...fullReviewData, items: [fullReviewData.items[0]] },
        },
        { canRevise: true },
      ),
    );
    await detailPage(P2);
  });

  it("shows a placeholder, an approval and an empty history", async () => {
    await detailPage(P2);
  });

  it("shows a full history with comments, texts and decisions", async () => {
    await detailPage(P3, { tab: "history" });
  });

  it("says so when the research is empty and the product cannot be read", async () => {
    reads.set(
      `${C}/proposals/${P1}`,
      proposal(
        P1,
        PR1,
        { reviewData: { schemaVersion: 1, family: null, items: [], sources: [] } },
        {},
        [],
      ),
    );
    reads.delete(`${C}/products/${PR1}?siteId=${BV}`);
    reads.set(`${C}/products/${PR1}/specs`, specs(true));
    reads.set(`${C}/products/${PR1}/documents`, documents(false));
    await detailPage(P1);
  });

  it("says so when the proposal cannot be loaded", async () => {
    reads.set(`${C}/proposals/${P1}`, FAIL);
    await detailPage(P1, { site: "bv" });
  });
});

describe("research notes on the product page (EN)", () => {
  it("lists every group, held values and sources", () => {
    renderToStaticMarkup(renderResearchNotes(proposal(P1, PR1).proposal as never));
    renderToStaticMarkup(
      renderResearchNotes(
        proposal(P1, PR1, {
          reviewData: { ...fullReviewData, items: fullReviewData.items.slice(4, 5) },
        }).proposal as never,
      ),
    );
  });
});

describe("texts shown after an action (EN)", () => {
  it("keeps every view-model text", () => {
    const texts = reviewEnTexts();
    expect(texts.length).toBeGreaterThan(60);
    renderToStaticMarkup(
      <ul>
        {texts.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>,
    );
  });
});
