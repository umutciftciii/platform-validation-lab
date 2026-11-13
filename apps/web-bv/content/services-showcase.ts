/**
 * Shapes and UI strings of the Services showcase. The content comes from the CMS page `bv.home`
 * (CMS S2, ADR-020); sources and rules are in docs/cms/bv-content-sources.md. The images are
 * representative CGI renders and their disclosure is a required CMS field.
 */
export type ServiceImageCrop = {
  src: string;
  width: number;
  height: number;
  /** CSS object-position. Keeps the subject in frame as the card's shape changes. */
  position: string;
};

export type ServiceImage = {
  alt: string;
  /** Full 4:3 render, used from 900 px up. */
  desktop: ServiceImageCrop;
  /** 3:4 crop on the subject, used below 900 px. */
  mobile: ServiceImageCrop;
};

export type ServiceItem = {
  id: string;
  title: string;
  description: string;
  shortDescription: string;
  cta: { label: string; href: string };
  image: ServiceImage;
};

export const SERVICES_UI = {
  listLabel: "Services",
  controlsLabel: "Scroll services",
  previous: "Previous services",
  next: "Next services",
} as const;

export type ServicesCopy = typeof SERVICES_UI & {
  eyebrow: string;
  title: string;
  intro: string;
  disclosure: string;
};
