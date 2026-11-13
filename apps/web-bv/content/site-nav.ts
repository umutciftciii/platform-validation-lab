/**
 * Shapes and UI strings of the top navigation. Items and links come from the CMS fragment
 * `bv.site-nav` (CMS S2, ADR-020); the logo and the labels of the controls stay in code.
 *
 * `href: null` marks a page that does not exist yet. The link stays visible and reachable by
 * keyboard but never navigates, so a visitor cannot land on a 404.
 */
import { BRAND_LOGO, HOME_HREF } from "@/content/brand";

export type SiteNavItem = {
  label: string;
  href: string | null;
  /** True for the page being shown. */
  current?: boolean;
};

export const SITE_NAV_UI = {
  logo: BRAND_LOGO,
  homeHref: HOME_HREF,
  openMenu: "Open menu",
  closeMenu: "Close menu",
  mainLabel: "Main",
  menuLabel: "Site menu",
} as const;

export type SiteNavContent = typeof SITE_NAV_UI & {
  items: SiteNavItem[];
  contact: SiteNavItem;
  /** Shown on phones and tablets only when JavaScript is off: real destinations only. */
  noScriptLinks: (SiteNavItem & { href: string })[];
  pendingNote: string;
};
