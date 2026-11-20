import { dictionary } from "@/lib/i18n";

/**
 * Shapes and UI strings of the Applications section. The content comes from the CMS page
 * `bv.home` (CMS S2, ADR-020); the claim rules (AI concepts only, status and disclosures always
 * visible) are in docs/cms/bv-content-sources.md. The animation holds exactly three scenes.
 */
export type ApplicationLink = { label: string; href: string };

export type ApplicationImage = {
  /** 1448 px wide: the full-bleed desktop scene. */
  src: string;
  /** 828 px wide: what phones download. */
  srcSmall: string;
  width: number;
  height: number;
  alt: string;
  /** CSS object-position, for the wide frame from 900 px up. */
  positionDesktop: string;
};

export type ApplicationScene = {
  id: string;
  title: string;
  description: string;
  disclosure: string;
  cta: ApplicationLink;
  image: ApplicationImage;
};

/** ML-6: the scene labels and skip link in the page's language (lib/i18n). */
export function applicationsUi(locale: string) {
  return { ...dictionary(locale).home.applications };
}

export type ApplicationsCopy = ReturnType<typeof applicationsUi> & {
  eyebrow: string;
  title: string;
  status: string;
  intro: string;
  validation: {
    title: string;
    intro: string;
    requirements: string[];
    note: string;
    cta: ApplicationLink;
  };
};
