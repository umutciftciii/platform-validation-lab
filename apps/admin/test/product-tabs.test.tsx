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
const PROPOSAL = "0190a8c4-7c1e-7000-8000-0000000000f1";

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
        publishMode: "APPROVED",
        canShowListing: false,
        canPreview: false,
        proposal: {
          id: "0190a8c4-7c1e-7000-8000-0000000000f1",
          status: "REVIEW_PENDING",
          version: 3,
          summary: "Research summary for BV.",
          description: "Research description for BV.",
          claimRisks: ["Food/cosmetic suitability should not be written."],
        },
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
        publishMode: "APPROVED",
        canShowListing: false,
        canPreview: false,
        proposal: null,
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
  // DP-180: the BV proposal's review items and sources (research notes on the Technical tab).
  reads.set(`${C}/proposals/${PROPOSAL}`, {
    proposal: {
      id: PROPOSAL,
      siteId: BV,
      productId: PRODUCT,
      productCode: "ICC-SYN-6",
      productName: "ICCSYN 6 Synthetic",
      locale: "en",
      summary: "Research summary for BV.",
      description: "Research description for BV.",
      reviewData: {
        schemaVersion: 1,
        language: "en",
        family: "Group III base oil",
        items: [
          {
            kind: "CONFIRM",
            field: "packaging",
            text: "Which pack sizes are offered?",
            sourceIds: [],
            heldValue: null,
          },
          {
            kind: "CONFIRM",
            field: "name",
            text: "Is the grade name final?",
            sourceIds: ["S1"],
            heldValue: null,
          },
          {
            kind: "MISSING_DOCUMENT",
            field: "documents",
            text: "No original TDS.",
            sourceIds: [],
            heldValue: null,
          },
          {
            kind: "CLASS_CONFLICT",
            field: "category",
            text: "VI below the class label.",
            sourceIds: ["S1"],
            heldValue: null,
          },
          {
            kind: "CLAIM_RISK",
            field: "summary",
            text: "CTL origin needs a certificate.",
            sourceIds: [],
            heldValue: null,
          },
          {
            kind: "DP002_HELD",
            field: "spec:viscosity_index",
            text: "Two VI values on one page.",
            sourceIds: ["S1"],
            heldValue: {
              definition: "viscosity_index",
              basis: "TYPICAL",
              raw: "Viscosity index: 118 [ASTM D2270]",
              conflict: true,
              finding: "The TR page says 122.",
            },
          },
          {
            kind: "SITE_VALUE_WITHHELD",
            field: "spec:appearance",
            text: "No test method on the site.",
            sourceIds: [],
            heldValue: {
              definition: "appearance",
              basis: "SPECIFICATION",
              raw: "Appearance: clear",
              conflict: false,
              finding: null,
            },
          },
        ],
        sources: [
          {
            id: "S1",
            title: "Producer TDS",
            url: "https://example.com/tds.pdf",
            level: "C",
            documentDate: "2024",
          },
        ],
      },
      sourceRef: "docs/catalog/proposals/bv-content-proposals.json",
      sourceSha256: "a".repeat(64),
      status: "REVIEW_PENDING",
      version: 3,
      authors: [],
      decidedAt: null,
      decidedBy: null,
      createdAt: T,
      updatedAt: T,
    },
    events: [],
    canRevise: true,
    canDecide: false,
    decisionBlocked: "no_permission",
  });
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
      research: "technical",
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
    // DP-197: a listing that is not shown yet is no Content-tab fix any more: Publish shows it
    // (here: approved path, product:edit on BV, so the console switches it on first).
    expect(pub).not.toContain("Set the site listing to Visible");
    expect(pub).toContain("Not shown on this site yet: publishing shows it.");
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

// DP-193 (ADR-023): Preview / Publish / Unpublish, direct publication and the proposal copy.
describe("DP-193 direct publication and the research proposal", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  function direct() {
    const wf = reads.get(`${C}/products/${PRODUCT}/workflow`) as ProductWorkflowResponse;
    const bv = wf.sites[0]!;
    reads.set(`${C}/products/${PRODUCT}/workflow`, {
      ...wf,
      sites: [
        {
          ...bv,
          publishMode: "DIRECT",
          canShowListing: true,
          canPreview: true,
          readiness: {
            ok: true,
            blocking: [],
            warnings: [
              {
                severity: "WARNING",
                code: "not_reviewed",
                target: "product",
                message: "Published directly: no second person reviewed this version (optional).",
              },
              {
                severity: "WARNING",
                code: "listing_shown_on_publish",
                target: "listing",
                message: "The listing is hidden; publishing makes it visible on this site.",
              },
              {
                severity: "WARNING",
                code: "sensitive_claim",
                target: "text:pharmaceutical",
                message:
                  "The public text mentions pharmaceutical or pharmacopoeia grade: publish it only with a certificate or source document.",
              },
              {
                severity: "WARNING",
                code: "alt_text_missing",
                target: "image:x",
                message: "An image has no alt text.",
              },
            ],
          },
        },
        wf.sites[1]!,
      ],
    });
  }

  it("publishes directly with one button, shows warnings openly and needs no dialog", async () => {
    direct();
    const pub = panel(await render({ site: "bv", tab: "publication" }), "publication");
    // DP-197: one Publish button; the hidden listing is a plain note, never a technical term.
    expect(pub).not.toContain("Show and publish");
    expect(pub).toContain(">Publish<");
    expect(pub).toContain("Not shown on this site yet: publishing shows it.");
    expect(pub).not.toMatch(/\b(HIDDEN|VISIBLE)\b/);
    expect(pub).toContain(">Preview<");
    expect(pub).toContain("Check before publishing:");
    expect(pub).toContain("pharmaceutical or pharmacopoeia grade");
    expect(pub).toContain("1 more note (not blocking)");
    expect(pub).toContain("You publish this version directly");
    expect(pub).toContain("Second-person review");
    expect(pub).not.toContain("Unpublish…");
    // Publication comes before the optional review.
    expect(pub.indexOf('id="publication"')).toBeLessThan(pub.indexOf('id="review"'));
  });

  it("keeps the approved path for a publisher without approval rights", async () => {
    const pub = panel(await render({ site: "bv", tab: "publication" }), "publication");
    expect(pub).toContain("Publishing needs an approved master (second-person review).");
    expect(pub).not.toContain("Show and publish");
    expect(pub).not.toContain(">Preview<");
  });

  it("offers to copy the research proposal into the listing and says when the texts differ", async () => {
    const content = panel(await render({ site: "bv" }), "content");
    expect(content).toContain("Research proposal for Dream Petroleum BV");
    expect(content).toContain("not reviewed by the company (optional)");
    expect(content).toContain("Copy into summary and description");
    expect(content).toContain(
      "The saved Dream Petroleum BV text differs from the research proposal.",
    );
    expect(content).toContain("1 claim note: wording that needs a certificate");
    expect(content).toContain("Technical values held for verification stay in");
    // The listing fields stay empty until the user copies and saves.
    expect(content).not.toContain('value="Research summary for BV."');
  });

  it("offers no copy without product:edit on the site", async () => {
    fixtures({ canEditMaster: false });
    const content = panel(await render({ site: "bv" }), "content");
    expect(content).toContain("Research proposal for Dream Petroleum BV");
    expect(content).not.toContain("Copy into summary and description");
  });
});

// DP-180: the research notes (review items and sources) on the Technical tab, read only.
describe("DP-180 research notes", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  it("shows every review item of the site's proposal in its group, with the sources", async () => {
    const tech = panel(await render({ site: "bv", tab: "technical" }), "technical");
    expect(tech).toContain('id="research"');
    expect(tech).toContain(`data-review-total="7"`);
    // Each item exactly once (held values: the phone list carries the marker, the table not).
    expect(tech.match(/data-review-item=/g)).toHaveLength(7);
    for (const [group, n] of [
      ["research-questions", 2],
      ["research-documents", 1],
      ["research-attention", 1],
      ["research-claims", 1],
      ["research-held", 2],
    ] as const) {
      expect(tech).toMatch(new RegExp(`id="${group}"[\\s\\S]*?>${n}</span>`));
    }
    for (const t of [
      "Questions for the company",
      "Missing documents",
      "Technical conflicts",
      "Claim risks",
      "Held for verification — not product data",
      "Research sources",
    ])
      expect(tech).toContain(t);
    expect(tech).toContain('data-research-source="S1"');
    expect(tech).toContain(`href="/company-review/${PROPOSAL}?site=bv&amp;tab=verification"`);
  });

  it("marks held values as unverified and never shows them as specifications", async () => {
    const tech = panel(await render({ site: "bv", tab: "technical" }), "technical");
    expect(tech).toContain("data-held-warning");
    expect(tech).toContain("2 technical values held for verification: not verified");
    expect(tech).toContain("Unverified (DP-002)");
    expect(tech).toContain("Viscosity index: 118 [ASTM D2270]");
    // The specification editor above never lists them.
    const specs = tech.slice(0, tech.indexOf('id="research"'));
    expect(specs).not.toContain("Viscosity index: 118");
  });

  it("offers no edit or decision in the notes", async () => {
    const notes = panel(await render({ site: "bv", tab: "technical" }), "technical").split(
      'id="research"',
    )[1]!;
    expect(notes).not.toMatch(/<button|<textarea|<input/);
  });

  it("says when the site has no proposal", async () => {
    const wf = reads.get(`${C}/products/${PRODUCT}/workflow`) as ProductWorkflowResponse;
    reads.set(`${C}/products/${PRODUCT}/workflow`, {
      ...wf,
      sites: wf.sites.map((s) => ({ ...s, proposal: null })),
    });
    const tech = panel(await render({ site: "bv", tab: "technical" }), "technical");
    expect(tech).toContain("There is no research proposal for this product on");
    expect(tech).not.toContain("data-review-item");
  });
});

// DP-197: no HIDDEN / VISIBLE in the console; Draft / Published / Unpublished per site.
describe("DP-197 publication status without visibility terms", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  function bvSite(over: Partial<ProductWorkflowResponse["sites"][number]>) {
    const wf = reads.get(`${C}/products/${PRODUCT}/workflow`) as ProductWorkflowResponse;
    reads.set(`${C}/products/${PRODUCT}/workflow`, {
      ...wf,
      sites: [{ ...wf.sites[0]!, ...over }, wf.sites[1]!],
    });
  }
  const pubRow = (status: "PUBLISHED" | "UNPUBLISHED") => ({
    id: "0190a8c4-7c1e-7000-8000-0000000000b1",
    status,
    productVersion: 7,
    listingVersion: 2,
    publishedAt: T,
    publishedBy: { id: "0190a8c4-7c1e-7000-8000-0000000000a1", name: "Owner" },
    unpublishedAt: status === "UNPUBLISHED" ? T : null,
    unpublishedBy:
      status === "UNPUBLISHED"
        ? { id: "0190a8c4-7c1e-7000-8000-0000000000a1", name: "Owner" }
        : null,
    approvalMode: "DIRECT" as const,
    version: 2,
  });
  const ready = { ok: true, blocking: [], warnings: [] };

  it("Content has no visibility control; saving says it never publishes", async () => {
    const html = await render({ site: "bv" });
    const content = panel(html, "content");
    expect(content).not.toContain("Visibility on this site");
    expect(content).not.toContain('role="radio"');
    expect(content).not.toMatch(/>(Visible|Hidden)</);
    expect(content).not.toMatch(/\b(HIDDEN|VISIBLE)\b/);
    expect(content).toContain("Saving never publishes, unpublishes or changes the live site.");
    expect(content).toContain("Save listing");
    // The listing panel shows the site status: never published here = Draft.
    expect(content).toContain(">Draft<");
    expect(panel(html, "publication")).toContain(">Draft<");
  });

  it("Published: live, Unpublish offered, nothing to republish", async () => {
    bvSite({
      listing: { version: 2, visibility: "VISIBLE" },
      publication: pubRow("PUBLISHED"),
      readiness: ready,
    });
    const html = await render({ site: "bv", tab: "publication" });
    const pub = panel(html, "publication");
    expect(pub).toContain(">Published<");
    expect(pub).toContain(">Unpublish<");
    expect(pub).toContain(">Republish<");
    expect(pub).toContain("Live and up to date.");
    expect(html).toContain("Live on 1 of 2 sites");
  });

  it("Unpublished: off the site, Publish again, no Unpublish", async () => {
    bvSite({
      listing: { version: 2, visibility: "VISIBLE" },
      publication: pubRow("UNPUBLISHED"),
      readiness: ready,
    });
    const html = await render({ site: "bv", tab: "publication" });
    const pub = panel(html, "publication");
    expect(pub).toContain(">Unpublished<");
    expect(pub).not.toContain(">Unpublish<");
    expect(pub).toContain(">Publish<");
    expect(html).toContain("Not live");
  });

  it("a published product whose listing is switched off reads Unpublished, not Live", async () => {
    bvSite({
      listing: { version: 2, visibility: "HIDDEN" },
      publication: pubRow("PUBLISHED"),
    });
    const html = await render({ site: "bv", tab: "publication" });
    const pub = panel(html, "publication");
    expect(pub).toContain(">Unpublished<");
    expect(pub).toContain("Not shown on this site at the moment.");
    expect(pub).not.toContain(">Unpublish<");
    expect(html).toContain("Not live");
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
    // DP-197: a listing that is not shown is no Content fix: Publish shows it, or needs edit
    // rights on the site's listing (said in the issue itself).
    const NO_FIX = new Set(["listing_shown_on_publish", "listing_hidden"]);
    for (const code of [...PUBLICATION_ISSUE_CODES, ...ISSUE_CODES]) {
      if (NO_FIX.has(code)) {
        expect(fixForIssue(code), code).toBeNull();
        continue;
      }
      const fix = fixForIssue(code);
      expect(fix, code).not.toBeNull();
      expect(SECTION_TAB[fix!.section], code).toBe(fix!.tab);
    }
    expect(fixForIssue("something_new")).toBeNull();
  });
});
