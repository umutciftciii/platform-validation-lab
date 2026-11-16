// DP-187: the product page as four tabs (Content, Technical, Media & Documents, Publication).
// The page renders on the server with real response shapes; the admin API and the session are
// fixtures. Checks: every former section is still on the page, in exactly one tab; only the
// active tab is visible (the others stay mounted, hidden, so typed values survive a tab change);
// `?tab=` picks the tab; publication blockers say where they are fixed; permissions still hide
// the edit actions. Also the pure tab helpers (URL, old #section links, issue → tab).
import {
  ISSUE_CODES,
  PUBLICATION_ISSUE_CODES,
  type ProductWorkflowResponse,
} from "@dream/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixForIssue,
  parseProductTab,
  PRODUCT_TABS,
  productHref,
  SECTION_TAB,
  tabForHash,
} from "../lib/product-tabs";

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

const { default: ProductPage } = await import("../app/(console)/products/[id]/page");

const C = "/api/v1/admin/catalog";
const PRODUCT = "11111111-1111-4111-8111-111111111111";
const BV = "22222222-2222-4222-8222-222222222222";
const CORP = "33333333-3333-4333-8333-333333333333";
const CAT = "44444444-4444-4444-8444-444444444444";
const DEF = "55555555-5555-4555-8555-555555555555";
const T = "2026-11-16T10:00:00.000Z";

function fixtures(opts: { canEditMaster: boolean }) {
  reads.clear();
  reads.set(`${C}/context`, {
    sites: [
      {
        id: BV,
        key: "BV",
        name: "Dream Petroleum BV",
        canEdit: opts.canEditMaster,
        canPublish: true,
      },
      { id: CORP, key: "CORPORATE", name: "Corporate", canEdit: false, canPublish: false },
    ],
    canEditMaster: opts.canEditMaster,
    canApprove: false,
  });
  reads.set(`${C}/products/${PRODUCT}?siteId=${BV}`, {
    product: {
      id: PRODUCT,
      code: "ICC-SYN-6",
      slug: "iccsyn-6",
      name: "ICCSYN 6 Synthetic",
      summary: null,
      description: "Fully synthetic engine oil.",
      status: "DRAFT",
      version: 7,
      archivedAt: null,
      createdAt: T,
      updatedAt: T,
    },
    listing: {
      id: "66666666-6666-4666-8666-666666666666",
      siteId: BV,
      categoryId: CAT,
      visibility: "HIDDEN",
      sortOrder: 0,
      version: 2,
      text: null,
      updatedAt: T,
    },
  });
  reads.set(`${C}/sites/${BV}/categories`, {
    items: [
      {
        id: CAT,
        siteId: BV,
        parentId: null,
        name: "Engine oils",
        slug: "engine-oils",
        description: null,
        sortOrder: 0,
        isDefault: true,
        version: 1,
        listingCount: 1,
        childCount: 0,
        updatedAt: T,
      },
    ],
  });
  const required = {
    severity: "BLOCKING" as const,
    code: "required_missing" as const,
    target: "spec:viscosity",
    message: "Kinematic viscosity is required.",
  };
  reads.set(`${C}/products/${PRODUCT}/specs`, {
    productVersion: 7,
    definitions: [
      {
        id: DEF,
        key: "viscosity",
        name: "Kinematic viscosity",
        dataType: "NUMBER",
        units: ["mm²/s"],
        testMethods: ["ASTM D445"],
        required: true,
        minValue: null,
        maxValue: null,
        decimals: 2,
        maxLength: null,
        sortOrder: 0,
        archived: false,
        version: 1,
        valueCount: 0,
        updatedAt: T,
      },
    ],
    values: [],
    validation: { ok: false, blocking: [required], warnings: [] },
  });
  reads.set(`${C}/products/${PRODUCT}/images`, { items: [] });
  reads.set(`${C}/products/${PRODUCT}/documents`, { items: [], canEdit: opts.canEditMaster });
  reads.set(`${C}/products/${PRODUCT}/cross-references`, {
    items: [],
    canEdit: opts.canEditMaster,
    canApprove: false,
  });
  const workflow: ProductWorkflowResponse = {
    productId: PRODUCT,
    status: "DRAFT",
    version: 7,
    submittedAt: null,
    submittedBy: null,
    submittedVersion: null,
    approvedAt: null,
    approvedBy: null,
    approvedVersion: null,
    permissions: {
      canSubmit: opts.canEditMaster,
      canWithdraw: false,
      canReview: false,
      reviewBlockedReason: null,
    },
    validation: { ok: false, blocking: [required], warnings: [] },
    history: [],
    sites: [
      {
        siteId: BV,
        siteKey: "BV",
        siteName: "Dream Petroleum BV",
        canPublish: true,
        listing: { version: 2, visibility: "HIDDEN" },
        publication: null,
        outdated: { master: false, listing: false },
        readiness: {
          ok: false,
          blocking: [
            {
              severity: "BLOCKING",
              code: "not_approved",
              target: "product",
              message: "The product master must be approved in its current version.",
            },
            {
              severity: "BLOCKING",
              code: "listing_hidden",
              target: "listing",
              message: "The listing is hidden on this site.",
            },
            {
              severity: "BLOCKING",
              code: "cover_missing",
              target: "images",
              message: "A cover image is required.",
            },
            required,
          ],
          warnings: [],
        },
      },
      {
        siteId: CORP,
        siteKey: "CORPORATE",
        siteName: "Corporate",
        canPublish: false,
        listing: null,
        publication: null,
        outdated: { master: false, listing: false },
        readiness: {
          ok: false,
          blocking: [
            {
              severity: "BLOCKING",
              code: "listing_missing",
              target: "listing",
              message: "The site does not list this product.",
            },
          ],
          warnings: [],
        },
      },
    ],
  };
  reads.set(`${C}/products/${PRODUCT}/workflow`, workflow);
}

async function render(query: Record<string, string>): Promise<string> {
  const page = await ProductPage({
    params: Promise.resolve({ id: PRODUCT }),
    searchParams: Promise.resolve(query),
  } as never);
  return renderToStaticMarkup(page);
}

/** The HTML of one tab panel (panels are siblings, in tab order). */
function panel(html: string, tab: string): string {
  const start = html.indexOf(`id="product-tab-${tab}"`);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<div", start);
  const next = PRODUCT_TABS.map((t) => html.indexOf(`id="product-tab-${t.id}"`))
    .filter((i) => i > start)
    .sort((a, b) => a - b)[0];
  return html.slice(open, next === undefined ? undefined : html.lastIndexOf("<div", next));
}

describe("product page tabs", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  it("shows the header (name, SKU, status) and four tabs, Content active by default", async () => {
    const html = await render({ site: "bv" });
    expect(html).toContain("ICCSYN 6 Synthetic");
    expect(html).toContain("ICC-SYN-6");
    expect(html).toContain("Draft");
    expect(html).toContain("Not live");
    expect(html).toContain(">Archive<");
    const tabs = [...html.matchAll(/role="tab"[^>]*aria-selected="(true|false)"/g)];
    expect(tabs).toHaveLength(4);
    for (const t of PRODUCT_TABS) expect(html).toContain(`>${t.label.replace("&", "&amp;")}`);
    expect(panel(html, "content")).not.toMatch(/^<div[^>]*hidden/);
    for (const t of ["technical", "media", "publication"])
      expect(panel(html, t)).toMatch(/^<div[^>]*hidden=""/);
  });

  it("keeps every former section, each in exactly one tab", async () => {
    const html = await render({ site: "bv" });
    const where: Record<string, string> = {
      master: "content",
      "listing-panel": "content",
      specs: "technical",
      "cross-references": "technical",
      images: "media",
      documents: "media",
      review: "publication",
      publication: "publication",
      history: "publication",
    };
    for (const [section, tab] of Object.entries(where)) {
      expect(html.split(`id="${section}"`)).toHaveLength(2);
      expect(panel(html, tab)).toContain(`id="${section}"`);
      expect(SECTION_TAB[section]).toBe(tab);
    }
    // Content: master fields and the site's listing; Technical: the spec editor.
    const content = panel(html, "content");
    for (const f of ['id="name"', 'id="code"', 'id="slug"', 'id="summary"', 'id="description"'])
      expect(content).toContain(f);
    expect(content).toContain("Save master");
    expect(content).toContain("Save listing");
    expect(panel(html, "technical")).toContain("Kinematic viscosity");
    // The history appears once, only in Publication.
    expect(html.split("Review and publication history")).toHaveLength(2);
  });

  it("opens the tab named in ?tab= and falls back to Content for anything else", async () => {
    const html = await render({ site: "bv", tab: "publication" });
    expect(panel(html, "publication")).not.toMatch(/^<div[^>]*hidden/);
    expect(panel(html, "content")).toMatch(/^<div[^>]*hidden=""/);
    const bad = await render({ site: "bv", tab: "nope" });
    expect(panel(bad, "content")).not.toMatch(/^<div[^>]*hidden/);
  });

  it("explains each publication blocker and links to the tab that fixes it", async () => {
    const html = await render({ site: "bv", tab: "publication" });
    const pub = panel(html, "publication");
    expect(pub).toContain("Publishing is blocked:");
    expect(pub).toContain("Upload an image and make it the cover.");
    expect(pub).toContain(`href="/products/${PRODUCT}?site=bv&amp;tab=media"`);
    expect(pub).toContain("Set the site listing to Visible and save it.");
    expect(pub).toContain(`href="/products/${PRODUCT}?site=bv"`);
    expect(pub).toContain("Fill in this required specification and save.");
    expect(pub).toContain(`href="/products/${PRODUCT}?site=bv&amp;tab=technical"`);
    // A listing fix on another site opens that site's Content tab.
    expect(pub).toContain(`href="/products/${PRODUCT}?site=corporate#listing"`);
    // The tab bar flags the blocked publication.
    expect(html).toContain("publishing blocked on 2 sites");
  });

  it("keeps the permission limits: no archive, read-only master without product_master:edit", async () => {
    fixtures({ canEditMaster: false });
    const html = await render({ site: "bv" });
    expect(html).not.toContain(">Archive<");
    expect(html).not.toContain("Save master");
    expect(html).toContain("Product masters are edited by the platform product team");
    expect(panel(html, "publication")).not.toContain("Submit for review");
  });
});

describe("product tab helpers", () => {
  it("parses ?tab= and builds URLs without the default tab", () => {
    expect(parseProductTab("media")).toBe("media");
    expect(parseProductTab(["technical", "media"])).toBe("technical");
    expect(parseProductTab(undefined)).toBe("content");
    expect(parseProductTab("../x")).toBe("content");
    expect(productHref(PRODUCT, "bv", "content")).toBe(`/products/${PRODUCT}?site=bv`);
    expect(productHref(PRODUCT, "corporate", "publication")).toBe(
      `/products/${PRODUCT}?site=corporate&tab=publication`,
    );
  });

  it("maps old #section links to their tab", () => {
    expect(tabForHash("#review")).toBe("publication");
    expect(tabForHash("#documents")).toBe("media");
    expect(tabForHash("#specs")).toBe("technical");
    expect(tabForHash("#master")).toBe("content");
    expect(tabForHash("")).toBeNull();
    expect(tabForHash("#elsewhere")).toBeNull();
  });

  it("knows where every publication and validation issue is fixed", () => {
    for (const code of [...PUBLICATION_ISSUE_CODES, ...ISSUE_CODES]) {
      const fix = fixForIssue(code);
      expect(fix, code).not.toBeNull();
      expect(SECTION_TAB[fix!.section], code).toBe(fix!.tab);
    }
    expect(fixForIssue("something_new")).toBeNull();
  });
});
