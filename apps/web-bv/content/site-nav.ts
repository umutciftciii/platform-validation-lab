/**
 * Shapes and UI strings of the top navigation. Items and links come from the CMS fragment
 * `bv.site-nav` (CMS S2, ADR-020); the logo and the labels of the controls stay in code.
 *
 * DP-219: items may have one level of submenu and open in a new tab; hidden items never reach the
 * site (the API drops them), and content references arrive as the current address.
 *
 * `href: null` marks a page that does not exist yet. The link stays visible and reachable by
 * keyboard but never navigates, so a visitor cannot land on a 404.
 */
import { BRAND_LOGO, HOME_HREF } from "@/content/brand";

export type SiteNavItem = {
  label: string;
  href: string | null;
  /** True for the page being shown (on an item with a submenu: or one of its links). */
  current?: boolean;
  /** DP-219: opens in a new tab (target=_blank, rel=noopener noreferrer). */
  newTab?: boolean;
  /** DP-219: the submenu, one level. */
  children?: SiteNavItem[];
};

export const SITE_NAV_UI = {
  logo: BRAND_LOGO,
  homeHref: HOME_HREF,
  openMenu: "Open menu",
  closeMenu: "Close menu",
  mainLabel: "Main",
  menuLabel: "Site menu",
  /** DP-219: the button that opens a submenu ("Show submenu of Products"). */
  openSubmenu: "Show submenu of",
  newTab: "(opens in a new tab)",
} as const;

export type SiteNavContent = Omit<typeof SITE_NAV_UI, "homeHref"> & {
  /** "#top" on the home page; "/" on every other page. */
  homeHref: string;
  items: SiteNavItem[];
  /** null when the contact button is switched off in the CMS (DP-219). */
  contact: SiteNavItem | null;
  /** Shown on phones and tablets only when JavaScript is off: real destinations only. */
  noScriptLinks: (SiteNavItem & { href: string })[];
  pendingNote: string;
};
