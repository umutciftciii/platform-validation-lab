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
import { SOURCE_LEVELS } from "@dream/contracts";
import type {
  ProposalResponse,
  ProposalStatus,
  ReviewItem,
  ReviewItemKind,
  ReviewSource,
  SpecValueData,
} from "@dream/contracts";
import type { PillTone } from "../components/ui";
import type { AdminLocale } from "./i18n/config";
import { INTL_LOCALE } from "./i18n/config";
import type { Translate } from "./i18n/types";

export const COMPANY_REVIEW_PATH = "/company-review";

/**
 * ML-12b: the tone of each proposal state; its label and hint are in the dictionary
 * (`companyReview.status` / `companyReview.statusHint`), keyed by the API's enum value.
 */
export const STATUS_TONE: Readonly<Record<ProposalStatus, PillTone>> = {
  REVIEW_PENDING: "amber",
  CHANGES_REQUESTED: "danger",
  APPROVED: "success",
};

export function statusLabel(status: ProposalStatus, t: Translate): string {
  return t(`companyReview.status.${status}`);
}

export function statusHint(status: ProposalStatus, t: Translate): string {
  return t(`companyReview.statusHint.${status}`);
}

/**
 * Why the signed-in user cannot approve or request changes, in plain words (DP-189). Only
 * explains the API's `decisionBlocked`; the API still decides every request. An unknown or
 * missing reason gets the general text.
 */
export function decisionBlockedText(
  reason: ProposalResponse["decisionBlocked"],
  t: Translate,
): {
  title: string;
  body: string;
} {
  const key =
    reason === "no_permission" || reason === "not_in_review" || reason === "own_change"
      ? reason
      : "unknown";
  return {
    title: t(`companyReview.blocked.${key}.title`),
    body: t(`companyReview.blocked.${key}.body`),
  };
}

/** The tone of each review item kind; its label is `companyReview.kind.<KIND>`. */
export const KIND_TONE: Readonly<Record<ReviewItemKind, PillTone>> = {
  CONFIRM: "petrol",
  INCONSISTENCY: "danger",
  DP002_HELD: "amber",
  SITE_VALUE_WITHHELD: "neutral",
  CLASS_CONFLICT: "danger",
  CLAIM_RISK: "amber",
  MISSING_DOCUMENT: "neutral",
  PLACEHOLDER: "neutral",
};

export function kindLabel(kind: ReviewItemKind, t: Translate): string {
  return t(`companyReview.kind.${kind}`);
}

export type ReviewSectionId = "attention" | "claims" | "questions" | "documents";

/**
 * Review sections in display order, each with the kinds it holds. Title and description are
 * `companyReview.section.<id>` (see `sectionText`).
 */
export const REVIEW_SECTIONS: readonly {
  id: ReviewSectionId;
  kinds: readonly ReviewItemKind[];
}[] = [
  { id: "attention", kinds: ["PLACEHOLDER", "CLASS_CONFLICT", "INCONSISTENCY"] },
  { id: "claims", kinds: ["CLAIM_RISK"] },
  { id: "questions", kinds: ["CONFIRM"] },
  { id: "documents", kinds: ["MISSING_DOCUMENT"] },
];

export function sectionText(
  id: ReviewSectionId,
  t: Translate,
): { title: string; description: string } {
  return {
    title: t(`companyReview.section.${id}.title`),
    description: t(`companyReview.section.${id}.description`),
  };
}

/** Kinds shown in the separate "held and withheld values" block, never as product data. */
export const HELD_KINDS: readonly ReviewItemKind[] = ["DP002_HELD", "SITE_VALUE_WITHHELD"];

export function itemsOf(items: readonly ReviewItem[], kinds: readonly ReviewItemKind[]) {
  return items.filter((i) => kinds.includes(i.kind));
}

/** Total of the attention-worthy kinds, for list badges. */
export function attentionCount(counts: Partial<Record<ReviewItemKind, number>>): number {
  return (counts.CLASS_CONFLICT ?? 0) + (counts.INCONSISTENCY ?? 0) + (counts.PLACEHOLDER ?? 0);
}

/** The text of a research source level ("A · manufacturer's own document"); undefined if unknown. */
export function sourceLevelText(level: string, t: Translate): string | undefined {
  return (SOURCE_LEVELS as readonly string[]).includes(level)
    ? t(`companyReview.sourceLevel.${level as (typeof SOURCE_LEVELS)[number]}`)
    : undefined;
}

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

const plainFormats = new Map<AdminLocale, Intl.NumberFormat>();

/** Numbers as the catalogue writes them, in the console language (English: en-GB, as before). */
function plain(locale: AdminLocale): Intl.NumberFormat {
  let f = plainFormats.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 6 });
    plainFormats.set(locale, f);
  }
  return f;
}

/**
 * A current specification value as the catalogue shows it ("≥ 200 °C", "3.8 to < 4.5 mm²/s").
 * The unit, the comparison signs and text values are data and stay as they are.
 */
export function formatSpecValue(
  value: SpecValueData,
  unit: string | null,
  t: Translate,
  locale: AdminLocale,
): string {
  const PLAIN = plain(locale);
  const u = unit ? ` ${unit}` : "";
  switch (value.type) {
    case "NUMBER":
      return `${PLAIN.format(value.number)}${u}`;
    case "RANGE": {
      const lo = value.min === null ? null : PLAIN.format(value.min);
      const hi = value.max === null ? null : PLAIN.format(value.max);
      if (lo !== null && hi !== null) {
        if (value.min === value.max) return `${lo}${u}`;
        const from = value.minExclusive ? `> ${lo}` : lo;
        const to = value.maxExclusive ? `< ${hi}` : hi;
        return `${t("companyReview.spec.range", { from, to })}${u}`;
      }
      if (lo !== null) return `${value.minExclusive ? ">" : "≥"} ${lo}${u}`;
      return `${value.maxExclusive ? "<" : "≤"} ${hi ?? ""}${u}`;
    }
    case "TEXT":
      return value.text;
    case "BOOLEAN":
      return value.boolean ? t("companyReview.spec.yes") : t("companyReview.spec.no");
  }
}

/**
 * Console paths a review-only user (company reviewer) may open; anything else is sent to the
 * company review. Only presentation: the API refuses every other module for this role anyway.
 */
export function reviewOnlyAllows(pathname: string): boolean {
  return pathname === COMPANY_REVIEW_PATH || pathname.startsWith(`${COMPANY_REVIEW_PATH}/`);
}
