/**
 * DP-172 (ADR-022): view model of the company review. Pure functions, shared by the server pages
 * and their tests: how proposal states and review items are labelled and grouped, how current
 * specification values are written, and which console paths a review-only user may open.
 *
 * The grouping keeps three things apart on purpose:
 *  - current site data (the product as it is: name, category, specification values, images,
 *    documents), shown as "From current site";
 *  - the research proposal (customer text only), shown as "Research proposal — not published";
 *  - review items (questions, conflicts, claim risks, missing documents) and the values held under
 *    DP-002 or withheld at import, which are NEVER product specifications.
 */
import type {
  ProposalStatus,
  ReviewItem,
  ReviewItemKind,
  ReviewSource,
  SpecValueData,
} from "@dream/contracts";
import type { PillTone } from "../components/ui";

export const COMPANY_REVIEW_PATH = "/company-review";

export const STATUS_META: Readonly<
  Record<ProposalStatus, { label: string; tone: PillTone; hint: string }>
> = {
  REVIEW_PENDING: {
    label: "Review pending",
    tone: "amber",
    hint: "Waiting for the company's decision.",
  },
  CHANGES_REQUESTED: {
    label: "Changes requested",
    tone: "danger",
    hint: "The company asked for changes; the editor revises the proposal.",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    hint: "Approved by the company. Not published and not a technical approval.",
  },
};

export const KIND_META: Readonly<Record<ReviewItemKind, { label: string; tone: PillTone }>> = {
  CONFIRM: { label: "Question to confirm", tone: "petrol" },
  INCONSISTENCY: { label: "Inconsistency", tone: "danger" },
  DP002_HELD: { label: "Held for verification (DP-002)", tone: "amber" },
  SITE_VALUE_WITHHELD: { label: "Not imported from current site", tone: "neutral" },
  CLASS_CONFLICT: { label: "Classification conflict", tone: "danger" },
  CLAIM_RISK: { label: "Claim risk", tone: "amber" },
  MISSING_DOCUMENT: { label: "Missing document", tone: "neutral" },
  PLACEHOLDER: { label: "Placeholder product", tone: "neutral" },
};

/** Review sections in display order, each with the kinds it holds. */
export const REVIEW_SECTIONS: readonly {
  id: string;
  title: string;
  description: string;
  kinds: readonly ReviewItemKind[];
}[] = [
  {
    id: "attention",
    title: "Conflicts and placeholders",
    description:
      "Points where the current data, its class label or the product itself is in doubt.",
    kinds: ["PLACEHOLDER", "CLASS_CONFLICT", "INCONSISTENCY"],
  },
  {
    id: "claims",
    title: "Claim risks",
    description: "Wording that needs a certificate or other evidence before it can be published.",
    kinds: ["CLAIM_RISK"],
  },
  {
    id: "questions",
    title: "Questions to confirm",
    description: "Please confirm or correct these points in your comment.",
    kinds: ["CONFIRM"],
  },
  {
    id: "documents",
    title: "Missing documents",
    description: "Original documents that do not exist in the catalogue yet.",
    kinds: ["MISSING_DOCUMENT"],
  },
];

/** Kinds shown in the separate "held and withheld values" block, never as product data. */
export const HELD_KINDS: readonly ReviewItemKind[] = ["DP002_HELD", "SITE_VALUE_WITHHELD"];

export function itemsOf(items: readonly ReviewItem[], kinds: readonly ReviewItemKind[]) {
  return items.filter((i) => kinds.includes(i.kind));
}

/** Total of the attention-worthy kinds, for list badges. */
export function attentionCount(counts: Partial<Record<ReviewItemKind, number>>): number {
  return (counts.CLASS_CONFLICT ?? 0) + (counts.INCONSISTENCY ?? 0) + (counts.PLACEHOLDER ?? 0);
}

export const SOURCE_LEVEL_TEXT: Readonly<Record<string, string>> = {
  A: "A · manufacturer's own document",
  B: "B · standard or regulation",
  C: "C · other producer (plausibility only)",
  D: "D · site-generated summary (not original)",
  E: "E · trader or marketplace (not evidence)",
};

export function sourcesFor(item: ReviewItem, sources: readonly ReviewSource[]): ReviewSource[] {
  return item.sourceIds
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is ReviewSource => s !== undefined);
}

/** "spec:viscosity_index" -> "viscosity index"; other fields as written. */
export function fieldLabel(field: string | null): string | null {
  if (!field) return null;
  if (field.startsWith("spec:")) return field.slice(5).replace(/_/g, " ");
  return field;
}

const PLAIN = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 });

/** A current specification value as the catalogue shows it ("≥ 200 °C", "3.8 to < 4.5 mm²/s"). */
export function formatSpecValue(value: SpecValueData, unit: string | null): string {
  const u = unit ? ` ${unit}` : "";
  switch (value.type) {
    case "NUMBER":
      return `${PLAIN.format(value.number)}${u}`;
    case "RANGE": {
      const lo = value.min === null ? null : PLAIN.format(value.min);
      const hi = value.max === null ? null : PLAIN.format(value.max);
      if (lo !== null && hi !== null) {
        if (value.min === value.max) return `${lo}${u}`;
        return `${value.minExclusive ? `> ${lo}` : lo} to ${value.maxExclusive ? `< ${hi}` : hi}${u}`;
      }
      if (lo !== null) return `${value.minExclusive ? ">" : "≥"} ${lo}${u}`;
      return `${value.maxExclusive ? "<" : "≤"} ${hi ?? ""}${u}`;
    }
    case "TEXT":
      return value.text;
    case "BOOLEAN":
      return value.boolean ? "Yes" : "No";
  }
}

/**
 * Console paths a review-only user (company reviewer) may open; anything else is sent to the
 * company review. Only presentation: the API refuses every other module for this role anyway.
 */
export function reviewOnlyAllows(pathname: string): boolean {
  return pathname === COMPANY_REVIEW_PATH || pathname.startsWith(`${COMPANY_REVIEW_PATH}/`);
}
