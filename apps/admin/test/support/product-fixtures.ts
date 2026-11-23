// ML-12a: the product page fixtures of test/product-tabs.test.tsx (DP-187 onwards), shared with the
// Turkish render test (catalog-i18n.test.tsx): real response shapes for every read of the product
// page, behind the mocked serverRead of support/catalog-fixtures.ts (`reads`).
import type { ProductWorkflowResponse } from "@dream/contracts";
import { reads } from "./catalog-fixtures";

export const C = "/api/v1/admin/catalog";
export const PRODUCT = "11111111-1111-4111-8111-111111111111";
export const BV = "22222222-2222-4222-8222-222222222222";
export const CORP = "33333333-3333-4333-8333-333333333333";
export const CAT = "44444444-4444-4444-8444-444444444444";
export const DEF = "55555555-5555-4555-8555-555555555555";
export const T = "2026-11-16T10:00:00.000Z";
export const PROPOSAL = "0190a8c4-7c1e-7000-8000-0000000000f1";

export function fixtures(opts: { canEditMaster: boolean }) {
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
