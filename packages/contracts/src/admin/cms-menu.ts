/**
 * DP-219: the menus of the BV site (header `bv.site-nav`, footer `bv.site-footer`) as admin-managed
 * content. No second menu system: both stay CMS fragments with the existing draft, preview,
 * publication, revision, restore and audit flow (ADR-020); this module only gives their content a
 * richer schema (content schema version 2).
 *
 * - A link has a label, a target, "open in a new tab" and a visibility switch.
 * - Targets are content references wherever possible: a CMS page, a product or a product category
 *   is stored by its id, never by its address, so a slug change (DP-210) shows on the menus at once
 *   without a new redirect. Site routes and in-page anchors ("/products", "/#services", "#top"),
 *   external addresses (https, mailto, tel) and "not ready yet" (shown as text) stay possible.
 * - Header items may have one level of children (a submenu).
 * - Version 1 content (label + href, DP-134) is still valid: it is read as version 2 with every
 *   href as a fixed path or URL, visible, same tab. Published revisions and restores of old
 *   revisions keep working without a data migration; the reference conversion
 *   (`menuReferencePlan`) is an explicit, idempotent step that only writes a draft.
 * - The public site never sees the references: the API resolves them to addresses
 *   (`menuPublicNav`, `menuPublicFooter`); a reference to content that is not live (unpublished,
 *   archived, deleted) becomes a "not ready yet" text, never a 404 link.
 */
import { z } from "zod";
import { CmsHrefSchema } from "./cms.js";

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL.test(v), { message: "control_characters" })
    .pipe(z.string().min(1));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Id = z
  .string()
  .regex(UUID, { message: "id" })
  .transform((v) => v.toLowerCase());

export const BV_NAV_KEY = "bv.site-nav";
export const BV_FOOTER_KEY = "bv.site-footer";
export const CMS_MENU_KEYS = [BV_NAV_KEY, BV_FOOTER_KEY] as const;
export type CmsMenuKey = (typeof CMS_MENU_KEYS)[number];
export function cmsIsMenu(templateKey: string): templateKey is CmsMenuKey {
  return (CMS_MENU_KEYS as readonly string[]).includes(templateKey);
}
/** The content schema version the menus are written with (version 1: label + href, DP-134). */
export const CMS_MENU_SCHEMA_VERSION = 2;

export const MENU_LIMITS = {
  navItems: 8,
  navChildren: 8,
  noScriptLinks: 8,
  footerColumns: 4,
  columnLinks: 10,
  social: 8,
  legal: 4,
  label: 80,
} as const;

// --- targets ----------------------------------------------------------------------------------

/** A site route or an in-page anchor: "/products", "/products?category=x", "/#services", "#top". */
export const MenuPathSchema = CmsHrefSchema.refine((v) => v.startsWith("/") || v.startsWith("#"), {
  message: "path",
});
/** An address outside the site: https, mailto or tel (http, javascript:, data: are refused). */
export const MenuUrlSchema = CmsHrefSchema.refine((v) => !v.startsWith("/") && !v.startsWith("#"), {
  message: "url",
});

export const MENU_TARGET_TYPES = ["page", "product", "category", "path", "url", "none"] as const;
export type MenuTargetType = (typeof MENU_TARGET_TYPES)[number];

export const MenuTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("page"), pageId: Id }),
  z.strictObject({ type: z.literal("product"), productId: Id }),
  z.strictObject({ type: z.literal("category"), categoryId: Id }),
  z.strictObject({ type: z.literal("path"), path: MenuPathSchema }),
  z.strictObject({ type: z.literal("url"), url: MenuUrlSchema }),
  /** The page does not exist yet: shown as text with the pending note, never a link. */
  z.strictObject({ type: z.literal("none") }),
]);
export type MenuTarget = z.infer<typeof MenuTargetSchema>;

export const MenuLinkSchema = z.strictObject({
  label: text(MENU_LIMITS.label),
  target: MenuTargetSchema,
  newTab: z.boolean().default(false),
  visible: z.boolean().default(true),
});
export type MenuLink = z.infer<typeof MenuLinkSchema>;

// --- header ------------------------------------------------------------------------------------

export const MenuNavItemSchema = MenuLinkSchema.extend({
  /** One level of submenu. An item with children may have no target of its own ("none"). */
  children: z.array(MenuLinkSchema).max(MENU_LIMITS.navChildren).default([]),
});
export type MenuNavItem = z.infer<typeof MenuNavItemSchema>;

const NavV2Schema = z.strictObject({
  items: z.array(MenuNavItemSchema).min(1).max(MENU_LIMITS.navItems),
  contact: MenuLinkSchema,
  /** Shown on phones and tablets only when JavaScript is off: real destinations only. */
  noScriptLinks: z.array(MenuLinkSchema).max(MENU_LIMITS.noScriptLinks),
  pendingNote: text(120),
});
export type BvNavMenu = z.infer<typeof NavV2Schema>;
/** Version 2 input: `newTab`, `visible` and `children` may be left out (defaults). */
export type BvNavMenuInput = z.input<typeof NavV2Schema>;

// --- footer ------------------------------------------------------------------------------------

export const MENU_SOCIAL_NETWORKS = [
  "linkedin",
  "x",
  "facebook",
  "instagram",
  "youtube",
  "other",
] as const;
export type MenuSocialNetwork = (typeof MENU_SOCIAL_NETWORKS)[number];

const TEL = /^tel:\+?[0-9 ()-]{3,30}$/;
const MAILTO = /^mailto:[^\s@]+@[^\s@]+$/;

const FooterV2Schema = z.strictObject({
  headline: text(120),
  /** The button under the headline: always shown, so it needs a real destination. */
  cta: z.strictObject({
    label: text(MENU_LIMITS.label),
    target: MenuTargetSchema.refine((t) => t.type !== "none", { message: "required" }),
    newTab: z.boolean().default(false),
  }),
  intro: text(500),
  contact: z.strictObject({
    title: text(60),
    company: text(120),
    addressLines: z
      .array(z.strictObject({ text: text(120) }))
      .min(1)
      .max(4),
    phone: z.strictObject({
      label: text(60),
      href: text(60).pipe(z.string().regex(TEL, { message: "tel" })),
      note: text(80),
      visible: z.boolean().default(true),
    }),
    email: z.strictObject({
      label: text(120),
      href: text(200).pipe(z.string().regex(MAILTO, { message: "mailto" })),
      note: text(80),
      visible: z.boolean().default(true),
    }),
  }),
  columns: z
    .array(
      z.strictObject({
        title: text(60),
        visible: z.boolean().default(true),
        links: z.array(MenuLinkSchema).min(1).max(MENU_LIMITS.columnLinks),
      }),
    )
    .min(1)
    .max(MENU_LIMITS.footerColumns),
  social: z
    .array(
      z.strictObject({
        network: z.enum(MENU_SOCIAL_NETWORKS),
        label: text(60),
        url: text(500).pipe(z.string().regex(/^https:\/\/[^\s/]+[^\s]*$/, { message: "https" })),
        visible: z.boolean().default(true),
      }),
    )
    .max(MENU_LIMITS.social)
    .default([]),
  copyright: text(200),
  /** The Privacy Policy link is hidden by the site where the policy is not published (DP-095). */
  legal: z.array(MenuLinkSchema).max(MENU_LIMITS.legal),
  pendingNote: text(120),
});
export type BvFooterMenu = z.infer<typeof FooterV2Schema>;
export type BvFooterMenuInput = z.input<typeof FooterV2Schema>;

// --- version 1 (DP-134) → version 2 -------------------------------------------------------------

type V1Link = { label?: unknown; href?: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function isV1Link(v: unknown): v is V1Link {
  return isRecord(v) && "href" in v && !("target" in v);
}

/** The target an href of version 1 meant: empty = not ready yet, site path, external address. */
export function menuTargetOfHref(href: unknown): MenuTarget | { type: "path"; path: unknown } {
  if (href === null || href === undefined || href === "") return { type: "none" };
  if (typeof href === "string" && !href.startsWith("/") && !href.startsWith("#")) {
    return { type: "url", url: href };
  }
  return { type: "path", path: href };
}

function upgradeLink(v: unknown): unknown {
  if (!isV1Link(v)) return v;
  const { href, ...rest } = v as Record<string, unknown>;
  return { ...rest, target: menuTargetOfHref(href) };
}
const upgradeList = (v: unknown) => (Array.isArray(v) ? v.map(upgradeLink) : v);

/** Version 1 navigation content (`{ label, href }` links) as version 2; other input unchanged. */
export function upgradeNavContent(v: unknown): unknown {
  if (!isRecord(v)) return v;
  const items = v["items"];
  const v1 =
    (Array.isArray(items) && items.some(isV1Link)) ||
    isV1Link(v["contact"]) ||
    (Array.isArray(v["noScriptLinks"]) && v["noScriptLinks"].some(isV1Link));
  if (!v1) return v;
  return {
    ...v,
    items: Array.isArray(items)
      ? items.map((i) => {
          const link = upgradeLink(i);
          return isRecord(link) && !("children" in link) ? { ...link, children: [] } : link;
        })
      : items,
    contact: upgradeLink(v["contact"]),
    noScriptLinks: upgradeList(v["noScriptLinks"]),
  };
}

/** Version 1 footer content as version 2; other input unchanged. */
export function upgradeFooterContent(v: unknown): unknown {
  if (!isRecord(v)) return v;
  const columns = v["columns"];
  const v1 =
    isV1Link(v["cta"]) ||
    (Array.isArray(columns) &&
      columns.some((c) => isRecord(c) && Array.isArray(c["links"]) && c["links"].some(isV1Link))) ||
    (Array.isArray(v["legal"]) && v["legal"].some(isV1Link));
  if (!v1) return v;
  return {
    ...v,
    cta: upgradeLink(v["cta"]),
    columns: Array.isArray(columns)
      ? columns.map((c) => (isRecord(c) ? { ...c, links: upgradeList(c["links"]) } : c))
      : columns,
    legal: upgradeList(v["legal"]),
  };
}

/** The navigation content: version 2, or version 1 read as version 2. */
export const BvNavMenuSchema = z.preprocess(upgradeNavContent, NavV2Schema);
/** The footer content: version 2, or version 1 read as version 2. */
export const BvFooterMenuSchema = z.preprocess(upgradeFooterContent, FooterV2Schema);

export function cmsMenuSchema(key: CmsMenuKey) {
  return key === BV_NAV_KEY ? BvNavMenuSchema : BvFooterMenuSchema;
}

// --- walking the links of a menu ---------------------------------------------------------------

export interface MenuLinkRef {
  /** Path in the content, as the API reports validation issues ("items.0.children.1"). */
  path: string;
  /** Where the link is, for people: "Header › Products › Base oils". */
  place: string;
  link: { label: string; target: MenuTarget };
}

export function navLinks(c: BvNavMenu): MenuLinkRef[] {
  const out: MenuLinkRef[] = [];
  c.items.forEach((item, i) => {
    out.push({ path: `items.${i}`, place: `Header › ${item.label}`, link: item });
    item.children.forEach((child, j) =>
      out.push({
        path: `items.${i}.children.${j}`,
        place: `Header › ${item.label} › ${child.label}`,
        link: child,
      }),
    );
  });
  out.push({ path: "contact", place: "Header › contact button", link: c.contact });
  c.noScriptLinks.forEach((l, i) =>
    out.push({
      path: `noScriptLinks.${i}`,
      place: `Links without JavaScript › ${l.label}`,
      link: l,
    }),
  );
  return out;
}

export function footerLinks(c: BvFooterMenu): MenuLinkRef[] {
  const out: MenuLinkRef[] = [{ path: "cta", place: "Footer › button", link: c.cta }];
  c.columns.forEach((col, i) =>
    col.links.forEach((l, j) =>
      out.push({
        path: `columns.${i}.links.${j}`,
        place: `Footer › ${col.title} › ${l.label}`,
        link: l,
      }),
    ),
  );
  c.legal.forEach((l, i) =>
    out.push({ path: `legal.${i}`, place: `Footer › legal › ${l.label}`, link: l }),
  );
  return out;
}

/** The content references of a menu (ids of pages, products and categories). */
export function menuReferences(links: MenuLinkRef[]): {
  pageIds: string[];
  productIds: string[];
  categoryIds: string[];
} {
  const pages = new Set<string>();
  const products = new Set<string>();
  const categories = new Set<string>();
  for (const { link } of links) {
    const t = link.target;
    if (t.type === "page") pages.add(t.pageId);
    if (t.type === "product") products.add(t.productId);
    if (t.type === "category") categories.add(t.categoryId);
  }
  return { pageIds: [...pages], productIds: [...products], categoryIds: [...categories] };
}

// --- the public shape (what the site renders) ----------------------------------------------------

export const MenuPublicLinkSchema = z.strictObject({
  label: z.string(),
  /** null: shown as text with the pending note (not ready yet, or its content is not live). */
  href: z.string().nullable(),
  newTab: z.boolean(),
});
export type MenuPublicLink = z.infer<typeof MenuPublicLinkSchema>;

export const BvNavPublicSchema = z.strictObject({
  items: z.array(MenuPublicLinkSchema.extend({ children: z.array(MenuPublicLinkSchema) })),
  /** null when the contact button is switched off. */
  contact: MenuPublicLinkSchema.nullable(),
  noScriptLinks: z.array(MenuPublicLinkSchema),
  pendingNote: z.string(),
});
export type BvNavPublic = z.infer<typeof BvNavPublicSchema>;

/**
 * `visible`: shown in the footer. The contact page (DP-151) shows the details either way, so a
 * switch in the footer never removes them there.
 */
const PublicContactLine = z.strictObject({
  label: z.string(),
  href: z.string(),
  note: z.string(),
  visible: z.boolean(),
});

export const BvFooterPublicSchema = z.strictObject({
  headline: z.string(),
  /** href null only when the button's page is not live: shown as text, never a 404 link. */
  cta: MenuPublicLinkSchema,
  intro: z.string(),
  contact: z.strictObject({
    title: z.string(),
    company: z.string(),
    addressLines: z.array(z.strictObject({ text: z.string() })),
    phone: PublicContactLine,
    email: PublicContactLine,
  }),
  columns: z.array(z.strictObject({ title: z.string(), links: z.array(MenuPublicLinkSchema) })),
  social: z.array(
    z.strictObject({ network: z.enum(MENU_SOCIAL_NETWORKS), label: z.string(), href: z.string() }),
  ),
  copyright: z.string(),
  legal: z.array(MenuPublicLinkSchema),
  pendingNote: z.string(),
});
export type BvFooterPublic = z.infer<typeof BvFooterPublicSchema>;

/** The address of a target now; null when it is not ready or its content is not live. */
export type MenuResolve = (target: MenuTarget) => string | null;

function publicLink(
  l: { label: string; target: MenuTarget; newTab: boolean },
  resolve: MenuResolve,
) {
  const href = resolve(l.target);
  return { label: l.label, href, newTab: href !== null && l.newTab };
}

/** The navigation as the site renders it: visible links only, every target resolved. */
export function menuPublicNav(c: BvNavMenu, resolve: MenuResolve): BvNavPublic {
  return {
    items: c.items
      .filter((i) => i.visible)
      .map((i) => ({
        ...publicLink(i, resolve),
        children: i.children.filter((ch) => ch.visible).map((ch) => publicLink(ch, resolve)),
      })),
    contact: c.contact.visible ? publicLink(c.contact, resolve) : null,
    // Real destinations only: without JavaScript a pending item could not explain itself.
    noScriptLinks: c.noScriptLinks
      .filter((l) => l.visible)
      .map((l) => publicLink(l, resolve))
      .filter((l) => l.href !== null),
    pendingNote: c.pendingNote,
  };
}

/** The footer as the site renders it: visible parts only, every target resolved. */
export function menuPublicFooter(c: BvFooterMenu, resolve: MenuResolve): BvFooterPublic {
  return {
    headline: c.headline,
    cta: publicLink(c.cta, resolve),
    intro: c.intro,
    contact: {
      title: c.contact.title,
      company: c.contact.company,
      addressLines: c.contact.addressLines,
      phone: c.contact.phone,
      email: c.contact.email,
    },
    columns: c.columns
      .filter((col) => col.visible)
      .map((col) => ({
        title: col.title,
        links: col.links.filter((l) => l.visible).map((l) => publicLink(l, resolve)),
      }))
      .filter((col) => col.links.length > 0),
    social: c.social
      .filter((s) => s.visible)
      .map((s) => ({ network: s.network, label: s.label, href: s.url })),
    copyright: c.copyright,
    legal: c.legal.filter((l) => l.visible).map((l) => publicLink(l, resolve)),
    pendingNote: c.pendingNote,
  };
}

// --- admin: the content a menu may link to ------------------------------------------------------

export const CmsMenuTargetsResponseSchema = z.object({
  /** CMS pages of the site with an address (designed, content pages and news articles). */
  pages: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(["DESIGN", "TEMPLATE"]),
      /** The address of the draft. */
      path: z.string(),
      /** The address on the site now; null when not published or unpublished. */
      livePath: z.string().nullable(),
      status: z.enum(["PUBLISHED", "UNPUBLISHED", "DRAFT"]),
    }),
  ),
  /** Products listed on the site (live ones only when the caller may not read the catalogue). */
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      livePath: z.string().nullable(),
    }),
  ),
  productsComplete: z.boolean(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      parentId: z.string().nullable(),
      path: z.string(),
      liveProducts: z.number().int(),
    }),
  ),
});
export type CmsMenuTargetsResponse = z.infer<typeof CmsMenuTargetsResponseSchema>;

export function menuCategoryPath(slug: string): string {
  return `/products?category=${slug}`;
}

export type MenuTargetProblem =
  | "page_missing"
  | "page_unpublished"
  | "page_not_published"
  | "product_missing"
  | "product_not_live"
  | "category_missing"
  | "category_empty";

export const MENU_TARGET_PROBLEMS: Record<MenuTargetProblem, string> = {
  page_missing:
    "The page no longer exists. The site shows the label as text; choose another target.",
  page_unpublished:
    "The page was taken off the site. The site shows the label as text until it is published again.",
  page_not_published:
    "The page is not published yet. The site shows the label as text until it is.",
  product_missing:
    "The product is not on this site (removed, or not visible to you). The site shows the label as text.",
  product_not_live:
    "The product is not live on this site (not published, hidden or archived). The site shows the label as text.",
  category_missing: "The category no longer exists. The site shows the label as text.",
  category_empty: "No live product is in this category: the link opens an empty list.",
};

/** What the admin knows about a target now: its address on the site and what is wrong with it. */
export function menuTargetCheck(
  target: MenuTarget,
  t: CmsMenuTargetsResponse,
): { href: string | null; problem: MenuTargetProblem | null; name: string | null } {
  switch (target.type) {
    case "page": {
      const p = t.pages.find((x) => x.id === target.pageId);
      if (!p) return { href: null, problem: "page_missing", name: null };
      if (p.livePath) return { href: p.livePath, problem: null, name: p.title };
      return {
        href: null,
        problem: p.status === "UNPUBLISHED" ? "page_unpublished" : "page_not_published",
        name: p.title,
      };
    }
    case "product": {
      const p = t.products.find((x) => x.id === target.productId);
      if (!p) return { href: null, problem: "product_missing", name: null };
      return p.livePath
        ? { href: p.livePath, problem: null, name: p.name }
        : { href: null, problem: "product_not_live", name: p.name };
    }
    case "category": {
      const c = t.categories.find((x) => x.id === target.categoryId);
      if (!c) return { href: null, problem: "category_missing", name: null };
      return { href: c.path, problem: c.liveProducts > 0 ? null : "category_empty", name: c.name };
    }
    case "path":
      return { href: target.path, problem: null, name: null };
    case "url":
      return { href: target.url, problem: null, name: null };
    case "none":
      return { href: null, problem: null, name: null };
  }
}

// --- the reference conversion (DP-219 data step) -------------------------------------------------

export interface MenuReferenceChange {
  path: string;
  place: string;
  label: string;
  from: string;
  to: MenuTarget;
  /** The title of the page, product or category the link now points at. */
  toName: string;
}

/**
 * Which fixed site paths of a menu can become content references, keeping every address the same:
 * the live address of a CMS page → that page; "/products?category=<slug>" → that category; the
 * live address of a product → that product. Anchors, site routes ("/products", "/privacy") and
 * external addresses stay as they are. Pure and idempotent: a second plan over its own result is
 * empty. The admin applies it to the draft; nothing is published by it.
 */
export function menuReferencePlan<T extends BvNavMenu | BvFooterMenu>(
  key: CmsMenuKey,
  content: T,
  t: CmsMenuTargetsResponse,
): { changes: MenuReferenceChange[]; content: T } {
  const refFor = (path: string): { to: MenuTarget; name: string } | null => {
    const page = t.pages.find((p) => p.livePath === path);
    if (page) return { to: { type: "page", pageId: page.id }, name: page.title };
    const cat = /^\/products\?category=([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
    if (cat) {
      const c = t.categories.find((x) => x.slug === cat[1]);
      return c ? { to: { type: "category", categoryId: c.id }, name: c.name } : null;
    }
    const product = t.products.find((p) => p.livePath !== null && p.livePath === path);
    return product ? { to: { type: "product", productId: product.id }, name: product.name } : null;
  };
  // A deep copy (contracts has no DOM or Node types, so no structuredClone): JSON content only.
  const copy = JSON.parse(JSON.stringify(content)) as T;
  const links =
    key === BV_NAV_KEY ? navLinks(copy as BvNavMenu) : footerLinks(copy as BvFooterMenu);
  const changes: MenuReferenceChange[] = [];
  for (const ref of links) {
    const target = ref.link.target;
    if (target.type !== "path") continue;
    const found = refFor(target.path);
    if (!found) continue;
    // The objects of `links` are the objects of `copy`: assigning changes the copy.
    (ref.link as { target: MenuTarget }).target = found.to;
    changes.push({
      path: ref.path,
      place: ref.place,
      label: ref.link.label,
      from: target.path,
      to: found.to,
      toName: found.name,
    });
  }
  return { changes, content: copy };
}
