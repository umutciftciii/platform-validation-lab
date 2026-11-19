/**
 * Console navigation model. Ready modules have their own routes (overview, products since PM-1, content since CMS S1);
 * the others are not built yet and render an empty state that says so. Showing an item here grants nothing: every action is
 * authorised by the API (RBAC, F1-001/F1-002), not by the presence of a link.
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

export interface NavItem {
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
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        slug: "",
        href: "/",
        label: "Overview",
        icon: "overview",
        summary: "Activity and status across both sites.",
        ready: true,
      },
      {
        slug: "content",
        href: "/content",
        label: "Content",
        icon: "content",
        summary: "Write, review and publish pages for both sites.",
        ready: true,
      },
      {
        slug: "products",
        href: "/products",
        label: "Products",
        icon: "products",
        summary: "Keep product data sheets and specifications current.",
        ready: true,
      },
      {
        // DP-209: site SEO defaults and the SEO state of every page, article and product.
        slug: "seo",
        href: "/seo",
        label: "SEO",
        icon: "search",
        summary: "Search results and link previews of the BV site.",
        ready: true,
      },
      {
        // DP-172 (ADR-022): proposed product texts for the company's approval.
        slug: "company-review",
        href: "/company-review",
        label: "Company review",
        icon: "inbox",
        summary: "Proposed product texts for the company's approval.",
        ready: true,
      },
      {
        slug: "leads",
        href: "/leads",
        label: "Leads",
        icon: "inbox",
        summary:
          "Contact-form messages and document requests from the public sites (customer data, audited).",
        ready: true,
      },
      {
        slug: "sites",
        href: "/sites",
        label: "Sites",
        icon: "sites",
        summary: "Domains, navigation and publishing for each site.",
        ready: false,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        slug: "staff",
        href: "/staff",
        label: "Staff and access",
        icon: "staff",
        summary: "Invite staff and give or remove roles, lead access included.",
        ready: true,
      },
      {
        slug: "audit",
        href: "/audit",
        label: "Audit log",
        icon: "audit",
        summary: "Every sign-in, permission change and publication, in order.",
        ready: false,
      },
      {
        slug: "settings",
        href: "/settings",
        label: "Settings",
        icon: "settings",
        summary: "Your profile, sessions and authenticator.",
        ready: false,
      },
    ],
  },
  {
    // DP-110 (ADR-018): God Mode of the system owner.
    label: "Owner",
    items: [
      {
        slug: "owner",
        href: "/owner",
        label: "Owner console",
        icon: "shield",
        summary: "Module switches and the protected audit trail (system owner only).",
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
