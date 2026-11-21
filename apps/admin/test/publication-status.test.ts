// DP-197: Draft / Published / Unpublished, the Publish button's plan and the listing request
// bodies. The Content save never changes visibility; Publish shows the listing when needed.
// DP-198 (R-29): in both modes with one request (makeVisible), inside the API's transaction.
import {
  EMPTY_PRODUCT_SEO,
  type Listing,
  type PublicationIssue,
  type SitePublication,
} from "@dream/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messageForIssues } from "../lib/catalog-client";
import { listingSaveBody } from "../lib/listing-request";
import {
  blockedSiteCount,
  headerStatus,
  planPublication,
  siteDisplayStatus,
  siteStatus,
  submitOffer,
} from "../lib/publication-status";

const T = "2026-11-17T10:00:00.000Z";
const actor = { id: "0190a8c4-7c1e-7000-8000-0000000000a1", name: "Owner" };

const issue = (severity: "BLOCKING" | "WARNING", code: string): PublicationIssue => ({
  severity,
  code,
  target: "listing",
  message:
    code === "listing_hidden"
      ? "The listing is hidden on this site."
      : code === "listing_shown_on_publish"
        ? "The listing is hidden; publishing makes it visible on this site."
        : code,
});

function site(over: Partial<SitePublication> = {}): SitePublication {
  return {
    siteId: "22222222-2222-4222-8222-222222222222",
    siteKey: "BV",
    siteName: "Dream Petroleum BV",
    canPublish: true,
    listing: { version: 3, visibility: "HIDDEN" },
    publication: null,
    outdated: { master: false, listing: false },
    publishMode: "DIRECT",
    canShowListing: true,
    canPreview: true,
    proposal: null,
    addresses: { live: null, next: "/products/fx-g1", keepsOldAddress: true, redirectsHere: [] },
    readiness: {
      ok: true,
      blocking: [],
      warnings: [issue("WARNING", "listing_shown_on_publish")],
    },
    languages: [],
    ...over,
  };
}

const publication = (status: "PUBLISHED" | "UNPUBLISHED") => ({
  id: "0190a8c4-7c1e-7000-8000-0000000000b1",
  status,
  productVersion: 7,
  listingVersion: 3,
  publishedAt: T,
  publishedBy: actor,
  unpublishedAt: status === "UNPUBLISHED" ? T : null,
  unpublishedBy: status === "UNPUBLISHED" ? actor : null,
  approvalMode: "DIRECT" as const,
  slug: "fx-g1",
  version: 2,
});

describe("siteStatus", () => {
  it("is Draft until the first publication, whatever the listing", () => {
    expect(siteStatus({ publication: null, listing: null })).toBe("DRAFT");
    expect(siteStatus({ publication: null, listing: "HIDDEN" })).toBe("DRAFT");
    expect(siteStatus({ publication: null, listing: "VISIBLE" })).toBe("DRAFT");
  });

  it("is Published only when the public catalogue shows it (published, shown, not archived)", () => {
    const live = { status: "PUBLISHED" as const };
    expect(siteStatus({ publication: live, listing: "VISIBLE", productStatus: "DRAFT" })).toBe(
      "PUBLISHED",
    );
    expect(siteStatus({ publication: live, listing: "HIDDEN" })).toBe("UNPUBLISHED");
    expect(siteStatus({ publication: live, listing: null })).toBe("UNPUBLISHED");
    expect(siteStatus({ publication: live, listing: "VISIBLE", productStatus: "ARCHIVED" })).toBe(
      "UNPUBLISHED",
    );
  });

  it("is Unpublished after an unpublish, although the listing stays switched on", () => {
    expect(siteStatus({ publication: { status: "UNPUBLISHED" }, listing: "VISIBLE" })).toBe(
      "UNPUBLISHED",
    );
  });
});

describe("planPublication", () => {
  const opts = { productStatus: "DRAFT" as const };

  it("DIRECT: publishes a draft and lets the API show the listing in the same step", () => {
    const plan = planPublication(site(), opts);
    expect(plan).toMatchObject({
      status: "DRAFT",
      showListing: true,
      canPublish: true,
      publishLabel: "Publish",
      canUnpublish: false,
      upToDate: false,
    });
    expect(plan.warnings[0]!.message).toBe("Not shown on this site yet: publishing shows it.");
    expect(JSON.stringify(plan)).not.toMatch(/is hidden|makes it visible/);
  });

  it("DIRECT: no makeVisible when the listing is already shown", () => {
    const plan = planPublication(
      site({
        listing: { version: 3, visibility: "VISIBLE" },
        readiness: { ok: true, blocking: [], warnings: [] },
      }),
      opts,
    );
    expect(plan.showListing).toBe(false);
    expect(plan.canPublish).toBe(true);
  });

  it("APPROVED: shows the listing in the publishing request when the API allows it", () => {
    const approved = site({ publishMode: "APPROVED" });
    const plan = planPublication(approved, { productStatus: "APPROVED" });
    expect(plan.showListing).toBe(true);
    expect(plan.blocking).toEqual([]);
    expect(plan.warnings.map((w) => [w.code, w.message])).toEqual([
      ["listing_shown_on_publish", "Not shown on this site yet: publishing shows it."],
    ]);
    expect(plan.canPublish).toBe(true);
  });

  it("APPROVED without edit rights on the listing: still blocked, said in plain words", () => {
    const approved = site({
      publishMode: "APPROVED",
      canShowListing: false,
      readiness: { ok: false, blocking: [issue("BLOCKING", "listing_hidden")], warnings: [] },
    });
    const plan = planPublication(approved, { productStatus: "APPROVED" });
    expect(plan.showListing).toBe(false);
    expect(plan.canPublish).toBe(false);
    expect(plan.blocking[0]!.message).toBe(
      "Not shown on this site yet. Publishing here also needs edit rights on this site's listing.",
    );
  });

  it("APPROVED keeps every other blocker (an unapproved master is never published)", () => {
    const plan = planPublication(
      site({
        publishMode: "APPROVED",
        readiness: {
          ok: false,
          blocking: [issue("BLOCKING", "not_approved")],
          warnings: [issue("WARNING", "listing_shown_on_publish")],
        },
      }),
      opts,
    );
    expect(plan.blocking.map((i) => i.code)).toEqual(["not_approved"]);
    expect(plan.canPublish).toBe(false);
  });

  it("Published and up to date: Republish disabled, Unpublish offered", () => {
    const plan = planPublication(
      site({
        listing: { version: 3, visibility: "VISIBLE" },
        publication: publication("PUBLISHED"),
        readiness: { ok: true, blocking: [], warnings: [] },
      }),
      opts,
    );
    expect(plan).toMatchObject({
      status: "PUBLISHED",
      upToDate: true,
      canPublish: false,
      publishLabel: "Republish",
      canUnpublish: true,
    });
  });

  it("Published with changes since: Republish enabled", () => {
    const plan = planPublication(
      site({
        listing: { version: 4, visibility: "VISIBLE" },
        publication: publication("PUBLISHED"),
        outdated: { master: false, listing: true },
        readiness: { ok: true, blocking: [], warnings: [] },
      }),
      opts,
    );
    expect(plan).toMatchObject({ upToDate: false, canPublish: true, publishLabel: "Republish" });
  });

  it("Unpublished: Publish again, no Unpublish", () => {
    const plan = planPublication(
      site({
        listing: { version: 3, visibility: "VISIBLE" },
        publication: publication("UNPUBLISHED"),
        readiness: { ok: true, blocking: [], warnings: [] },
      }),
      opts,
    );
    expect(plan).toMatchObject({
      status: "UNPUBLISHED",
      canPublish: true,
      publishLabel: "Publish",
      canUnpublish: false,
    });
  });

  it("a published product whose listing was switched off reads Unpublished; Publish shows it", () => {
    const plan = planPublication(site({ publication: publication("PUBLISHED") }), opts);
    expect(plan).toMatchObject({
      status: "UNPUBLISHED",
      showListing: true,
      upToDate: false,
      canPublish: true,
      publishLabel: "Publish",
      canUnpublish: false,
    });
  });

  it("offers nothing without the site's publisher role", () => {
    const plan = planPublication(site({ canPublish: false, canShowListing: false }), opts);
    expect(plan.canPublish).toBe(false);
    expect(plan.canUnpublish).toBe(false);
  });

  it("cannot publish without a listing", () => {
    const plan = planPublication(
      site({
        listing: null,
        readiness: { ok: false, blocking: [issue("BLOCKING", "listing_missing")], warnings: [] },
      }),
      opts,
    );
    expect(plan.canPublish).toBe(false);
  });
});

describe("listing request bodies", () => {
  const listing: Listing = {
    id: "0190a8c4-7c1e-7000-8000-0000000000c1",
    siteId: "22222222-2222-4222-8222-222222222222",
    categoryId: "44444444-4444-4444-8444-444444444444",
    visibility: "VISIBLE",
    sortOrder: 5,
    version: 9,
    text: { title: "Title", summary: "Summary", description: null },
    seo: EMPTY_PRODUCT_SEO,
    updatedAt: T,
  };
  const values = {
    categoryId: listing.categoryId,
    sortOrder: "5",
    title: "New title",
    summary: "Summary",
    description: "",
  };

  it("a Content save sends the saved visibility unchanged (shown or not)", () => {
    expect(listingSaveBody(listing, values)).toEqual({
      version: 9,
      categoryId: listing.categoryId,
      visibility: "VISIBLE",
      sortOrder: 5,
      title: "New title",
      summary: "Summary",
      description: "",
    });
    expect(listingSaveBody({ ...listing, visibility: "HIDDEN" }, values).visibility).toBe("HIDDEN");
  });

  it("a new listing starts off the site", () => {
    expect(listingSaveBody(null, { ...values, categoryId: "", sortOrder: "x" })).toMatchObject({
      version: null,
      categoryId: null,
      visibility: "HIDDEN",
      sortOrder: 0,
    });
  });
});

// DP-198 (R-29): Publish is one API request in both modes; the console never saves the listing
// around it, and every refusal reads as what happened.
describe("DP-198 one publishing request", () => {
  const source = readFileSync(
    new URL("../components/catalog/workflow.tsx", import.meta.url),
    "utf8",
  );

  it("the Publication tab calls no listing endpoint", () => {
    expect(source).not.toMatch(/\/listings\//);
    expect(source).not.toMatch(/listingVisibilityBody|listing-first/);
    expect(source).toMatch(/makeVisible: plan\.showListing/);
  });

  it("explains a repeated, a concurrent and a refused publication", () => {
    expect(
      messageForIssues("CONFLICT_STATE", [{ path: "publication", rule: "already_published" }]),
    ).toBe("This version is already live on the site. Reload the page.");
    expect(messageForIssues("CONFLICT_STATE", [{ path: "publication", rule: "unique" }])).toBe(
      "The product was published on this site meanwhile. Reload the page.",
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "status", rule: "not_approved" }])).toBe(
      "The product master must be approved in its current version.",
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "listingVersion", rule: "stale" }])).toBe(
      "The site listing changed meanwhile. Reload the page and check it again.",
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "listing", rule: "listing_hidden" }])).toBe(
      "Not shown on this site yet. Publishing here also needs edit rights on this site's listing.",
    );
  });
});

// DP-203: Not listed apart from Draft; unlisted sites raise no red marker; Submit for review
// only where a review can change what the user publishes.
describe("DP-203 status helpers", () => {
  const missing = issue("BLOCKING", "listing_missing");
  const cover = issue("BLOCKING", "cover_missing");

  it("tells Not listed from Draft", () => {
    expect(siteDisplayStatus({ publication: null, listing: null })).toBe("NOT_LISTED");
    expect(siteDisplayStatus({ publication: null, listing: "HIDDEN" })).toBe("DRAFT");
    // Published before, listing gone since: off the site, not "Not listed".
    expect(siteDisplayStatus({ publication: { status: "UNPUBLISHED" }, listing: null })).toBe(
      "UNPUBLISHED",
    );
  });

  it("drops listing_missing from an unlisted site's blockers and keeps the others", () => {
    const plan = planPublication(
      site({ listing: null, readiness: { ok: false, blocking: [missing, cover], warnings: [] } }),
      { productStatus: "DRAFT" },
    );
    expect(plan.status).toBe("NOT_LISTED");
    expect(plan.notListed).toBe(true);
    expect(plan.blocking.map((i) => i.code)).toEqual(["cover_missing"]);
    expect(plan.canPublish).toBe(false);
  });

  it("counts only listed sites as blocked", () => {
    const unlisted = site({
      listing: null,
      readiness: { ok: false, blocking: [missing, cover], warnings: [] },
    });
    const listed = site({ readiness: { ok: false, blocking: [cover], warnings: [] } });
    expect(blockedSiteCount([unlisted], "DRAFT")).toBe(0);
    expect(blockedSiteCount([unlisted, listed], "DRAFT")).toBe(1);
  });

  it("puts the master next to the site statuses only when it adds something", () => {
    const live = site({
      listing: { version: 3, visibility: "VISIBLE" },
      publication: publication("PUBLISHED"),
    });
    const unlisted = site({ siteKey: "CORPORATE", listing: null });
    expect(headerStatus([live, unlisted], "DRAFT")).toEqual({
      sites: [
        { siteKey: "BV", status: "PUBLISHED" },
        { siteKey: "CORPORATE", status: "NOT_LISTED" },
      ],
      master: "DRAFT",
    });
    expect(headerStatus([site(), unlisted], "DRAFT").master).toBeNull();
    expect(headerStatus([site(), unlisted], "IN_REVIEW").master).toBe("IN_REVIEW");
  });

  it("offers Submit for review by publish mode, never without canSubmit", () => {
    const d = { publishMode: "DIRECT" as const };
    const a = { publishMode: "APPROVED" as const };
    expect(submitOffer({ permissions: { canSubmit: true }, sites: [d, d] })).toBe("hidden");
    expect(submitOffer({ permissions: { canSubmit: true }, sites: [d, a] })).toBe("secondary");
    expect(submitOffer({ permissions: { canSubmit: true }, sites: [a, a] })).toBe("primary");
    expect(submitOffer({ permissions: { canSubmit: true }, sites: [] })).toBe("primary");
    expect(submitOffer({ permissions: { canSubmit: false }, sites: [a] })).toBe("hidden");
  });
});
