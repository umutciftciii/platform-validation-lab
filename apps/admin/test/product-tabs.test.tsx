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
import { buttonStyles } from "../components/ui";

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
        // DP-198: the API lets an APPROVED publication show the listing (product:edit on BV).
        canShowListing: true,
        canPreview: false,
        proposal: {
          id: "0190a8c4-7c1e-7000-8000-0000000000f1",
          status: "REVIEW_PENDING",
          version: 3,
          summary: "Research summary for BV.",
          description: "Research description for BV.",
          claimRisks: ["Food/cosmetic suitability should not be written."],
        },
        languages: [],
        addresses: {
          live: null,
          next: "/products/fx-g1",
          keepsOldAddress: true,
          redirectsHere: [],
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
              code: "cover_missing",
              target: "images",
              message: "A cover image is required.",
            },
            required,
          ],
          warnings: [
            {
              severity: "WARNING",
              code: "listing_shown_on_publish",
              target: "listing",
              message: "The listing is hidden; publishing makes it visible on this site.",
            },
          ],
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
        languages: [],
        addresses: {
          live: null,
          next: "/products/fx-g1",
          keepsOldAddress: false,
          redirectsHere: [],
        },
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

/** DP-203: the header status line as "Label:Status" pairs (site statuses, then the master). */
function headerStatus(html: string): string[] {
  const start = html.indexOf("data-header-status");
  expect(start).toBeGreaterThan(-1);
  const line = html.slice(start, html.indexOf("Version ", start));
  const pair =
    /data-status="\w+"[^>]*><span[^>]*>([^<]*)<\/span><span[^>]*>(?:<span[^>]*><\/span>)?([^<]*)<\/span>/g;
  return [...line.matchAll(pair)].map((m) => `${m[1]}:${m[2]}`);
}

/** DP-203: one site card of the Publication panel, by the site's display name. */
function card(pub: string, name: string): string {
  const cards = pub.split("<article").slice(1);
  const found = cards.find((c) => new RegExp(`</svg>${name}</h3>`).test(c));
  expect(found, name).toBeDefined();
  return found!.split("</article>")[0]!;
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

  it("shows the header (name, SKU, status) and five tabs, Content active by default", async () => {
    const html = await render({ site: "bv" });
    expect(html).toContain("ICCSYN 6 Synthetic");
    expect(html).toContain("ICC-SYN-6");
    // DP-203: the site statuses lead the header; a Draft master that only repeats them is left out.
    expect(headerStatus(html)).toEqual(["BV:Draft", "Corporate:Not listed"]);
    expect(html).not.toContain("Not live");
    expect(html).toContain(">Archive<");
    const tabs = [...html.matchAll(/role="tab"[^>]*aria-selected="(true|false)"/g)];
    expect(tabs).toHaveLength(5);
    for (const t of PRODUCT_TABS) expect(html).toContain(`>${t.label.replace("&", "&amp;")}`);
    expect(panel(html, "content")).not.toMatch(/^<div[^>]*hidden/);
    for (const t of ["technical", "media", "seo", "publication"])
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
    expect(content).toContain("Save shared content");
    expect(content).toContain("Save Dream Petroleum BV text");
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
    // (DP-198: approved path, product:edit on BV, so the API shows it in the same request).
    expect(pub).not.toContain("Set the site listing to Visible");
    expect(pub).toContain("Not shown on this site yet: publishing shows it.");
    expect(pub).toContain("Fill in this required specification and save.");
    expect(pub).toContain(`href="/products/${PRODUCT}?site=bv&amp;tab=technical"`);
    // DP-203: the unlisted Corporate site is information, not a blocker: no red line, no Publish,
    // and no listing link for a user without edit rights there.
    expect(card(pub, "Corporate")).not.toContain("Publishing is blocked:");
    expect(card(pub, "Corporate")).toContain("Listing it here needs edit rights on this site.");
    // The tab bar flags the blocked publication — on the listed site only.
    expect(html).toContain("publishing blocked on 1 site");
  });

  it("keeps the permission limits: no archive, read-only master without product_master:edit", async () => {
    fixtures({ canEditMaster: false });
    const html = await render({ site: "bv" });
    expect(html).not.toContain(">Archive<");
    expect(html).not.toContain("Save shared content");
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
                message: "No second person has reviewed this version (optional).",
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
    slug: "fx-g1",
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
    expect(content).toContain("Save Dream Petroleum BV text");
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
    // DP-203: Draft master next to a published site — two separate, labelled facts.
    expect(headerStatus(html)).toEqual(["BV:Published", "Corporate:Not listed", "Master:Draft"]);
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
    expect(headerStatus(html)).toEqual(["BV:Unpublished", "Corporate:Not listed", "Master:Draft"]);
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
    expect(headerStatus(html)[0]).toBe("BV:Unpublished");
  });
});

// DP-203: site publication status first, master status apart; Not listed is no alarm; no
// review step for a user who publishes directly everywhere. The API decides as before.
describe("DP-203 product status, review action and Not listed", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  type Site = ProductWorkflowResponse["sites"][number];
  const wf = () => reads.get(`${C}/products/${PRODUCT}/workflow`) as ProductWorkflowResponse;
  function setWorkflow(
    over: Partial<ProductWorkflowResponse>,
    bv: Partial<Site>,
    corp: Partial<Site>,
  ) {
    const w = wf();
    reads.set(`${C}/products/${PRODUCT}/workflow`, {
      ...w,
      ...over,
      sites: [
        { ...w.sites[0]!, ...bv },
        { ...w.sites[1]!, ...corp },
      ],
    });
  }
  function corporateEditable() {
    const ctx = reads.get(`${C}/context`) as { sites: { canEdit: boolean; canPublish: boolean }[] };
    reads.set(`${C}/context`, {
      ...ctx,
      sites: [ctx.sites[0], { ...ctx.sites[1], canEdit: true, canPublish: true }],
    });
  }
  const live = {
    id: "0190a8c4-7c1e-7000-8000-0000000000b1",
    status: "PUBLISHED" as const,
    productVersion: 7,
    listingVersion: 2,
    publishedAt: T,
    publishedBy: { id: "0190a8c4-7c1e-7000-8000-0000000000a1", name: "Owner" },
    unpublishedAt: null,
    unpublishedBy: null,
    approvalMode: "DIRECT" as const,
    slug: "fx-g1",
    version: 2,
  };
  const off = {
    ...live,
    status: "UNPUBLISHED" as const,
    unpublishedAt: T,
    unpublishedBy: live.publishedBy,
  };
  const ready = { ok: true, blocking: [], warnings: [] };
  const directReady = {
    ok: true,
    blocking: [],
    warnings: [
      {
        severity: "WARNING" as const,
        code: "not_reviewed",
        target: "product",
        message: "No second person has reviewed this version (optional).",
      },
    ],
  };
  const listingMissing = {
    severity: "BLOCKING" as const,
    code: "listing_missing",
    target: "listing",
    message: "The site does not list this product.",
  };
  const coverMissing = {
    severity: "BLOCKING" as const,
    code: "cover_missing",
    target: "images",
    message: "A cover image is required.",
  };
  const notListed = (extra: (typeof coverMissing)[] = []): Partial<Site> => ({
    listing: null,
    publication: null,
    readiness: {
      ok: false,
      blocking: [listingMissing, ...extra],
      warnings: directReady.warnings,
    },
  });
  /** The Submit for review button's class, or null when it is not offered. */
  function submitButton(pub: string): string | null {
    const m = /<button[^>]*class="([^"]*)"[^>]*>(?:(?!<\/button>)[\s\S])*Submit for review/.exec(
      pub,
    );
    return m ? m[1]! : null;
  }
  const ok = (html: string) => panel(html, "publication");

  it("DIRECT on every site: no Submit for review, no review steps, publishing stays", async () => {
    corporateEditable();
    setWorkflow(
      { validation: { ok: true, blocking: [], warnings: [] } },
      { publishMode: "DIRECT", canPreview: true, readiness: directReady },
      { publishMode: "DIRECT", canPublish: true, ...notListed() },
    );
    const pub = ok(await render({ site: "bv", tab: "publication" }));
    expect(submitButton(pub)).toBeNull();
    expect(pub).not.toContain('aria-label="Review progress"');
    expect(pub).not.toContain("Note for the reviewer");
    expect(pub).toContain(
      "You publish directly on every site you can open, so no review is needed.",
    );
    expect(card(pub, "Dream Petroleum BV")).toContain(">Publish<");
    expect(card(pub, "Dream Petroleum BV")).toContain("You publish this version directly");
  });

  it("DIRECT on some sites only: Submit for review stays, as a secondary action", async () => {
    setWorkflow(
      { validation: { ok: true, blocking: [], warnings: [] } },
      { publishMode: "DIRECT", readiness: directReady },
      {},
    );
    const cls = submitButton(ok(await render({ site: "bv", tab: "publication" })));
    expect(cls).toBe(buttonStyles.secondary);
  });

  it("APPROVED path: Submit for review is the primary action, with the review steps", async () => {
    const pub = ok(await render({ site: "bv", tab: "publication" }));
    expect(submitButton(pub)).toBe(buttonStyles.primary);
    expect(pub).toContain('aria-label="Review progress"');
    expect(pub).toContain("Publishing needs an approved master (second-person review).");
    expect(pub).not.toContain("so no review is needed");
  });

  it("a reviewer keeps Approve and Request changes even when publishing directly", async () => {
    setWorkflow(
      {
        status: "IN_REVIEW",
        validation: { ok: true, blocking: [], warnings: [] },
        permissions: {
          canSubmit: false,
          canWithdraw: true,
          canReview: true,
          reviewBlockedReason: null,
        },
      },
      { publishMode: "DIRECT", readiness: directReady },
      { publishMode: "DIRECT", ...notListed() },
    );
    const pub = ok(await render({ site: "bv", tab: "publication" }));
    expect(pub).toContain(">Approve<");
    expect(pub).toContain(">Request changes<");
    expect(pub).toContain(">Withdraw from review<");
    expect(pub).toContain('aria-label="Review progress"');
  });

  it("a user without master edit rights gets no review action and no publish button", async () => {
    fixtures({ canEditMaster: false });
    setWorkflow({}, { canPublish: false, canShowListing: false }, {});
    const pub = ok(await render({ site: "bv", tab: "publication" }));
    expect(submitButton(pub)).toBeNull();
    expect(pub).not.toContain(">Publish<");
    expect(pub).toContain("Publishing on this site needs the publisher role of the site.");
    expect(card(pub, "Corporate")).toContain("Listing it here needs edit rights on this site.");
    expect(card(pub, "Corporate")).not.toContain("Go to Content");
  });

  it("Draft master + Published BV: both shown, apart; the master is labelled", async () => {
    setWorkflow(
      {},
      {
        publishMode: "DIRECT",
        listing: { version: 2, visibility: "VISIBLE" },
        publication: live,
        readiness: directReady,
      },
      {},
    );
    const html = await render({ site: "bv" });
    expect(headerStatus(html)).toEqual(["BV:Published", "Corporate:Not listed", "Master:Draft"]);
    // Never folded into one status, never the old summary.
    expect(html).not.toContain("Live on 1 of 2 sites");
    expect(html).toContain('data-status="master"');
  });

  it("BV Published + Corporate Not listed: no red marker, no red blocker, Publish only on BV", async () => {
    corporateEditable();
    setWorkflow(
      {},
      {
        publishMode: "DIRECT",
        listing: { version: 2, visibility: "VISIBLE" },
        publication: live,
        readiness: directReady,
      },
      { publishMode: "DIRECT", canPublish: true, ...notListed() },
    );
    const html = await render({ site: "bv", tab: "publication" });
    expect(html).not.toContain("publishing blocked on");
    const corp = card(ok(html), "Corporate");
    expect(corp).toContain('data-site-status="not-listed"');
    expect(corp).toContain(">Not listed<");
    expect(corp).not.toContain(">Draft<");
    expect(corp).not.toContain("text-danger");
    expect(corp).not.toContain("Publishing is blocked");
    expect(corp).not.toContain(">Publish<");
    // The wrong "Published directly" note of the readiness check is not shown for it.
    expect(corp).not.toContain("Published directly");
    // The listing flow stays: the card sends the editor to Corporate's Content tab.
    expect(corp).toContain("To publish it here, list it on Corporate first.");
    expect(corp).toContain(`href="/products/${PRODUCT}?site=corporate#listing"`);
    expect(card(ok(html), "Dream Petroleum BV")).toContain(">Unpublish<");
  });

  it("BV Unpublished + Corporate Draft: Draft stays Draft when the site lists the product", async () => {
    corporateEditable();
    setWorkflow(
      {},
      { listing: { version: 2, visibility: "VISIBLE" }, publication: off, readiness: ready },
      {
        canPublish: true,
        listing: { version: 1, visibility: "HIDDEN" },
        publication: null,
        readiness: { ok: true, blocking: [], warnings: [] },
      },
    );
    const html = await render({ site: "bv", tab: "publication" });
    expect(headerStatus(html)).toEqual(["BV:Unpublished", "Corporate:Draft", "Master:Draft"]);
    const corp = card(ok(html), "Corporate");
    expect(corp).toContain(">Draft<");
    expect(corp).not.toContain("data-not-listed");
    expect(corp).toContain(">Publish<");
  });

  it("keeps real blockers: red on a listed site, still listed (amber) on an unlisted one", async () => {
    corporateEditable();
    setWorkflow(
      {},
      {
        listing: { version: 2, visibility: "VISIBLE" },
        readiness: { ok: false, blocking: [coverMissing], warnings: [] },
      },
      { canPublish: true, ...notListed([coverMissing]) },
    );
    const html = await render({ site: "bv", tab: "publication" });
    expect(html).toContain("publishing blocked on 1 site");
    const bv = card(ok(html), "Dream Petroleum BV");
    expect(bv).toContain("Publishing is blocked:");
    expect(bv).toContain("A cover image is required.");
    const corp = card(ok(html), "Corporate");
    expect(corp).not.toContain("Publishing is blocked:");
    expect(corp).toContain("Publishing here would also need:");
    expect(corp).toContain("A cover image is required.");
    expect(corp).not.toContain("The site does not list this product.");
  });

  it("an unlisted site never raises the tab marker on its own", async () => {
    setWorkflow(
      {},
      { listing: { version: 2, visibility: "VISIBLE" }, readiness: ready },
      notListed(),
    );
    const html = await render({ site: "bv" });
    expect(html).not.toContain("publishing blocked on");
    expect(html).not.toMatch(/role="tab"[^>]*>Publication<span[^>]*text-danger/);
  });
});

// DP-204: Preview for the publisher (BV only, with the reason when missing); pre-publication
// checks only where something can be published; no past-tense or flow names on the cards.
describe("DP-204 preview access, publication warnings and status texts", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  type Site = ProductWorkflowResponse["sites"][number];
  function setSites(bv: Partial<Site>, corp: Partial<Site> = {}) {
    const w = reads.get(`${C}/products/${PRODUCT}/workflow`) as ProductWorkflowResponse;
    reads.set(`${C}/products/${PRODUCT}/workflow`, {
      ...w,
      sites: [
        { ...w.sites[0]!, ...bv },
        { ...w.sites[1]!, ...corp },
      ],
    });
  }
  const warn = (code: string, message: string) => ({
    severity: "WARNING" as const,
    code,
    target: code === "sensitive_claim" ? "text:pharmaceutical" : "product",
    message,
  });
  const notReviewed = warn(
    "not_reviewed",
    "No second person has reviewed this version (optional).",
  );
  const shown = warn(
    "listing_shown_on_publish",
    "The listing is hidden; publishing makes it visible on this site.",
  );
  const pending = warn(
    "company_review_pending",
    "The company has not reviewed the proposal (optional).",
  );
  const claim = warn(
    "sensitive_claim",
    "The public text mentions pharmaceutical or pharmacopoeia grade: publish it only with a certificate or source document.",
  );
  const summaryMissing = warn("summary_missing", "The product has no summary.");
  const allWarnings = {
    ok: true,
    blocking: [],
    warnings: [notReviewed, shown, pending, claim, summaryMissing],
  };
  const pubRow = (status: "PUBLISHED" | "UNPUBLISHED", approvalMode: "DIRECT" | "APPROVED") => ({
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
    approvalMode,
    slug: "fx-g1",
    version: 2,
  });
  function card(pub: string, name: string): string {
    const found = pub
      .split("<article")
      .slice(1)
      .find((c) => new RegExp(`</svg>${name}</h3>`).test(c));
    expect(found, name).toBeDefined();
    return found!.split("</article>")[0]!;
  }
  const bvCard = async () =>
    card(
      panel(await render({ site: "bv", tab: "publication" }), "publication"),
      "Dream Petroleum BV",
    );

  it("a publisher without the review role gets Preview on BV", async () => {
    // The API's canPreview (DP-204: product:publish or product_proposal:review on BV).
    setSites({ canPublish: true, canPreview: true });
    const bv = await bvCard();
    expect(bv).toContain(">Preview<");
    expect(bv).not.toContain("data-no-preview");
  });

  it("says why Preview is missing: rights on BV, BV only on Corporate", async () => {
    setSites(
      { canPublish: false, canPreview: false },
      {
        listing: { version: 1, visibility: "HIDDEN" },
        readiness: { ok: true, blocking: [], warnings: [] },
        canPreview: false,
      },
    );
    const pub = panel(await render({ site: "bv", tab: "publication" }), "publication");
    expect(card(pub, "Dream Petroleum BV")).not.toContain(">Preview<");
    expect(card(pub, "Dream Petroleum BV")).toContain(
      "Preview needs publishing or content review rights on this site.",
    );
    expect(card(pub, "Corporate")).toContain("Preview is available for the BV site only.");
    expect(card(pub, "Corporate")).not.toContain(">Preview<");
  });

  it("an unlisted site offers no Preview and no preview note", async () => {
    const corp = card(
      panel(await render({ site: "bv", tab: "publication" }), "publication"),
      "Corporate",
    );
    expect(corp).toContain("data-not-listed");
    expect(corp).not.toContain(">Preview<");
    expect(corp).not.toContain("data-no-preview");
  });

  it("Draft: every check before publishing, in the present tense", async () => {
    setSites({
      publishMode: "DIRECT",
      listing: { version: 2, visibility: "HIDDEN" },
      readiness: allWarnings,
    });
    const bv = await bvCard();
    expect(bv).toContain("Check before publishing:");
    expect(bv).toContain("No second person has reviewed this version (optional).");
    expect(bv).toContain("Not shown on this site yet: publishing shows it.");
    expect(bv).not.toMatch(/Published directly/);
    expect(bv).toContain("Never published on this site.");
  });

  it("Published and up to date: no pre-publication checks; data and claim warnings stay", async () => {
    setSites({
      publishMode: "DIRECT",
      listing: { version: 2, visibility: "VISIBLE" },
      publication: pubRow("PUBLISHED", "DIRECT"),
      readiness: allWarnings,
    });
    const bv = await bvCard();
    expect(bv).toContain("Live and up to date.");
    expect(bv).not.toContain("Check before publishing");
    expect(bv).not.toContain("No second person has reviewed");
    expect(bv).not.toContain("publishing shows it");
    expect(bv).not.toContain("company has not reviewed");
    expect(bv).toContain("Notes on the live version:");
    expect(bv).toContain("pharmaceutical or pharmacopoeia grade");
    expect(bv).toContain("The product has no summary.");
    // Date and person only: no version numbers, no flow names.
    expect(bv).toContain("Published 16 Nov 2026");
    expect(bv).not.toMatch(/master version|listing version|published directly|approved version/);
  });

  it("Published with changes: the checks come back, as before republishing", async () => {
    setSites({
      publishMode: "DIRECT",
      listing: { version: 2, visibility: "VISIBLE" },
      publication: pubRow("PUBLISHED", "APPROVED"),
      outdated: { master: true, listing: false },
      readiness: allWarnings,
    });
    const bv = await bvCard();
    expect(bv).toContain("Check before republishing:");
    expect(bv).toContain("No second person has reviewed this version (optional).");
    expect(bv).toContain("Changes since publication are not live yet");
    expect(bv).not.toMatch(/master version|now 7|approved version/);
  });

  it("Unpublished: checks before publishing again, last publication by date", async () => {
    setSites({
      publishMode: "DIRECT",
      listing: { version: 2, visibility: "VISIBLE" },
      publication: pubRow("UNPUBLISHED", "DIRECT"),
      readiness: allWarnings,
    });
    const bv = await bvCard();
    expect(bv).toContain(">Unpublished<");
    expect(bv).toContain("Check before publishing:");
    expect(bv).toContain("Last published 16 Nov 2026");
    expect(bv).not.toMatch(/Last live|master version/);
  });

  it("keeps real blockers red on a live site", async () => {
    setSites({
      listing: { version: 2, visibility: "VISIBLE" },
      publication: pubRow("PUBLISHED", "DIRECT"),
      outdated: { master: true, listing: false },
      readiness: {
        ok: false,
        blocking: [
          {
            severity: "BLOCKING",
            code: "cover_missing",
            target: "images",
            message: "A cover image is required.",
          },
        ],
        warnings: [claim],
      },
    });
    const bv = await bvCard();
    expect(bv).toContain("Republishing is blocked:");
    expect(bv).toContain("A cover image is required.");
    expect(bv).toContain("pharmaceutical or pharmacopoeia grade");
  });
});

// DP-202: the site's own texts are the primary Content fields; the shared master content is a
// separate, collapsed form that the hints name as the fallback.
describe("DP-202 site text first, shared content second", () => {
  beforeEach(() => fixtures({ canEditMaster: true }));

  function siteText(text: {
    title: string | null;
    summary: string | null;
    description: string | null;
  }) {
    const key = `${C}/products/${PRODUCT}?siteId=${BV}`;
    const d = reads.get(key) as { product: unknown; listing: Record<string, unknown> };
    reads.set(key, { ...d, listing: { ...d.listing, text } });
  }
  /** The <form> elements of one HTML fragment. */
  const forms = (html: string) =>
    html
      .split("<form")
      .slice(1)
      .map((f) => f.split("</form>")[0]!);

  it("puts the site text above the collapsed shared content, in two separate forms", async () => {
    const content = panel(await render({ site: "bv" }), "content");
    const site = content.indexOf('id="listing-panel"');
    const shared = content.indexOf('id="master"');
    expect(site).toBeGreaterThan(-1);
    expect(shared).toBeGreaterThan(site);
    // The shared content is a <details>, closed by default.
    expect(content).toMatch(/<details id="master"[^>]*>/);
    expect(content).not.toMatch(/<details id="master"[^>]*\sopen(=|\s|>)/);
    expect(content).toContain("Shared product content");
    expect(content).toContain("Not published as such: a site shows its own text above.");
    // Two forms: the site text never posts master fields, the master never posts site fields.
    const all = forms(content);
    expect(all).toHaveLength(2);
    const listingForm = all[0]!;
    const masterForm = all[1]!;
    for (const f of ['name="title"', 'name="summary"', 'name="description"', 'name="categoryId"'])
      expect(listingForm).toContain(f);
    for (const f of ['name="name"', 'name="code"', 'name="slug"'])
      expect(listingForm).not.toContain(f);
    for (const f of [
      'name="name"',
      'name="code"',
      'name="slug"',
      'name="summary"',
      'name="description"',
    ])
      expect(masterForm).toContain(f);
    expect(masterForm).not.toContain('name="title"');
    expect(masterForm).not.toContain('name="categoryId"');
    // Title, summary and description come before the listing settings.
    expect(listingForm.indexOf('name="description"')).toBeLessThan(
      listingForm.indexOf('name="categoryId"'),
    );
    expect(listingForm).toContain("Save Dream Petroleum BV text");
    expect(masterForm).toContain("Save shared content");
  });

  it("shows the saved site texts in the primary fields and says the page uses them", async () => {
    siteText({
      title: null,
      summary: "Site summary for BV.",
      description: "Site description for BV.",
    });
    const content = panel(await render({ site: "bv" }), "content");
    expect(content).toMatch(/name="summary"[^>]*>Site summary for BV\.<\/textarea>/);
    expect(content).toMatch(/name="description"[^>]*>Site description for BV\.<\/textarea>/);
    expect(content).toContain("Shown on the Dream Petroleum BV product card and product page.");
    expect(content).toContain(
      "Shown on the Dream Petroleum BV product page. English only for now.",
    );
    // The master description stays in its own field.
    expect(content).toMatch(/id="description"[^>]*>Fully synthetic engine oil\.<\/textarea>/);
  });

  it("names the shared text as the fallback of an empty site field, or says nothing shows", async () => {
    // Fixture: no site text; master summary empty, master description filled.
    const content = panel(await render({ site: "bv" }), "content");
    expect(content).toContain(
      "Empty: Dream Petroleum BV shows the shared description from “Shared product content” below.",
    );
    expect(content).toContain(
      "Empty: the Dream Petroleum BV product card and page show no summary.",
    );
    expect(content).toContain(
      "Empty: Dream Petroleum BV shows the shared name from “Shared product content” below.",
    );
  });

  it("sends a missing summary or description to this site's text, not to the master", () => {
    for (const code of ["summary_missing", "description_missing"]) {
      const fix = fixForIssue(code);
      expect(fix).toMatchObject({ tab: "content", section: "listing", perSite: true });
      expect(fix!.hint).not.toContain("master");
    }
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

// DP-209: the SEO tab — the product's SEO on the selected site, saved on the listing and shown on
// the site after the next publication; previews apply the site's published defaults.
describe("DP-209 product SEO tab", () => {
  const DETAIL = `${C}/products/${PRODUCT}?siteId=${BV}`;
  const SETTINGS = `/api/v1/admin/seo/sites/${BV}/overview?part=settings`;
  type Detail = { listing: Record<string, unknown> };

  beforeEach(() => fixtures({ canEditMaster: true }));

  it("renders the SEO form with previews, built-in defaults and the product's address", async () => {
    const seo = panel(await render({ site: "bv", tab: "seo" }), "seo");
    for (const id of [
      "title",
      "description",
      "canonical",
      "og-title",
      "og-description",
      "og-image",
    ])
      expect(seo).toContain(`id="product-seo-22222222-${id}"`);
    expect(seo).toContain("Save SEO");
    expect(seo).toContain("Search result");
    expect(seo).toContain("Link preview");
    // No SEO title: the product name and the site name (built-in default).
    expect(seo).toContain("ICCSYN 6 Synthetic | Dream Petroleum BV");
    // ML-5: the public address with the /en prefix, as the site renders it.
    expect(seo).toContain("http://localhost:3110/en/products/iccsyn-6");
    expect(seo).toContain("Cover image (default)");
  });

  it("shows saved values: noindex, a canonical override and length warnings, never as errors", async () => {
    (reads.get(DETAIL) as Detail).listing["seo"] = {
      title: "A very long SEO title that goes on and on beyond what a search result shows",
      description: null,
      ogTitle: null,
      ogDescription: null,
      canonicalPath: "/products/iccsyn-6-plus",
      noindex: true,
      ogImageId: null,
    };
    const seo = panel(await render({ site: "bv", tab: "seo" }), "seo");
    expect(seo).toContain("Hidden from search engines (noindex): this result is not shown.");
    expect(seo).toContain("http://localhost:3110/en/products/iccsyn-6-plus");
    expect(seo).toContain("this page stays out of the sitemap");
    expect(seo).toContain("SEO title: 75 characters: about 60 are shown");
    expect(seo).not.toContain('aria-invalid="true"');
  });

  it("uses the published site defaults (bv.site-seo) in the preview", async () => {
    reads.set(SETTINGS, {
      site: { id: BV, key: "BV", name: "Dream Petroleum BV" },
      permissions: {
        readPages: true,
        editPages: true,
        publishPages: true,
        readProducts: true,
        editProducts: true,
      },
      settings: null,
      liveSettings: {
        siteName: "Dream Petroleum B.V.",
        defaultTitle: "Dream Petroleum B.V.",
        defaultDescription: "Base oils and specialty products.",
        defaultOgImage: "/media/ctl-technology/industrial-process.webp",
      },
      items: [],
    });
    const seo = panel(await render({ site: "bv", tab: "seo" }), "seo");
    expect(seo).toContain("ICCSYN 6 Synthetic | Dream Petroleum B.V.");
    expect(seo).toContain("Base oils and specialty products.");
    expect(seo).toContain("http://localhost:3110/media/ctl-technology/industrial-process.webp");
  });

  it("is read only without product:edit on the site", async () => {
    fixtures({ canEditMaster: false });
    const seo = panel(await render({ site: "bv", tab: "seo" }), "seo");
    expect(seo).not.toContain("Save SEO");
    expect(seo).toContain("Read only for you on this site.");
  });

  it("keeps #seo links in the SEO tab", () => {
    expect(tabForHash("#seo")).toBe("seo");
    expect(parseProductTab("seo")).toBe("seo");
  });
});

// ML-8b (ADR-028 D8, DP-239, DP-257): EN/NL language tabs on Content and SEO, and the languages
// of a publication. English stays the existing editor; Dutch is written next to its source.
describe("ML-8b EN/NL language tabs", () => {
  const NL = `${C}/products/${PRODUCT}/translations?siteId=${BV}&locale=nl`;
  const LISTING = "66666666-6666-4666-8666-666666666666";
  const IMG = "77777777-7777-4777-8777-777777777777";
  const p = (value: string | null, source: string | null) => ({ value, source });
  function translations(over: Record<string, unknown> = {}) {
    return {
      productId: PRODUCT,
      siteId: BV,
      locale: "nl",
      defaultLocale: "en",
      enabled: true,
      public: false,
      locales: [
        { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
        { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
      ],
      live: { published: false, hasLocale: false },
      requiredMissing: ["listing", "category", "spec:viscosity"],
      missing: ["summary", "description", "seo.title", "category.name", "spec:viscosity"],
      listing: {
        id: LISTING,
        version: 2,
        hasText: false,
        state: "MISSING",
        seoState: "MISSING",
        sharedSource: { title: true, summary: false, description: true },
        title: p(null, "ICCSYN 6 Synthetic"),
        summary: p(null, "Full synthetic 5W-30 for passenger cars."),
        description: p(null, "Fully synthetic engine oil."),
        seo: {
          title: p(null, "ICCSYN 6 engine oil"),
          description: p(null, null),
          ogTitle: p(null, null),
          ogDescription: p(null, null),
        },
      },
      category: {
        id: CAT,
        version: 1,
        state: "MISSING",
        name: p(null, "Engine oils"),
        description: p(null, null),
      },
      specs: [
        {
          definitionId: DEF,
          key: "viscosity",
          version: 1,
          state: "MISSING",
          name: p(null, "Kinematic viscosity"),
        },
      ],
      images: [
        {
          id: IMG,
          version: 1,
          isPublic: true,
          originalFilename: "drum.jpg",
          state: null,
          altText: p(null, null),
        },
      ],
      ...over,
    };
  }
  function withDutch(opts: { canEditMaster: boolean } = { canEditMaster: true }, over = {}) {
    fixtures(opts);
    const wf = reads.get(`${C}/products/${PRODUCT}/workflow`) as ProductWorkflowResponse;
    wf.sites[0]!.languages = [
      {
        locale: "en",
        isDefault: true,
        public: true,
        live: false,
        hasText: true,
        state: "DRAFT",
        requiredMissing: [],
        claims: [],
        claimScan: "AUTOMATIC",
      },
      {
        locale: "nl",
        isDefault: false,
        public: false,
        live: false,
        hasText: false,
        state: "MISSING",
        requiredMissing: ["listing", "category", "spec:viscosity"],
        claims: [],
        claimScan: "MANUAL",
      },
    ];
    reads.set(NL, translations(over));
  }
  /** One language panel of a tab (`data-lang-tab` buttons control `…-panel-<lang>`). */
  const langPanel = (html: string, lang: string) => {
    const start = html.indexOf(`data-lang-panel="${lang}"`);
    expect(start, lang).toBeGreaterThan(-1);
    const open = html.lastIndexOf("<div", start);
    const end = html.indexOf("data-lang-panel=", start + 20);
    return html.slice(open, end === -1 ? undefined : html.lastIndexOf("<div", end));
  };

  it("Content: EN and NL tabs, English (the existing editor) active by default, Dutch mounted and hidden", async () => {
    withDutch();
    const content = panel(await render({}), "content");
    expect(content).toContain('aria-label="Language of the product text"');
    expect(content).toMatch(/data-lang-tab="en"[^>]*>|aria-selected="true"[^>]*data-lang-tab="en"/);
    const en = langPanel(content, "en");
    expect(en).not.toMatch(/^<div[^>]*hidden=""/);
    expect(en).toContain("Save Dream Petroleum BV text");
    const nl = langPanel(content, "nl");
    expect(nl).toMatch(/^<div[^>]*hidden=""/);
    expect(nl).toContain('lang="nl"');
  });

  it("?lang=nl: empty Dutch fields next to the English source, missing marked, nothing invented", async () => {
    withDutch();
    const nl = langPanel(panel(await render({ lang: "nl" }), "content"), "nl");
    expect(nl).not.toMatch(/^<div[^>]*hidden=""/);
    // the English source is shown, never copied into the Dutch fields
    expect(nl).toContain("Full synthetic 5W-30 for passenger cars.");
    expect(nl).toMatch(/name="summary"[^>]*><\/textarea>/);
    expect(nl).toMatch(/name="title"[^>]*value=""/);
    expect(nl).toContain("English source · shared product text");
    expect(nl).toContain('data-missing=""');
    // what blocks Dutch in a publication, in words
    expect(nl).toContain("Needed before Dutch can be published:");
    expect(nl).toContain("Product text (title, summary or description)");
    expect(nl).toContain("Category name");
    expect(nl).toContain("Specification name: Kinematic viscosity");
    expect(nl).toContain("Not public yet");
    expect(nl).toContain("No text is translated or copied automatically");
    expect(nl).toContain("Save Dutch text");
    // codes stay codes
    expect(nl).toContain("<code");
  });

  it("Dutch is read only without product:edit on the site or master edit rights", async () => {
    withDutch({ canEditMaster: false });
    const nl = langPanel(panel(await render({ lang: "nl" }), "content"), "nl");
    expect(nl).toContain(
      "Read only: editing this site&#x27;s listings needs product:edit on the site.",
    );
    expect(nl).toContain("Read only: specification names need product master edit rights.");
    expect(nl).not.toContain("Save Dutch text");
  });

  it("Outdated texts offer “Still correct: mark as checked”", async () => {
    withDutch(
      { canEditMaster: true },
      {
        requiredMissing: [],
        missing: [],
        listing: {
          ...translations().listing,
          hasText: true,
          state: "OUTDATED",
          title: p("ICCSYN 6 Synthetisch", "ICCSYN 6 Synthetic"),
        },
      },
    );
    const nl = langPanel(panel(await render({ lang: "nl" }), "content"), "nl");
    expect(nl).toContain('data-translation-state="OUTDATED"');
    expect(nl).toContain("Still correct: mark as checked");
    expect(nl).toContain("Complete enough to publish in Dutch.");
  });

  it("SEO: Dutch SEO texts next to the English ones; canonical, noindex and image stay shared", async () => {
    withDutch();
    const seo = panel(await render({ tab: "seo", lang: "nl" }), "seo");
    expect(seo).toContain('aria-label="Language of the SEO texts"');
    const nl = langPanel(seo, "nl");
    expect(nl).toContain("SEO title (Dutch)");
    expect(nl).toContain("ICCSYN 6 engine oil");
    expect(nl).toContain("Canonical path, indexing and the link preview image are the same");
    expect(nl).toContain("Save Dutch SEO");
  });

  it("Publication: Dutch is never published implicitly; an incomplete Dutch cannot be chosen", async () => {
    withDutch();
    const bv = card(
      panel(await render({ tab: "publication" }), "publication"),
      "Dream Petroleum BV",
    );
    expect(bv).toContain('data-languages=""');
    expect(bv).toContain("Always published from the current texts (the default language).");
    expect(bv).toContain("Not chosen: no Dutch texts are published.");
    expect(bv).toMatch(/type="checkbox"[^>]*disabled=""/);
    expect(bv).toContain("Dutch needs before publishing:");
    expect(bv).toContain("Preview Dutch");
  });

  it("a site with one language (Corporate, or no languages known) renders without language tabs", async () => {
    fixtures({ canEditMaster: true });
    const content = panel(await render({}), "content");
    expect(content).not.toContain("Language of the product text");
    expect(content).toContain("Save Dream Petroleum BV text");
  });
});
