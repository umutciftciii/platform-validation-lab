import { dictionary } from "@/lib/i18n";

/**
 * Shapes and UI strings of the Product Groups showcase. The content comes from the CMS page
 * `bv.home` (CMS S2, ADR-020); sources and claim rules are in docs/cms/bv-content-sources.md.
 * Controls and their labels stay in code (ADR-020 D3).
 */
export type ProductGroupMedia =
  | { kind: "gif"; src: string; poster: string }
  | { kind: "video"; webm?: string; mp4: string; poster: string };

export type ProductGroup = {
  id: string;
  /** Word and numeral are separate because the numeral has its own colour. */
  name: { word: string; numeral: string };
  eyebrow: string;
  description: string;
  /** Shown next to the description when the claim needs a qualifier. */
  note?: string;
  samples: string;
  cta: { label: string; href: string };
  media: ProductGroupMedia;
  mediaAlt: string;
};

/** ML-6: the carousel controls in the page's language (lib/i18n). */
export function productGroupsUi(locale: string) {
  return { ...dictionary(locale).home.productGroups };
}

export type ProductGroupsCopy = ReturnType<typeof productGroupsUi> & { label: string; disclosure: string };

export const AUTO_ADVANCE_MS = 7000;
