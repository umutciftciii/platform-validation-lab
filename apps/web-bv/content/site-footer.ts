/**
 * Shapes and UI strings of the page footer. Its content comes from the CMS fragment
 * `bv.site-footer` (CMS S2, ADR-020); the logo and the labels of the landmarks stay in code.
 *
 * DP-219: columns and links may be hidden in the CMS (the API drops them), links may open in a new
 * tab, and social media links are listed under the contact details.
 *
 * `href: null` marks a page that exists nowhere yet: it renders as plain text, which can't lead to
 * a 404 and needs no script. The Privacy Policy link is dropped where the policy is not published
 * (DP-095).
 */
import { BRAND_LOGO, HOME_HREF } from "@/content/brand";

export type FooterLink = { label: string; href: string | null; newTab?: boolean };
export type FooterColumn = { title: string; links: FooterLink[] };

export const SITE_FOOTER_UI = {
  logo: BRAND_LOGO,
  homeHref: HOME_HREF,
  homeLabel: "back to top of page",
  navLabel: "Footer",
  legalLabel: "Legal",
  socialLabel: "Social media",
  newTab: "(opens in a new tab)",
} as const;

export type SiteFooterContent = {
  headline: string;
  /** href null only while the button's page is not live: shown as text (DP-219). */
  cta: FooterLink;
  logo: { src: string; alt: string; width: number; height: number };
  homeHref: string;
  homeLabel: string;
  intro: string;
  contact: {
    title: string;
    company: string;
    addressLines: string[];
    /** `visible: false`: not shown in the footer (DP-219); the contact page still shows it. */
    phone: { label: string; href: string; note: string; visible: boolean };
    email: { label: string; href: string; note: string; visible: boolean };
  };
  /** DP-219: shown under the contact details; empty: nothing is shown. */
  social: { label: string; href: string }[];
  socialLabel: string;
  newTab: string;
  navLabel: string;
  columns: FooterColumn[];
  copyright: string;
  legalLabel: string;
  legal: FooterLink[];
  pendingNote: string;
};
