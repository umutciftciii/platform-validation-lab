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

export const APPLICATIONS_UI = {
  skip: "Skip the application concepts animation",
  scenesLabel: "Application concepts",
  sceneNavLabel: "Go to an application concept",
} as const;

export type ApplicationsCopy = typeof APPLICATIONS_UI & {
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
