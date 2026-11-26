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
  | "settings"
  | "translate"
  | "ai";

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
  /**
   * DP-287: shown only while the session's feature is on (`features.aiCenter`: AI switched on by
   * the system owner and readable by the user). The API answers 404 anyway while AI is off.
   */
  feature?: keyof NavFeatures;
}

/** DP-287: the session's feature flags the navigation depends on (StaffSessionResponse). */
export interface NavFeatures {
  aiCenter?: boolean;
  /**
   * DP-298 (ADR-031): the user may read the legal texts (holds legal_text:edit or
   * legal_text:publish). Presentation only: the API answers 403 on every legal-text route anyway.
   */
  legalTexts?: boolean;
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
        // DP-298 (ADR-031): versioned legal and consent texts; shown only with legal_text:edit
        // or legal_text:publish (`features.legalTexts`, decided by the console layout).
        id: "legalTexts",
        slug: "legal-texts",
        href: "/legal-texts",
        label: en.nav.items.legalTexts.label,
        icon: "shield",
        summary: en.nav.items.legalTexts.summary,
        ready: true,
        feature: "legalTexts",
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
        // ML-13b (DP-244): translation packages — export, dry run, import as drafts.
        id: "translations",
        slug: "translations",
        href: "/translations",
        label: en.nav.items.translations.label,
        icon: "translate",
        summary: en.nav.items.translations.summary,
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
        // DP-287 (ADR-030): hidden unless AI is on and the user may read the AI Center.
        id: "ai",
        slug: "ai",
        href: "/ai",
        label: en.nav.items.ai.label,
        icon: "ai",
        summary: en.nav.items.ai.summary,
        ready: true,
        feature: "aiCenter",
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
 * review-only user (DP-172: the company reviewer) sees the company review only. DP-287: an item of
 * a feature (the AI Center; DP-298: the legal texts) only while the session's feature is on.
 */
export function navGroupsFor(
  isOwner: boolean,
  reviewOnly = false,
  features: NavFeatures = {},
): readonly NavGroup[] {
  if (reviewOnly) {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.slug === "company-review"),
    })).filter((g) => g.items.length > 0);
  }
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) => (isOwner || !i.ownerOnly) && (!i.feature || features[i.feature] === true),
    ),
  })).filter((g) => g.items.length > 0);
}

export function findSection(slug: string): NavItem | undefined {
  // DP-287: a feature's item has its own route; the placeholder section never names it.
  return NAV_ITEMS.find((item) => item.slug === slug && item.slug !== "" && !item.feature);
}

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
