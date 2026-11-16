/**
 * DP-189: the company review's tabs and list filters. Pure functions, shared by the server pages
 * and the client tab shell, and unit-tested without a browser.
 *
 * Tabs of one proposal: Content Review (current text against the proposal, the decision),
 * Missing & Verification (open questions, conflicts, held values, missing documents, the current
 * technical data), Sources and History. Each piece of data is shown in exactly one tab.
 */
import type { ProposalSummary, ReviewItemKind } from "@dream/contracts";
import { COMPANY_REVIEW_PATH } from "./proposals-view";

export const REVIEW_TABS = [
  { id: "content", label: "Content Review" },
  { id: "verification", label: "Missing & Verification" },
  { id: "sources", label: "Sources" },
  { id: "history", label: "History" },
] as const;

export type ReviewTabId = (typeof REVIEW_TABS)[number]["id"];

export const DEFAULT_REVIEW_TAB: ReviewTabId = "content";

const TAB_IDS: ReadonlySet<string> = new Set(REVIEW_TABS.map((t) => t.id));

/** `?tab=` of the proposal page; anything unknown opens the default tab. */
export function parseReviewTab(value: string | string[] | undefined): ReviewTabId {
  const v = Array.isArray(value) ? value[0] : value;
  return v && TAB_IDS.has(v) ? (v as ReviewTabId) : DEFAULT_REVIEW_TAB;
}

export function reviewTabLabel(tab: ReviewTabId): string {
  return REVIEW_TABS.find((t) => t.id === tab)?.label ?? tab;
}

/**
 * Section ids of the former one-page layout (bookmarks, links in messages) and of the sections
 * inside the tabs. Each id opens the tab that holds it.
 */
export const REVIEW_SECTION_TAB: Readonly<Record<string, ReviewTabId>> = {
  current: "content",
  proposal: "content",
  comparison: "content",
  "claim-risks": "content",
  preview: "content",
  decision: "content",
  "review-items": "verification",
  attention: "verification",
  questions: "verification",
  held: "verification",
  documents: "verification",
  "current-technical": "verification",
  sources: "sources",
  history: "history",
};

/** The tab that holds `#section`, or null for an unknown hash. */
export function reviewTabForHash(hash: string): ReviewTabId | null {
  const id = hash.replace(/^#/, "");
  return REVIEW_SECTION_TAB[id] ?? null;
}

/** The proposal page URL for one tab (the default tab and an absent site are left out). */
export function reviewHref(proposalId: string, site: string | undefined, tab: ReviewTabId): string {
  const q = new URLSearchParams();
  if (site) q.set("site", site);
  if (tab !== DEFAULT_REVIEW_TAB) q.set("tab", tab);
  const s = q.toString();
  return `${COMPANY_REVIEW_PATH}/${proposalId}${s ? `?${s}` : ""}`;
}

// --- list filters ------------------------------------------------------------------------------

export interface ReviewListFilters {
  /** Product name or SKU (code), case-insensitive. */
  q: string;
  /** A category id of the site (includes its sub-categories), or "" for all. */
  category: string;
  /** A proposal status, or "" for all. */
  status: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readReviewFilters(
  params: Record<string, string | string[] | undefined>,
  statuses: readonly string[],
): ReviewListFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const category = one("category");
  const status = one("status");
  return {
    q: one("q").trim().slice(0, 100),
    category: UUID.test(category) ? category.toLowerCase() : "",
    status: statuses.includes(status) ? status : "",
  };
}

/** The list URL with these filters (empty ones left out). */
export function reviewListHref(site: string, f: Partial<ReviewListFilters>): string {
  const q = new URLSearchParams({ site });
  if (f.q) q.set("q", f.q);
  if (f.category) q.set("category", f.category);
  if (f.status) q.set("status", f.status);
  return `${COMPANY_REVIEW_PATH}?${q.toString()}`;
}

/** Case- and accent-insensitive form used by the search. */
function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The proposals matching the search and the category. `inCategory` holds the product ids listed
 * in the chosen category (or one of its sub-categories); null when no category is chosen.
 */
export function filterProposals(
  proposals: readonly ProposalSummary[],
  q: string,
  inCategory: ReadonlySet<string> | null,
): ProposalSummary[] {
  const needle = fold(q.trim());
  return proposals.filter((p) => {
    if (inCategory && !inCategory.has(p.productId)) return false;
    if (!needle) return true;
    return fold(p.productName).includes(needle) || fold(p.productCode).includes(needle);
  });
}

export interface ReviewAttention {
  /** Conflicts, inconsistencies and placeholders. */
  conflicts: number;
  /** Values held under DP-002 or not imported from the current site. */
  held: number;
  /** Questions the company is asked to confirm. */
  questions: number;
  /** Original documents that do not exist yet. */
  missingDocuments: number;
  /** Wording that needs evidence before publication. */
  claimRisks: number;
}

/** Item counts of one proposal, grouped as the list and the tabs show them. */
export function reviewAttention(counts: Partial<Record<ReviewItemKind, number>>): ReviewAttention {
  const n = (k: ReviewItemKind) => counts[k] ?? 0;
  return {
    conflicts: n("CLASS_CONFLICT") + n("INCONSISTENCY") + n("PLACEHOLDER"),
    held: n("DP002_HELD") + n("SITE_VALUE_WITHHELD"),
    questions: n("CONFIRM"),
    missingDocuments: n("MISSING_DOCUMENT"),
    claimRisks: n("CLAIM_RISK"),
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
