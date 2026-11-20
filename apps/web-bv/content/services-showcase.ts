import { dictionary } from "@/lib/i18n";

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

/** ML-6: the list and scroll controls in the page's language (lib/i18n). */
export function servicesUi(locale: string) {
  return { ...dictionary(locale).home.services };
}

export type ServicesCopy = ReturnType<typeof servicesUi> & {
  eyebrow: string;
  title: string;
  intro: string;
  disclosure: string;
};
