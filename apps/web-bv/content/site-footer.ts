/**
 * Shapes and UI strings of the page footer. Its content comes from the CMS fragment
 * `bv.site-footer` (CMS S2, ADR-020); the logo and the labels of the landmarks stay in code.
 *
 * `href: null` marks a page that exists nowhere yet: it renders as plain text, which can't lead to
 * a 404 and needs no script. The Privacy Policy link is dropped where the policy is not published
 * (DP-095).
 */
import { BRAND_LOGO, HOME_HREF } from "@/content/brand";

export type FooterLink = { label: string; href: string | null };
export type FooterColumn = { title: string; links: FooterLink[] };

export const SITE_FOOTER_UI = {
  logo: BRAND_LOGO,
  homeHref: HOME_HREF,
  homeLabel: "back to top of page",
  navLabel: "Footer",
  legalLabel: "Legal",
} as const;

export type SiteFooterContent = {
  headline: string;
  cta: { label: string; href: string };
  logo: { src: string; alt: string; width: number; height: number };
  homeHref: string;
  homeLabel: string;
  intro: string;
  contact: {
    title: string;
    company: string;
    addressLines: string[];
    phone: { label: string; href: string; note: string };
    email: { label: string; href: string; note: string };
  };
  navLabel: string;
  columns: FooterColumn[];
  copyright: string;
  legalLabel: string;
  legal: FooterLink[];
  pendingNote: string;
};
