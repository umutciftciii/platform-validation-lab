/**
 * Top navigation copy and destinations for the prototype.
 *
 * `href: null` marks a page that does not exist yet. The link stays visible and
 * reachable by keyboard but never navigates, so a reviewer cannot land on a 404.
 * Give it a route here when the page is ready; nothing else has to change.
 */

export type SiteNavItem = {
  label: string;
  href: string | null;
  /** True for the page this prototype is showing. */
  current?: boolean;
};

export const SITE_NAV = {
  logo: {
    src: "/media/brand/dream-petroleum-logo.svg",
    alt: "Dream Petroleum BV, Energy in Motion",
    width: 871,
    height: 240,
  },
  homeHref: "#top",
  items: [
    { label: "Home", href: "#top", current: true },
    { label: "Products", href: "/products" },
    { label: "Services", href: null },
    { label: "Company", href: null },
    { label: "Blogs", href: null },
    { label: "Contact Us", href: null },
  ] satisfies SiteNavItem[],
  contact: { label: "Contact", href: null } satisfies SiteNavItem,
  /**
   * Shown on phones and tablets only when JavaScript is off. Pending pages can't react
   * to a tap without script, so this list holds real destinations only: the sections
   * of the demo page. Add a page here once its `href` above is set.
   */
  noScriptLinks: [
    { label: "Home", href: "#top", current: true },
    { label: "Products", href: "/demo/iccsyn-hero-products#product-groups" },
    { label: "Services", href: "/demo/iccsyn-hero-products#services" },
    { label: "CTL Technology", href: "/demo/iccsyn-hero-products#ctl-technology" },
    { label: "Applications", href: "/demo/iccsyn-hero-products#applications" },
  ] satisfies (SiteNavItem & { href: string })[],
  pendingNote: "This page isn't ready yet.",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  mainLabel: "Main",
  menuLabel: "Site menu",
} as const;
