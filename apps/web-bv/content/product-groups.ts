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

export const PRODUCT_GROUPS_UI = {
  previous: "Previous product group",
  next: "Next product group",
  pause: "Pause automatic rotation",
  play: "Start automatic rotation",
  slideRole: "slide",
  carouselRole: "carousel",
} as const;

export type ProductGroupsCopy = typeof PRODUCT_GROUPS_UI & { label: string; disclosure: string };

export const AUTO_ADVANCE_MS = 7000;
