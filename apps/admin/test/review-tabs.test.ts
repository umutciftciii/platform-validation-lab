// DP-189: the company review's tabs and list filters (pure functions).
import { describe, expect, it } from "vitest";
import type { ProposalSummary } from "@dream/contracts";
import {
  DEFAULT_REVIEW_TAB,
  filterProposals,
  parseReviewTab,
  readReviewFilters,
  REVIEW_SECTION_TAB,
  REVIEW_TABS,
  reviewAttention,
  reviewHref,
  reviewListHref,
  reviewTabForHash,
  reviewTabLabel,
} from "../lib/review-tabs";
import { createTranslator } from "../lib/i18n/translate";

const ID = "0190f2a1-0000-7000-8000-000000000301";
const CAT = "0190f2a1-0000-7000-8000-000000000501";

describe("review tabs", () => {
  it("has the four tabs in order, Content Review first", () => {
    const en = createTranslator("en");
    expect(REVIEW_TABS.map((t) => reviewTabLabel(t.id, en))).toEqual([
      "Content Review",
      "Missing & Verification",
      "Sources",
      "History",
    ]);
    // ML-12b: the same tabs in Turkish; the ids (URL `?tab=`) never change.
    const tr = createTranslator("tr");
    expect(REVIEW_TABS.map((t) => reviewTabLabel(t.id, tr))).toEqual([
      "İçerik incelemesi",
      "Eksikler ve doğrulama",
      "Kaynaklar",
      "Geçmiş",
    ]);
    expect(DEFAULT_REVIEW_TAB).toBe("content");
  });

  it.each([
    ["verification", "verification"],
    ["sources", "sources"],
    ["history", "history"],
    ["content", "content"],
    ["publication", "content"],
    ["", "content"],
    [undefined, "content"],
  ])("parses ?tab=%s", (value, tab) => {
    expect(parseReviewTab(value)).toBe(tab);
  });

  it("takes the first value of a repeated ?tab", () => {
    expect(parseReviewTab(["history", "sources"])).toBe("history");
  });

  it("builds the page URL with the site, leaving the default tab out", () => {
    expect(reviewHref(ID, "bv", "content")).toBe(`/company-review/${ID}?site=bv`);
    expect(reviewHref(ID, "bv", "history")).toBe(`/company-review/${ID}?site=bv&tab=history`);
    expect(reviewHref(ID, undefined, "content")).toBe(`/company-review/${ID}`);
    expect(reviewHref(ID, undefined, "sources")).toBe(`/company-review/${ID}?tab=sources`);
  });

  it("opens the tab holding an old or in-page #section", () => {
    expect(reviewTabForHash("#decision")).toBe("content");
    expect(reviewTabForHash("#current")).toBe("content");
    expect(reviewTabForHash("#review-items")).toBe("verification");
    expect(reviewTabForHash("#held")).toBe("verification");
    expect(reviewTabForHash("sources")).toBe("sources");
    expect(reviewTabForHash("#history")).toBe("history");
    expect(reviewTabForHash("#elsewhere")).toBeNull();
    const ids = new Set(REVIEW_TABS.map((t) => t.id));
    expect(Object.values(REVIEW_SECTION_TAB).every((t) => ids.has(t))).toBe(true);
  });
});

const summary = (id: string, name: string, code: string, productId: string): ProposalSummary =>
  ({
    id,
    siteId: ID,
    productId,
    productCode: code,
    productName: name,
    locale: "en",
    status: "REVIEW_PENDING",
    version: 1,
    hasText: true,
    itemCounts: {},
    updatedAt: "2026-11-16T10:00:00.000Z",
  }) as ProposalSummary;

describe("list filters", () => {
  const list = [
    summary("a", "Group II Base Oil HVI 6", "G2-HVI-6", "p1"),
    summary("b", "Sustainable Aviation Fuel (SAF)", "SAF", "p2"),
    summary("c", "Diesel EN 590", "EN590", "p3"),
  ];

  it("reads only valid values from the URL", () => {
    const statuses = ["REVIEW_PENDING", "APPROVED"];
    expect(readReviewFilters({ q: "  saf ", category: CAT, status: "APPROVED" }, statuses)).toEqual(
      { q: "saf", category: CAT, status: "APPROVED" },
    );
    expect(readReviewFilters({ category: "x", status: "PUBLISHED" }, statuses)).toEqual({
      q: "",
      category: "",
      status: "",
    });
    expect(readReviewFilters({ q: "x".repeat(300) }, statuses).q).toHaveLength(100);
  });

  it.each([
    ["saf", ["b"]],
    ["SAF", ["b"]],
    ["hvi 6", ["a"]],
    ["en590", ["c"]],
    ["diésel", ["c"]],
    ["", ["a", "b", "c"]],
    ["nothing", []],
  ])("searches name and SKU for %s", (q, ids) => {
    expect(filterProposals(list, q, null).map((p) => p.id)).toEqual(ids);
  });

  it("limits to the products of a category", () => {
    expect(filterProposals(list, "", new Set(["p1", "p3"])).map((p) => p.id)).toEqual(["a", "c"]);
    expect(filterProposals(list, "diesel", new Set(["p1"]))).toEqual([]);
  });

  it("builds list URLs without empty filters", () => {
    expect(reviewListHref("bv", {})).toBe("/company-review?site=bv");
    expect(reviewListHref("bv", { q: "a b", category: CAT, status: "APPROVED" })).toBe(
      `/company-review?site=bv&q=a+b&category=${CAT}&status=APPROVED`,
    );
  });

  it("groups item counts as the list and the tabs show them", () => {
    expect(
      reviewAttention({
        CLASS_CONFLICT: 1,
        INCONSISTENCY: 2,
        PLACEHOLDER: 1,
        DP002_HELD: 15,
        SITE_VALUE_WITHHELD: 2,
        CONFIRM: 3,
        MISSING_DOCUMENT: 1,
        CLAIM_RISK: 4,
      }),
    ).toEqual({ conflicts: 4, held: 17, questions: 3, missingDocuments: 1, claimRisks: 4 });
    expect(reviewAttention({})).toEqual({
      conflicts: 0,
      held: 0,
      questions: 0,
      missingDocuments: 0,
      claimRisks: 0,
    });
  });
});
