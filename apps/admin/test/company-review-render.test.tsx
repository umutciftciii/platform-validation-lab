// DP-172 (ADR-022), DP-189: the company review renders on the server with real response shapes.
// The admin API and the session are fixtures. Checks: the list searches by name/SKU and filters by
// category and status; the product page has four tabs, each piece of data in exactly one of them;
// current site data, research proposal and review items keep their provenance tags; DP-002 held
// values never appear in the product's specification table; a placeholder shows no proposed text;
// the decision form needs a reason to request changes, and a user who cannot decide is told why;
// a review-only user is limited to the company review.
import { renderToStaticMarkup } from "./support/en-baseline-render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeRequestProblem } from "../components/catalog/proposal-decision";
import { reviewOnlyAllows } from "../lib/proposals-view";

const reads = new Map<string, unknown>();

// ML-12a: the pages read the console language from the cookie (none here: English).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
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
const CAT2 = "0190f2a1-0000-7000-8000-000000000502";
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
      kind: "SITE_VALUE_WITHHELD",
      field: "spec:flash_point",
      text: "Not imported: no test method.",
      sourceIds: [],
      heldValue: {
        definition: "flash_point",
        basis: "TYPICAL",
        raw: "Flash point: 220 °C",
        conflict: false,
        finding: null,
      },
      originRef: "0123456789abcde3",
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
      kind: "CLAIM_RISK",
      field: "description",
      text: "'Pharmaceutical grade' needs a certificate.",
      sourceIds: ["A-S01"],
      heldValue: null,
      originRef: "0123456789abcde4",
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
      // Written before DP-191 and not verifiable: its text is unknown.
      textRecorded: false,
      summary: null,
      description: null,
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
  const productsPage = (ids: readonly (readonly [string, string, string])[]) => ({
    items: ids.map(([id, code, cat]) => ({
      id,
      code,
      slug: code.toLowerCase(),
      name: `Product ${code}`,
      status: "DRAFT",
      version: 3,
      updatedAt: AT,
      listing: {
        id: "0190f2a1-0000-7000-8000-000000000801",
        visibility: "HIDDEN",
        categoryId: cat,
        categoryName: cat === CAT ? "Base Oil" : "Fuels",
        updatedAt: AT,
      },
      publication: null,
    })),
    page: 1,
    pageSize: 100,
    total: ids.length,
  });
  const productQuery = (category?: string) =>
    `${C}/products?siteId=${BV}&sort=name&order=asc&page=1&pageSize=100${category ? `&categoryId=${category}` : ""}`;
  reads.set(
    productQuery(),
    productsPage([
      [PR1, "G2-HVI-6", CAT],
      [PR2, "SAF", CAT2],
    ]),
  );
  reads.set(productQuery(CAT), productsPage([[PR1, "G2-HVI-6", CAT]]));
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
        listingCount: 1,
        childCount: 0,
        updatedAt: AT,
      },
      {
        id: CAT2,
        siteId: BV,
        parentId: null,
        name: "Fuels",
        slug: "fuels",
        description: null,
        sortOrder: 1,
        isDefault: false,
        version: 1,
        listingCount: 1,
        childCount: 0,
        updatedAt: AT,
      },
    ],
  });
});

const render = async (node: Promise<React.ReactNode>) => renderToStaticMarkup(await node);
const TURKISH = /[çğıöşÇĞİÖŞ]/;

const listPage = (query: Record<string, string> = {}) =>
  render(ListPage({ searchParams: Promise.resolve(query) } as never));
const detailPage = (id: string, query: Record<string, string> = {}) =>
  render(
    DetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) } as never),
  );

/** The markup of one tab panel of the product page. */
function tabPanel(html: string, tab: string): string {
  const start = html.indexOf(`id="review-tab-${tab}"`);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<div", start);
  const next = html.indexOf('role="tabpanel"', html.indexOf(">", start));
  return html.slice(open, next === -1 ? undefined : html.lastIndexOf("<div", next));
}

const TABS = ["content", "verification", "sources", "history"] as const;
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("company review list", () => {
  it("lists the proposals with their status, category, conflicts and held values", async () => {
    const html = await listPage();
    expect(html).toContain("Company review");
    expect(html).toContain("G2-HVI-6");
    expect(html).toContain("Review pending");
    expect(html).toContain("Approved");
    expect(html).toContain("1 conflict");
    expect(html).toContain("15 held values");
    expect(html).toContain("No text proposed");
    expect(html).toContain("Base Oil");
    expect(html).toContain("Fuels");
    expect(html).toContain("neither publishes the product nor approves its technical");
    expect(html).toContain(`href="/company-review/${P1}?site=bv"`);
    expect(html).toContain('role="search"');
    expect(html).toContain("All categories");
    expect(TURKISH.test(html)).toBe(false);
  });

  it.each([
    ["saf", "SAF"],
    ["hvi 6", "G2-HVI-6"],
    ["g2-hvi", "G2-HVI-6"],
    ["sustainable aviation", "SAF"],
  ])("searches by product name or SKU (%s)", async (q, code) => {
    const html = await listPage({ q });
    const list = html.slice(html.indexOf("data-proposal-list"));
    expect(list).toContain(code);
    expect(list.match(/<li>/g)?.length).toBe(1);
    expect(html).toContain("Showing 1 product of 2");
  });

  it("filters by category, including the products listed under it", async () => {
    const html = await listPage({ category: CAT });
    const list = html.slice(html.indexOf("data-proposal-list"));
    expect(list).toContain("G2-HVI-6");
    expect(list).not.toContain("Sustainable Aviation Fuel");
  });

  it("keeps search and category in the status filter links", async () => {
    const html = await listPage({ q: "base", category: CAT });
    expect(html).toContain(
      `href="/company-review?site=bv&amp;q=base&amp;category=${CAT}&amp;status=APPROVED"`,
    );
  });

  it("says so when nothing matches, and still renders when products cannot be read", async () => {
    reads.delete(`${C}/products?siteId=${BV}&sort=name&order=asc&page=1&pageSize=100`);
    const html = await listPage({ q: "nothing-like-this" });
    expect(html).toContain("No product matches this search.");
    expect(html).toContain("the category filter may be");
  });
});

describe("company review product page", () => {
  it("shows name, SKU and status at the top and four tabs", async () => {
    const html = await detailPage(P1);
    expect(html).toContain("Group II Base Oil HVI 6");
    expect(html).toMatch(/data-sku=""[^>]*>G2-HVI-6</);
    expect(html.indexOf("Review pending")).toBeLessThan(html.indexOf('role="tablist"'));
    for (const label of ["Content review", "Missing &amp; verification", "Sources", "History"]) {
      expect(html).toContain(`>${label}`);
    }
    expect(count(html, 'role="tab"')).toBe(4);
    expect(count(html, 'role="tabpanel"')).toBe(4);
    expect(TURKISH.test(html)).toBe(false);
  });

  it("opens the tab named in the URL and hides the others", async () => {
    for (const tab of TABS) {
      const html = await detailPage(P1, { tab });
      for (const other of TABS) {
        const p = tabPanel(html, other);
        expect(p.slice(0, p.indexOf(">")).includes("hidden")).toBe(other !== tab);
      }
    }
    const fallback = await detailPage(P1, { tab: "nonsense" });
    expect(tabPanel(fallback, "content").slice(0, 200)).not.toContain("hidden");
  });

  it("Content Review compares the current text with the proposal and holds the decision", async () => {
    const content = tabPanel(await detailPage(P1), "content");
    expect(content).toContain("Current site data");
    expect(content).toContain('data-provenance="site"');
    expect(content).toContain('data-provenance="proposal"');
    expect(content).toContain("From current site");
    expect(content).toContain("Research proposal — not published");
    expect(content).toContain("Base Oil");
    expect(content).toContain('data-compare="site"');
    expect(content).toContain("Group II base oil in the HVI 6 grade, for lubricant blending.");
    expect(content).toContain("Claim risks");
    expect(content).toContain(">Approve<");
    expect(content).toContain("Request changes");
    expect(content).toContain("required to request changes");
    expect(content).toContain("Open catalogue preview");
    // Open points are counts that link to the verification tab, not the items themselves.
    expect(content).toContain("Open points in the research");
    expect(content).toContain("/company-review/" + P1 + "?tab=verification#held");
    expect(content).not.toContain("Pour Point, max");
  });

  it("Missing & Verification holds conflicts, questions, held values and documents", async () => {
    const v = tabPanel(await detailPage(P1), "verification");
    expect(v).toContain("Conflicts and placeholders");
    expect(v).toContain("Classification conflict");
    expect(v).toContain("Questions to confirm");
    expect(v).toContain("Held for verification — not product data");
    expect(v).toContain("They are not verified specifications and are not part of the product.");
    expect(v).toContain("Unverified (DP-002)");
    expect(v).toContain("SDS (REACH/CLP)");
    expect(v).toContain("No original TDS, SDS or COA is on file.");
    expect(v).toContain("Technical data on the current site");
    expect(v).toContain("5.5 to 7 mm²/s");
    expect(v).toContain('aria-label="Verification groups"');
    // Long lists are collapsible groups, open by default.
    expect(count(v, "<details")).toBe(5);
    expect(count(v, "<details")).toBe(count(v, ' open=""'));
    // Conflicting held values come first.
    expect(v.indexOf("Pour Point, max: Minus 15")).toBeLessThan(v.indexOf("Flash point: 220"));
  });

  it("never shows a DP-002 held value in the product's specification table", async () => {
    const html = await detailPage(P1);
    const specs = html.slice(html.indexOf("data-current-specs"));
    expect(specs.slice(0, specs.indexOf("</table>"))).not.toContain("Minus 15");
    const held = html.slice(html.indexOf("data-held-values"));
    expect(held).toContain("Pour Point, max: Minus 15 °C [GOST 20287]");
  });

  it("shows each piece of data in one tab only", async () => {
    const html = await detailPage(P1);
    const panels = Object.fromEntries(TABS.map((t) => [t, tabPanel(html, t)]));
    const only = (needle: string, tab: (typeof TABS)[number]) => {
      for (const t of TABS)
        expect(panels[t]!.includes(needle), `${needle} in ${t}`).toBe(t === tab);
    };
    only("Group II base oil in the HVI 6 grade", "content");
    only("Pour Point, max: Minus 15", "verification");
    only("5.5 to 7 mm²/s", "verification");
    only("API 1509 Annex E", "sources");
    only("Proposal created", "history");
    only(">Approve<", "content");
  });

  it("Sources lists the research sources with their level and citations", async () => {
    const s = tabPanel(await detailPage(P1), "sources");
    expect(s).toContain("Research sources");
    expect(s).toContain('id="source-A-S01"');
    expect(s).toContain("B · standard or regulation");
    expect(s).toContain("cited by 2 review items");
    expect(s).toContain("Research family");
    expect(s).toContain('rel="noopener noreferrer nofollow"');
  });

  it("History shows authors, decisions, comments and status changes", async () => {
    reads.set(`${C}/proposals/${P1}`, {
      ...proposal(P1, PR1, {
        status: "CHANGES_REQUESTED",
        version: 2,
        decidedAt: AT,
        decidedBy: { id: "0190f2a1-0000-7000-8000-000000000202", name: "Company reviewer" },
      }),
      events: [
        ...proposal(P1, PR1).events,
        {
          id: "0190f2a1-0000-7000-8000-000000000702",
          action: "CHANGES_REQUESTED",
          proposalVersion: 1,
          actor: { id: "0190f2a1-0000-7000-8000-000000000202", name: "Company reviewer" },
          comment: "Please drop the blending claim.",
          contentSha256: SHA,
          textRecorded: false,
          summary: null,
          description: null,
          createdAt: AT,
        },
      ],
    });
    const h = tabPanel(await detailPage(P1), "history");
    expect(h).toContain("Research editor (fixture)");
    expect(h).toContain("Company reviewer");
    expect(h).toContain("Please drop the blending claim.");
    expect(h.indexOf("Changes requested")).toBeLessThan(h.indexOf("Proposal created"));
  });

  it("shows no proposed text for a placeholder and explains why", async () => {
    const html = await detailPage(P2);
    expect(html).toContain("No text is proposed for this product");
    expect(html).toContain("The current site shows no technical data for this product.");
  });

  it.each([
    ["own_change", "separation of duties"],
    ["no_permission", "cannot decide on it"],
    ["not_in_review", "not waiting for review"],
  ])("explains why a user cannot decide (%s)", async (reason, text) => {
    reads.set(`${C}/proposals/${P1}`, {
      ...proposal(P1, PR1),
      canDecide: false,
      decisionBlocked: reason,
    });
    const html = await detailPage(P1);
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain(">Request changes<");
    expect(html).toContain(`data-decision-blocked="${reason}"`);
    expect(html).toContain("data-decision-notice");
    expect(html).toContain(text);
  });
});

describe("DP-191: editing the proposed text", () => {
  const editable = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    ...proposal(P1, PR1, over),
    canRevise: true,
    canDecide: false,
    decisionBlocked: "own_change",
    ...extra,
  });

  it("an editor gets the text fields next to the current site text, with Save and Cancel", async () => {
    reads.set(`${C}/proposals/${P1}`, editable());
    reads.set(`${C}/products/${PR1}?siteId=${BV}`, {
      ...product(PR1, "G2-HVI-6"),
      listing: {
        ...product(PR1, "G2-HVI-6").listing,
        text: { title: "HVI 6", summary: "Current site summary.", description: null },
      },
    });
    const c = tabPanel(await detailPage(P1), "content");
    expect(c).toContain("data-proposal-editor");
    expect(count(c, "<textarea")).toBe(2);
    expect(c).toContain('name="summary"');
    expect(c).toContain('name="description"');
    expect(c).toContain("Group II base oil in the HVI 6 grade, for lubricant blending.</textarea>");
    // The current site text is the reference, read-only and tagged as such.
    expect(c).toContain("Current site summary.");
    expect(c).toContain('data-provenance="site"');
    expect(c).toContain('data-provenance="proposal"');
    expect(c).toMatch(/>Cancel<\/button>/);
    expect(c).toContain("Save");
    expect(c).toContain('data-editor-state="saved"');
    expect(c).toContain("Version 1 saved. Every version is kept in History.");
    // No second, read-only comparison and no new warning or approval step.
    expect(c).not.toContain("Research proposal against the current text");
    // The author still cannot decide: the decision panel says why.
    expect(c).toContain('data-decision-blocked="own_change"');
    expect(c).not.toContain(">Approve<");
  });

  it("a company reviewer still sees the read-only comparison, never a text field", async () => {
    const c = tabPanel(await detailPage(P1), "content");
    expect(c).not.toContain("<textarea name=");
    expect(c).not.toContain("data-proposal-editor");
    expect(c).toContain("Research proposal against the current text");
  });

  it("a placeholder gets empty fields and a note, never a generated text", async () => {
    reads.set(
      `${C}/proposals/${P2}`,
      editable(
        {
          productCode: "SAF",
          summary: null,
          description: null,
          reviewData: {
            ...reviewData,
            items: [
              {
                kind: "PLACEHOLDER",
                field: "name",
                text: "The product is not defined well enough to describe.",
                sourceIds: [],
                heldValue: null,
              },
            ],
          },
        },
        {},
      ),
    );
    const c = tabPanel(await detailPage(P2), "content");
    expect(c).toContain("data-placeholder-note");
    expect(c).toContain("Write a text only from information the company has confirmed");
    expect(c).toMatch(/<textarea[^>]*name="summary"[^>]*><\/textarea>/);
    expect(c).toMatch(/<textarea[^>]*name="description"[^>]*><\/textarea>/);
  });

  it("the technical data stays apart: held values only in Missing & Verification", async () => {
    reads.set(`${C}/proposals/${P1}`, editable());
    const html = await detailPage(P1);
    const c = tabPanel(html, "content");
    expect(c).not.toContain("Minus 15");
    // Missing documents are named in Content Review and listed in Missing & Verification.
    expect(c).toContain("1 missing document");
    const v = tabPanel(html, "verification");
    expect(v).toContain("Held for verification");
    expect(v).toContain("Minus 15");
    expect(v).toContain("SDS (REACH/CLP)");
  });

  it("History shows the text of every version, unchanged texts once, and unknown texts as such", async () => {
    const SHA2 = "b".repeat(64);
    const editor = { id: "0190f2a1-0000-7000-8000-000000000203", name: "Owner (fixture)" };
    reads.set(`${C}/proposals/${P1}`, {
      ...editable({ version: 3 }),
      events: [
        ...proposal(P1, PR1).events,
        {
          id: "0190f2a1-0000-7000-8000-000000000703",
          action: "REVISED",
          proposalVersion: 2,
          actor: editor,
          comment: null,
          contentSha256: SHA2,
          textRecorded: true,
          summary: "Edited summary of version two.",
          description: null,
          createdAt: AT,
        },
        {
          id: "0190f2a1-0000-7000-8000-000000000704",
          action: "CHANGES_REQUESTED",
          proposalVersion: 3,
          actor: { id: "0190f2a1-0000-7000-8000-000000000202", name: "Company reviewer" },
          comment: "Add the packaging.",
          contentSha256: SHA2,
          textRecorded: true,
          summary: "Edited summary of version two.",
          description: null,
          createdAt: AT,
        },
      ],
    });
    const h = tabPanel(await detailPage(P1), "history");
    expect(count(h, 'data-event-text="recorded"')).toBe(1);
    expect(h).toContain("Text of version 2");
    expect(h).toContain("Edited summary of version two.");
    expect(count(h, 'data-event-text="unchanged"')).toBe(1);
    expect(count(h, 'data-event-text="unrecorded"')).toBe(1);
    expect(h).toContain("Text of this version not recorded");
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
