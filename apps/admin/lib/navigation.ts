import { en } from "./i18n/messages/en";

/**
 * Console navigation model. Ready modules have their own routes (overview, products since PM-1, content since CMS S1);
 * the others are not built yet and render an empty state that says so. Showing an item here grants nothing: every action is
 * authorised by the API (RBAC, F1-001/F1-002), not by the presence of a link.
 *
 * ML-11: labels and summaries are dictionary messages (`nav.items.<id>`, `nav.groups.<id>`); the
 * `label`/`summary` fields keep the English text for code that is not language-aware.
 */
export type IconName =
  | "overview"
  | "content"
  | "products"
  | "search"
  | "inbox"
  | "sites"
  | "staff"
  | "shield"
  | "audit"
  | "settings";

export type NavItemId = keyof typeof en.nav.items;
export type NavGroupId = keyof typeof en.nav.groups;

export interface NavItem {
  id: NavItemId;
  slug: string;
  href: string;
  label: string;
  icon: IconName;
  /** One line for the module's empty state. */
  summary: string;
  ready: boolean;
  /** DP-110: shown only to the system owner (the API answers 404 to anyone else anyway). */
  ownerOnly?: boolean;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "workspace",
    label: en.nav.groups.workspace,
    items: [
      {
        id: "overview",
        slug: "",
        href: "/",
        label: en.nav.items.overview.label,
        icon: "overview",
        summary: en.nav.items.overview.summary,
        ready: true,
      },
      {
        id: "content",
        slug: "content",
        href: "/content",
        label: en.nav.items.content.label,
        icon: "content",
        summary: en.nav.items.content.summary,
        ready: true,
      },
      {
        id: "products",
        slug: "products",
        href: "/products",
        label: en.nav.items.products.label,
        icon: "products",
        summary: en.nav.items.products.summary,
        ready: true,
      },
      {
        // DP-209: site SEO defaults and the SEO state of every page, article and product.
        id: "seo",
        slug: "seo",
        href: "/seo",
        label: en.nav.items.seo.label,
        icon: "search",
        summary: en.nav.items.seo.summary,
        ready: true,
      },
      {
        // DP-172 (ADR-022): proposed product texts for the company's approval.
        id: "companyReview",
        slug: "company-review",
        href: "/company-review",
        label: en.nav.items.companyReview.label,
        icon: "inbox",
        summary: en.nav.items.companyReview.summary,
        ready: true,
      },
      {
        id: "leads",
        slug: "leads",
        href: "/leads",
        label: en.nav.items.leads.label,
        icon: "inbox",
        summary: en.nav.items.leads.summary,
        ready: true,
      },
      {
        id: "sites",
        slug: "sites",
        href: "/sites",
        label: en.nav.items.sites.label,
        icon: "sites",
        summary: en.nav.items.sites.summary,
        ready: false,
      },
    ],
  },
  {
    id: "administration",
    label: en.nav.groups.administration,
    items: [
      {
        id: "staff",
        slug: "staff",
        href: "/staff",
        label: en.nav.items.staff.label,
        icon: "staff",
        summary: en.nav.items.staff.summary,
        ready: true,
      },
      {
        id: "audit",
        slug: "audit",
        href: "/audit",
        label: en.nav.items.audit.label,
        icon: "audit",
        summary: en.nav.items.audit.summary,
        ready: false,
      },
      {
        id: "settings",
        slug: "settings",
        href: "/settings",
        label: en.nav.items.settings.label,
        icon: "settings",
        summary: en.nav.items.settings.summary,
        ready: false,
      },
    ],
  },
  {
    // DP-110 (ADR-018): God Mode of the system owner.
    id: "owner",
    label: en.nav.groups.owner,
    items: [
      {
        id: "owner",
        slug: "owner",
        href: "/owner",
        label: en.nav.items.owner.label,
        icon: "shield",
        summary: en.nav.items.owner.summary,
        ready: true,
        ownerOnly: true,
      },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * The navigation a viewer sees: owner-only items (and empty groups) are left out for staff. A
 * review-only user (DP-172: the company reviewer) sees the company review only.
 */
export function navGroupsFor(isOwner: boolean, reviewOnly = false): readonly NavGroup[] {
  if (reviewOnly) {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.slug === "company-review"),
    })).filter((g) => g.items.length > 0);
  }
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isOwner || !i.ownerOnly),
  })).filter((g) => g.items.length > 0);
}

export function findSection(slug: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.slug === slug && item.slug !== "");
}

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
