/**
 * Shapes the ICCSYN hero renders. The content comes from the CMS page `bv.home` (CMS S2,
 * ADR-020); sources and claim rules are in docs/cms/bv-content-sources.md.
 */
export type IccsynApplication = {
  title: string;
  description: string;
  image: { src: string };
};

export type IccsynHeroCopy = {
  brand: string;
  tagline: string;
  scrollCue: string;
  cta: string;
  /** Null: the button is shown disabled with `ctaDisabledNote`. */
  ctaHref: string | null;
  ctaDisabledNote: string;
  supply: string;
  legal: string;
  mediaAlt: string;
};

export type IccsynHeroContent = { copy: IccsynHeroCopy; applications: IccsynApplication[] };
