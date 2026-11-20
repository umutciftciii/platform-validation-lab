import { dictionary } from "@/lib/i18n";

/**
 * Shapes and UI strings of the CTL Technology section. The content comes from the CMS page
 * `bv.home` (CMS S2, ADR-020); sources and rules are in docs/cms/bv-content-sources.md. The
 * animation holds exactly three stages.
 */
export type CtlImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** CSS object-position, for the wide frame from 900 px up. */
  positionDesktop: string;
  /** CSS object-position, for the narrower frame below that. */
  positionMobile: string;
};

export type CtlStage = {
  id: string;
  title: string;
  description: string;
  disclosure: string;
  image: CtlImage;
};

/** ML-6: the stage labels and skip link in the page's language (lib/i18n). */
export function ctlUi(locale: string) {
  return { ...dictionary(locale).home.ctl };
}

export type CtlCopy = ReturnType<typeof ctlUi> & {
  eyebrow: string;
  title: string;
  document: { label: string; href: string };
};
