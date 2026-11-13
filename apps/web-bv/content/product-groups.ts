/**
 * Product Groups showcase content. CMS integration is a later phase.
 *
 * Product names come from the live catalogue categories in `catalogueHref`.
 * Process definitions and ICCSYN claims come from "ICCSYN CTL Base Oils - Technology
 * Overview", slides 7, 8 and 11. Do not add a grade or a claim without a source.
 *
 * Only Group III and Group III+ products are named ICCSYN in the catalogue. Do not
 * put the ICCSYN name on Group I or Group II.
 */

/**
 * To replace a temporary animation, change one `media` object to `kind: "video"`.
 * Nothing in the component has to change. UI text and controls stay in code.
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

const CATALOGUE = "https://dreampetroleumbv.com/en/products?category=";
const TEMP_MEDIA = "/media/iccsyn-groups/temp";

export const PRODUCT_GROUPS_COPY = {
  label: "Product groups",
  disclosure:
    "Temporary low-resolution animation. Representative only: colour and clarity must be confirmed with a product sample.",
  previous: "Previous product group",
  next: "Next product group",
  pause: "Pause automatic rotation",
  play: "Start automatic rotation",
  slideRole: "slide",
  carouselRole: "carousel",
} as const;

export const AUTO_ADVANCE_MS = 7000;

export const PRODUCT_GROUPS: ProductGroup[] = [
  {
    id: "group-1",
    name: { word: "Group", numeral: "I" },
    eyebrow: "Base oils",
    description:
      "Solvent-refined base oils in eight catalogue grades, from SN 150 to Bright Stock.",
    samples: "SN 150 / SN 500 / Bright Stock",
    cta: { label: "Explore Group I", href: `${CATALOGUE}base-oil-group-i` },
    media: {
      kind: "gif",
      src: `${TEMP_MEDIA}/group-1-loop.gif`,
      poster: `${TEMP_MEDIA}/group-1-poster.webp`,
    },
    mediaAlt: "Representative animation of oil running over an engine camshaft.",
  },
  {
    id: "group-2",
    name: { word: "Group", numeral: "II" },
    eyebrow: "Base oils",
    description:
      "Hydrotreated base oils in eleven catalogue grades, from 70N to 600N, plus 90BS and HVI 4, 6 and 8.",
    samples: "100N / 150N / 500N",
    cta: { label: "Explore Group II", href: `${CATALOGUE}base-oil-group-ii` },
    media: {
      kind: "gif",
      src: `${TEMP_MEDIA}/group-2-loop.gif`,
      poster: `${TEMP_MEDIA}/group-2-poster.webp`,
    },
    mediaAlt: "Representative animation of oil moving through a hydraulic sight glass.",
  },
  {
    id: "group-3",
    name: { word: "Group", numeral: "III" },
    eyebrow: "ICCSYN CTL base oils",
    description:
      "Four ICCSYN grades in the Group III range. Technical data and sample reports are listed where available.",
    samples: "ICCSYN 2 / 4 / 6 / 8",
    cta: { label: "Explore Group III", href: `${CATALOGUE}base-oil-group-iii` },
    media: {
      kind: "gif",
      src: `${TEMP_MEDIA}/group-3-loop.gif`,
      poster: `${TEMP_MEDIA}/group-3-poster.webp`,
    },
    mediaAlt: "Representative animation of a clear fluid flowing over gear teeth.",
  },
  {
    id: "group-3-plus",
    name: { word: "Group", numeral: "III+" },
    eyebrow: "ICCSYN CTL base oils",
    description:
      "ICCSYN 6 and 10 combine a high viscosity index with low volatility, for automotive and industrial lubricant formulations.",
    // Required by the brief and by slide 7 of the technology overview.
    note: "Group III+ is a commercial classification in our catalogue, not a separate API group.",
    samples: "ICCSYN 6 / 10",
    cta: { label: "Explore Group III+", href: `${CATALOGUE}base-oil-group-iii-plus` },
    media: {
      kind: "gif",
      src: `${TEMP_MEDIA}/group-3-plus-loop.gif`,
      poster: `${TEMP_MEDIA}/group-3-plus-poster.webp`,
    },
    mediaAlt: "Representative animation of a clear fluid flowing across turbine blades.",
  },
];
