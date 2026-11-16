// DP-197: Draft / Published / Unpublished, the Publish button's plan and the listing request
// bodies. The Content save never changes visibility; Publish shows the listing when needed
// (DIRECT: in the API's transaction; APPROVED: switch on, publish, switch back off on failure).
import type { Listing, PublicationIssue, SitePublication } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { listingSaveBody, listingVisibilityBody } from "../lib/listing-request";
import { planPublication, siteStatus } from "../lib/publication-status";

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
    readiness: {
      ok: true,
      blocking: [],
      warnings: [issue("WARNING", "listing_shown_on_publish")],
    },
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
  const opts = { canEditListing: true, productStatus: "DRAFT" as const };

  it("DIRECT: publishes a draft and lets the API show the listing in the same step", () => {
    const plan = planPublication(site(), opts);
    expect(plan).toMatchObject({
      status: "DRAFT",
      showListing: "direct",
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
    expect(plan.showListing).toBe("none");
    expect(plan.canPublish).toBe(true);
  });

  it("APPROVED: switches the listing on first when the publisher may edit it", () => {
    const approved = site({
      publishMode: "APPROVED",
      canShowListing: false,
      readiness: { ok: false, blocking: [issue("BLOCKING", "listing_hidden")], warnings: [] },
    });
    const plan = planPublication(approved, { canEditListing: true, productStatus: "APPROVED" });
    expect(plan.showListing).toBe("listing-first");
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
    const plan = planPublication(approved, { canEditListing: false, productStatus: "APPROVED" });
    expect(plan.showListing).toBe("none");
    expect(plan.canPublish).toBe(false);
    expect(plan.blocking[0]!.message).toBe(
      "Not shown on this site yet. Publishing here also needs edit rights on this site's listing.",
    );
  });

  it("APPROVED keeps every other blocker (an unapproved master is never published)", () => {
    const plan = planPublication(
      site({
        publishMode: "APPROVED",
        canShowListing: false,
        readiness: {
          ok: false,
          blocking: [issue("BLOCKING", "not_approved"), issue("BLOCKING", "listing_hidden")],
          warnings: [],
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
      showListing: "direct",
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

  it("the switch-on step changes only the visibility", () => {
    expect(listingVisibilityBody({ ...listing, visibility: "HIDDEN" }, "VISIBLE", 9)).toEqual({
      version: 9,
      categoryId: listing.categoryId,
      visibility: "VISIBLE",
      sortOrder: 5,
      title: "Title",
      summary: "Summary",
      description: null,
    });
    expect(listingVisibilityBody(listing, "HIDDEN", 10)).toMatchObject({
      version: 10,
      visibility: "HIDDEN",
    });
  });
});
