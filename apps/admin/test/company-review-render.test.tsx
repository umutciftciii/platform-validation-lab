// DP-172 (ADR-022): the company review renders on the server with real response shapes. The
// admin API and the session are fixtures. Checks: current site data, research proposal and review
// items are separate, labelled sections; DP-002 held values never appear in the product's
// specification table; a placeholder shows no proposed text; the decision form needs a reason to
// request changes; a review-only user is limited to the company review.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeRequestProblem } from "../components/catalog/proposal-decision";
import { reviewOnlyAllows } from "../lib/proposals-view";

const reads = new Map<string, unknown>();

vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    return { ok: true, data: schema.parse(reads.get(path)) };
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

const C = "/api/v1/admin/catalog";
const BV = "0190f2a1-0000-7000-8000-0000000000b1";
const P1 = "0190f2a1-0000-7000-8000-000000000301"; // proposal with text and held values
const P2 = "0190f2a1-0000-7000-8000-000000000302"; // placeholder without text
const PR1 = "0190f2a1-0000-7000-8000-000000000401";
const PR2 = "0190f2a1-0000-7000-8000-000000000402";
const CAT = "0190f2a1-0000-7000-8000-000000000501";
const DEF = "0190f2a1-0000-7000-8000-000000000601";
const USER = { id: "0190f2a1-0000-7000-8000-000000000201", name: "Research editor (fixture)" };
const AT = "2026-11-15T12:00:00.000Z";
const SHA = "a".repeat(64);

const counts = (over: Record<string, number> = {}) => ({
  CONFIRM: 0,
  INCONSISTENCY: 0,
  DP002_HELD: 0,
  SITE_VALUE_WITHHELD: 0,
  CLASS_CONFLICT: 0,
  CLAIM_RISK: 0,
  MISSING_DOCUMENT: 0,
  PLACEHOLDER: 0,
  ...over,
});

const reviewData = {
  schemaVersion: 1,
  language: "en",
  family: "Group II base oil",
  items: [
    {
      kind: "CLASS_CONFLICT",
      field: "category",
      text: "The measured VI 124 falls in the Group III range under API; inconsistent with the 'Group II' label.",
      sourceIds: ["A-S01"],
      heldValue: null,
      originRef: "0123456789abcdef",
    },
    {
      kind: "CONFIRM",
      field: "content",
      text: "packaging",
      sourceIds: [],
      heldValue: null,
      originRef: "0123456789abcde0",
    },
    {
      kind: "DP002_HELD",
      field: "spec:pour_point",
      text: "DP-002: held value.",
      sourceIds: [],
      heldValue: {
        definition: "pour_point",
        basis: "SPECIFICATION",
        raw: "Pour Point, max: Minus 15 °C [GOST 20287]",
        conflict: true,
        finding: "Two rows in one document; the GOST 20287 method letter is not stated.",
      },
      originRef: "0123456789abcde1",
    },
    {
      kind: "MISSING_DOCUMENT",
      field: "documents",
      text: "SDS (REACH/CLP)",
      sourceIds: [],
      heldValue: null,
      originRef: "0123456789abcde2",
    },
  ],
  sources: [
    {
      id: "A-S01",
      title: "API 1509 Annex E — Base Oil Interchangeability Guidelines",
      url: "https://example.test/api-1509.pdf",
      level: "B",
      documentDate: "March 2015 Version",
    },
  ],
};

const proposal = (id: string, productId: string, over: Record<string, unknown> = {}) => ({
  proposal: {
    id,
    siteId: BV,
    productId,
    productCode: "G2-HVI-6",
    productName: "Group II Base Oil HVI 6",
    locale: "en",
    summary: "Group II base oil in the HVI 6 grade, for lubricant blending.",
    description: "Group II Base Oil HVI 6 is a base oil offered as a blending component.",
    reviewData,
    sourceRef: "docs/catalog/proposals/bv-content-proposals.json",
    sourceSha256: SHA,
    status: "REVIEW_PENDING",
    version: 1,
    authors: [USER],
    decidedAt: null,
    decidedBy: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  },
  events: [
    {
      id: "0190f2a1-0000-7000-8000-000000000701",
      action: "CREATED",
      proposalVersion: 1,
      actor: USER,
      comment: null,
      contentSha256: SHA,
      createdAt: AT,
    },
  ],
  canRevise: false,
  canDecide: true,
  decisionBlocked: null,
});

const product = (id: string, code: string) => ({
  product: {
    id,
    code,
    slug: code.toLowerCase(),
    name: `Product ${code}`,
    summary: null,
    description: null,
    status: "DRAFT",
    version: 3,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
  },
  listing: {
    id: "0190f2a1-0000-7000-8000-000000000801",
    siteId: BV,
    categoryId: CAT,
    visibility: "HIDDEN",
    sortOrder: 10,
    version: 1,
    text: { title: `Product ${code}`, summary: null, description: null },
    updatedAt: AT,
  },
});

beforeEach(() => {
  reads.clear();
  reads.set(`${C}/proposals/context`, {
    sites: [
      {
        id: BV,
        key: "BV",
        name: "Dream Petroleum BV",
        canRead: true,
        canReview: true,
        canRevise: false,
      },
    ],
    reviewOnly: true,
  });
  reads.set(`${C}/proposals?siteId=${BV}`, {
    proposals: [
      {
        id: P1,
        siteId: BV,
        productId: PR1,
        productCode: "G2-HVI-6",
        productName: "Group II Base Oil HVI 6",
        locale: "en",
        status: "REVIEW_PENDING",
        version: 1,
        hasText: true,
        itemCounts: counts({ CLASS_CONFLICT: 1, DP002_HELD: 15 }),
        updatedAt: AT,
      },
      {
        id: P2,
        siteId: BV,
        productId: PR2,
        productCode: "SAF",
        productName: "Sustainable Aviation Fuel (SAF)",
        locale: "en",
        status: "APPROVED",
        version: 2,
        hasText: false,
        itemCounts: counts({ PLACEHOLDER: 1 }),
        updatedAt: AT,
      },
    ],
    counts: { REVIEW_PENDING: 1, CHANGES_REQUESTED: 0, APPROVED: 1 },
  });
  reads.set(`${C}/proposals/${P1}`, proposal(P1, PR1));
  reads.set(
    `${C}/proposals/${P2}`,
    proposal(P2, PR2, { productCode: "SAF", summary: null, description: null }),
  );
  for (const [id, code] of [
    [PR1, "G2-HVI-6"],
    [PR2, "SAF"],
  ] as const) {
    reads.set(`${C}/products/${id}?siteId=${BV}`, product(id, code));
    reads.set(`${C}/products/${id}/images`, { items: [] });
    reads.set(`${C}/products/${id}/documents`, { items: [], canEdit: false });
    reads.set(`${C}/products/${id}/specs`, {
      productVersion: 3,
      definitions: [
        {
          id: DEF,
          key: "kv100",
          name: "Kinematic viscosity at 100 °C",
          dataType: "RANGE",
          units: ["mm²/s"],
          testMethods: [],
          required: false,
          minValue: null,
          maxValue: null,
          decimals: null,
          maxLength: null,
          sortOrder: 10,
          archived: false,
          version: 1,
          valueCount: 1,
          updatedAt: AT,
        },
      ],
      values:
        code === "SAF"
          ? []
          : [
              {
                definitionId: DEF,
                basis: "SPECIFICATION",
                value: {
                  type: "RANGE",
                  min: 5.5,
                  max: 7,
                  minExclusive: false,
                  maxExclusive: false,
                },
                unit: "mm²/s",
                testMethod: "GOST 33",
                updatedAt: AT,
              },
            ],
      validation: { ok: true, blocking: [], warnings: [] },
    });
  }
  reads.set(`${C}/sites/${BV}/categories`, {
    items: [
      {
        id: CAT,
        siteId: BV,
        parentId: null,
        name: "Base Oil",
        slug: "base-oil",
        description: null,
        sortOrder: 0,
        isDefault: false,
        version: 1,
        listingCount: 2,
        childCount: 0,
        updatedAt: AT,
      },
    ],
  });
});

const render = async (node: Promise<React.ReactNode>) => renderToStaticMarkup(await node);
const TURKISH = /[çğıöşÇĞİÖŞ]/;

describe("company review list", () => {
  it("lists the proposals with their status, conflicts and held values", async () => {
    const html = await render(ListPage({ searchParams: Promise.resolve({}) } as never));
    expect(html).toContain("Company review");
    expect(html).toContain("G2-HVI-6");
    expect(html).toContain("Review pending");
    expect(html).toContain("Approved");
    expect(html).toContain("1 conflict");
    expect(html).toContain("15 held values");
    expect(html).toContain("No text proposed");
    expect(html).toContain("neither publishes the product nor approves its technical");
    expect(TURKISH.test(html)).toBe(false);
  });
});

describe("company review product page", () => {
  it("keeps current site data, the proposal and review items in separate labelled sections", async () => {
    const html = await render(
      DetailPage({
        params: Promise.resolve({ id: P1 }),
        searchParams: Promise.resolve({}),
      } as never),
    );
    const order = [
      "Current site data",
      "Research proposal",
      "Review items",
      "Held for verification",
    ];
    const at = order.map((t) => html.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('data-provenance="site"');
    expect(html).toContain('data-provenance="proposal"');
    expect(html).toContain('data-provenance="review"');
    expect(html).toContain("From current site");
    expect(html).toContain("Research proposal — not published");
    expect(html).toContain("Base Oil");
    expect(html).toContain("5.5 to 7 mm²/s");
    expect(html).toContain("Classification conflict");
    expect(TURKISH.test(html)).toBe(false);
  });

  it("never shows a DP-002 held value in the product's specification table", async () => {
    const html = await render(
      DetailPage({
        params: Promise.resolve({ id: P1 }),
        searchParams: Promise.resolve({}),
      } as never),
    );
    const current = html.slice(
      html.indexOf("Current site data"),
      html.indexOf("Research proposal"),
    );
    expect(current).not.toContain("Minus 15");
    const held = html.slice(html.indexOf("data-held-values"));
    expect(held).toContain("Pour Point, max: Minus 15 °C [GOST 20287]");
    expect(held).toContain("Unverified (DP-002)");
    expect(html).toContain("They are not verified specifications and are not part of the product.");
  });

  it("shows the decision form with Approve and Request changes", async () => {
    const html = await render(
      DetailPage({
        params: Promise.resolve({ id: P1 }),
        searchParams: Promise.resolve({}),
      } as never),
    );
    expect(html).toContain(">Approve<");
    expect(html).toContain("Request changes");
    expect(html).toContain("required to request changes");
  });

  it("shows no proposed text for a placeholder and explains why", async () => {
    const html = await render(
      DetailPage({
        params: Promise.resolve({ id: P2 }),
        searchParams: Promise.resolve({}),
      } as never),
    );
    expect(html).toContain("No text is proposed for this product");
    expect(html).toContain("The current site shows no technical data for this product.");
  });

  it("explains why a user cannot decide", async () => {
    reads.set(`${C}/proposals/${P1}`, {
      ...proposal(P1, PR1),
      canDecide: false,
      decisionBlocked: "own_change",
    });
    const html = await render(
      DetailPage({
        params: Promise.resolve({ id: P1 }),
        searchParams: Promise.resolve({}),
      } as never),
    );
    expect(html).not.toContain(">Approve<");
    expect(html).toContain("separation of duties");
  });
});

describe("decision rules and review-only paths", () => {
  it("requires an explanation to request changes", () => {
    expect(changeRequestProblem("")).toMatch(/Explain what has to change/);
    expect(changeRequestProblem("  ok ")).toMatch(/Explain/);
    expect(changeRequestProblem("Please shorten the text.")).toBeNull();
  });

  it.each(["/company-review", "/company-review/abc"])("lets a review-only user open %s", (p) => {
    expect(reviewOnlyAllows(p)).toBe(true);
  });

  it.each([
    "/",
    "/products",
    "/products/123",
    "/leads",
    "/staff",
    "/content",
    "/owner",
    "/company-reviews",
  ])("sends a review-only user away from %s", (p) => {
    expect(reviewOnlyAllows(p)).toBe(false);
  });
});
