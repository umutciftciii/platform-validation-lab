/**
 * DP-219: the content references of the BV menus (contracts `cms-menu.ts`).
 *
 *  - `resolvePublicMenus`: turns the published (or previewed) navigation and footer into what the
 *    site renders: visible links only, a page reference → the address of its PUBLISHED revision, a
 *    product → `/products/<slug>` of its live publication, a category → `/products?category=<slug>`.
 *    Content that is not live gives a "not ready yet" text (href null), never a 404 link. The
 *    addresses are read at request time, so a slug change (DP-210) shows on the menus at once.
 *  - `assertMenuReferences`: a draft may reference only pages, products and categories of its own
 *    site (400 `unknown_reference` otherwise; ids of another site look unknown).
 *  - `menuTargets`: what the admin's target picker offers, with the state of each target.
 *
 * ML-2 (ADR-028 D6/D7): menus are fragments per language. A page reference names a page of the
 * site (in practice of the default language) and is resolved per language: the page of the
 * reference's translation group in the menu's language, at its address in that language
 * (`/nl/...` for Dutch; unchanged for the default language until ML-3). A page without a
 * published counterpart in the menu's language gives the "not ready yet" text (href null), never
 * the English page. ML-7 completes this for every other language (`menuLinkStates`): a link
 * without a live destination in the menu's language is left out of that menu.
 *
 * Plain functions over a site-scoped client, no Nest wiring.
 */
import {
  cmsLocaleAddress,
  MENU_HIDDEN,
  BV_FOOTER_KEY,
  BV_NAV_KEY,
  BvFooterMenuSchema,
  BvNavMenuSchema,
  PublishedSnapshotSchema,
  cmsIsMenu,
  footerLinks,
  menuCategoryPath,
  menuPublicFooter,
  menuPublicNav,
  menuReferences,
  navLinks,
  type CmsMenuKey,
  type CmsMenuLinkWarning,
  type CmsMenuLinkWarningRule,
  type MenuResolution,
  type CmsMenuTargetsResponse,
  type CmsPublicPage,
  type MenuLinkRef,
  type MenuTarget,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { PublicSite } from "../iam/public-site.js";
import { liveRows as liveProductRows } from "../catalog/live.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { liveRows, type CmsDb, type LiveRow } from "./cms-content.js";

const MAX_TARGETS = 2000;

function linksOf(key: CmsMenuKey, content: unknown): MenuLinkRef[] | null {
  if (key === BV_NAV_KEY) {
    const parsed = BvNavMenuSchema.safeParse(content);
    return parsed.success ? navLinks(parsed.data) : null;
  }
  const parsed = BvFooterMenuSchema.safeParse(content);
  return parsed.success ? footerLinks(parsed.data) : null;
}

/**
 * Throws 400 VALIDATION_FAILED (`content.<path>.target`, rule `unknown_reference`) when a draft of
 * a menu names a page, product or category that is not of the page's site.
 */
export async function assertMenuReferences(
  db: CmsDb,
  siteId: string,
  templateKey: string,
  content: unknown,
): Promise<void> {
  if (!cmsIsMenu(templateKey)) return;
  const links = linksOf(templateKey, content);
  if (!links) return; // validated before; nothing to check
  const refs = menuReferences(links);
  const [pages, listings, categories] = await Promise.all([
    refs.pageIds.length
      ? db.cmsPage.findMany({
          where: { siteId, id: { in: refs.pageIds }, kind: { not: "FRAGMENT" } },
          select: { id: true },
        })
      : [],
    refs.productIds.length
      ? db.productSiteListing.findMany({
          where: { siteId, productId: { in: refs.productIds } },
          select: { productId: true },
        })
      : [],
    refs.categoryIds.length
      ? db.productCategory.findMany({
          where: { siteId, id: { in: refs.categoryIds } },
          select: { id: true },
        })
      : [],
  ]);
  const known = new Set([
    ...pages.map((p) => p.id),
    ...listings.map((l) => l.productId),
    ...categories.map((c) => c.id),
  ]);
  const unknown = links.filter(({ link: { target: t } }) => {
    const id =
      t.type === "page"
        ? t.pageId
        : t.type === "product"
          ? t.productId
          : t.type === "category"
            ? t.categoryId
            : null;
    return id !== null && !known.has(id);
  });
  if (unknown.length) {
    throw new ApiError(
      "VALIDATION_FAILED",
      unknown.slice(0, 50).map((u) => ({
        path: `content.${u.path}.target`,
        rule: "unknown_reference",
      })),
    );
  }
}

/** The language a menu is resolved in (ML-2). */
export interface MenuLocale {
  locale: string;
  defaultLocale: string;
}

/** How one target shows in a menu of a language, and why it is not a link (admin warning). */
export interface MenuLinkState {
  href: MenuResolution;
  rule: CmsMenuLinkWarningRule | null;
}

/** Splits `/x?y#z` / `#z` into the stored path ("/" for an in-page anchor) and the rest. */
function splitTarget(path: string): { base: string; tail: string } {
  if (path.startsWith("#")) return { base: "/", tail: path };
  const cut = path.search(/[?#]/);
  return cut === -1
    ? { base: path, tail: "" }
    : { base: path.slice(0, cut) || "/", tail: path.slice(cut) };
}

/**
 * The state of each target of `links` in the menu's language, read once per request.
 *
 * Default language (unchanged by ML-7): a page or product that is not live is text with the
 * pending note (href null); site paths and URLs stay as written.
 *
 * Any other language (ML-7, ADR-028 D7): a link is shown only when its destination exists in the
 * menu's language; otherwise it is left out (`MENU_HIDDEN`), never the English page and never a
 * pending text:
 *  - a page reference resolves through its translation group to the live page of the language;
 *  - a site path is a live page of the language (`/over-ons`, `/nl/over-ons`, "/" for the home and
 *    in-page anchors), or the live counterpart of the default language's page at that path
 *    (`/about-us` → `/nl/over-ons`); application routes without content in the language
 *    (`/products`, `/privacy`) are left out;
 *  - products and categories are left out until the catalogue is translated (ML-8c);
 *  - URLs stay as written; "not ready yet" stays a pending text.
 */
export async function menuLinkStates(
  db: CmsDb,
  siteId: string,
  /** Live rows of the menu's language (other languages are ignored). */
  live: LiveRow[],
  links: MenuLinkRef[],
  { locale, defaultLocale }: MenuLocale,
): Promise<(t: MenuTarget) => MenuLinkState> {
  const refs = menuReferences(links);
  const at = (path: string) => cmsLocaleAddress(path, locale, defaultLocale);
  const isDefault = locale === defaultLocale;
  // Live pages of the menu's language by translation group and by stored path.
  const groupPath = new Map<string, string>();
  const livePaths = new Set<string>();
  for (const row of live) {
    if (row.page.kind !== "FRAGMENT" && row.revision.path && row.page.locale === locale) {
      groupPath.set(row.page.translationGroupId, row.revision.path);
      livePaths.add(row.revision.path);
    }
  }
  const known = new Set<string>();
  const pagePath = new Map<string, string>();
  if (refs.pageIds.length) {
    const pages = await db.cmsPage.findMany({
      where: { siteId, id: { in: refs.pageIds } },
      select: { id: true, translationGroupId: true },
    });
    for (const p of pages) {
      known.add(p.id);
      const path = groupPath.get(p.translationGroupId);
      if (path) pagePath.set(p.id, at(path));
    }
  }
  // ML-7: a site path of the default language whose page has a live counterpart here.
  const counterpart = new Map<string, string>();
  if (!isDefault) {
    const wanted = new Set<string>();
    for (const { link } of links) {
      if (link.target.type !== "path") continue;
      const { base } = splitTarget(link.target.path);
      const inLocale =
        base === `/${locale}`
          ? "/"
          : base.startsWith(`/${locale}/`)
            ? base.slice(locale.length + 1)
            : base;
      if (!livePaths.has(inLocale)) wanted.add(base);
    }
    if (wanted.size) {
      const pages = await db.cmsPage.findMany({
        where: {
          siteId,
          locale: defaultLocale,
          kind: { not: "FRAGMENT" },
          path: { in: [...wanted] },
        },
        select: { path: true, translationGroupId: true },
      });
      for (const p of pages) {
        const path = groupPath.get(p.translationGroupId);
        if (p.path && path) counterpart.set(p.path, path);
      }
    }
  }
  const productPath = new Map<string, string>();
  const categoryPath = new Map<string, string>();
  if (isDefault && refs.productIds.length) {
    const rows = await liveProductRows(
      { db: db as SiteScopedClient, siteId },
      {
        productId: { in: refs.productIds },
      },
    );
    for (const r of rows) {
      const snap = PublishedSnapshotSchema.safeParse(r.snapshot);
      if (snap.success) productPath.set(r.productId, at(`/products/${snap.data.slug}`));
    }
  }
  if (refs.categoryIds.length) {
    const cats = await db.productCategory.findMany({
      where: { siteId, id: { in: refs.categoryIds } },
      select: { id: true, slug: true },
    });
    for (const c of cats) {
      categoryPath.set(c.id, at(menuCategoryPath(c.slug)));
    }
  }
  const unknownOr = (id: string, ids: Set<string>, rule: CmsMenuLinkWarningRule): MenuLinkState =>
    ids.has(id)
      ? { href: isDefault ? null : MENU_HIDDEN, rule }
      : { href: isDefault ? null : MENU_HIDDEN, rule: "unknown_target" };
  return (t) => {
    switch (t.type) {
      case "page": {
        const path = pagePath.get(t.pageId);
        if (path) return { href: path, rule: null };
        return unknownOr(t.pageId, known, isDefault ? "not_live" : "no_translation");
      }
      case "product": {
        if (!isDefault) return { href: MENU_HIDDEN, rule: "not_in_language" };
        const path = productPath.get(t.productId);
        return path ? { href: path, rule: null } : { href: null, rule: "not_live" };
      }
      case "category": {
        if (!isDefault) return { href: MENU_HIDDEN, rule: "not_in_language" };
        const path = categoryPath.get(t.categoryId);
        return path ? { href: path, rule: null } : { href: null, rule: "unknown_target" };
      }
      case "path": {
        if (isDefault) return { href: t.path, rule: null };
        const { base, tail } = splitTarget(t.path);
        const inLocale =
          base === `/${locale}`
            ? "/"
            : base.startsWith(`/${locale}/`)
              ? base.slice(locale.length + 1)
              : base;
        // An in-page anchor of the home page stays relative ("#top"); the site places it.
        if (livePaths.has(inLocale)) {
          return { href: t.path.startsWith("#") ? t.path : `${at(inLocale)}${tail}`, rule: null };
        }
        const other = counterpart.get(base);
        if (other) return { href: `${at(other)}${tail}`, rule: null };
        return { href: MENU_HIDDEN, rule: "not_in_language" };
      }
      case "url":
        return { href: t.url, rule: null };
      case "none":
        return { href: null, rule: null };
    }
  };
}

/** The visible links of a menu's content (a submenu link of a hidden item is not shown either). */
function shownLinks(key: CmsMenuKey, content: unknown): MenuLinkRef[] | null {
  const links = linksOf(key, content);
  if (!links) return null;
  const hiddenItems = new Set<string>();
  return links.filter(({ path, link }) => {
    if ((link as { visible?: boolean }).visible === false) {
      hiddenItems.add(path);
      return false;
    }
    const parent = /^(items\.\d+)\.children\./.exec(path)?.[1];
    return !(parent && hiddenItems.has(parent));
  });
}

/**
 * ML-7 (DP-238): the links of a menu draft that the site will not show as links in the draft's
 * language (admin, before publishing; never a refusal). Empty for other templates.
 */
export async function menuWarnings(
  db: CmsDb,
  siteId: string,
  templateKey: string,
  content: unknown,
  locale: MenuLocale,
): Promise<CmsMenuLinkWarning[]> {
  if (!cmsIsMenu(templateKey)) return [];
  const links = shownLinks(templateKey, content);
  if (!links || links.length === 0) return [];
  const live = (await liveRows(db, siteId)).filter((r) => r.page.locale === locale.locale);
  const state = await menuLinkStates(db, siteId, live, links, locale);
  const out: CmsMenuLinkWarning[] = [];
  for (const { path, link } of links) {
    const { rule } = state(link.target);
    if (rule) out.push({ path, label: link.label.slice(0, 200), rule });
  }
  return out.slice(0, 200);
}

/**
 * Replaces the content of the navigation and footer in `fragments` with their public shape
 * (contracts `BvNavPublic`, `BvFooterPublic`). A fragment whose content does not validate is
 * dropped (null), as before: the site then shows nothing in its place.
 */
export async function resolvePublicMenus(
  site: PublicSite,
  live: LiveRow[],
  fragments: Record<string, CmsPublicPage | null>,
  locale: MenuLocale,
): Promise<void> {
  for (const key of [BV_NAV_KEY, BV_FOOTER_KEY] as const) {
    const page = fragments[key];
    if (!page) continue;
    if (key === BV_NAV_KEY) {
      const parsed = BvNavMenuSchema.safeParse(page.content);
      if (!parsed.success) {
        fragments[key] = null;
        continue;
      }
      const state = await menuLinkStates(site.db, site.siteId, live, navLinks(parsed.data), locale);
      fragments[key] = { ...page, content: menuPublicNav(parsed.data, (t) => state(t).href) };
    } else {
      const parsed = BvFooterMenuSchema.safeParse(page.content);
      if (!parsed.success) {
        fragments[key] = null;
        continue;
      }
      const state = await menuLinkStates(
        site.db,
        site.siteId,
        live,
        footerLinks(parsed.data),
        locale,
      );
      fragments[key] = { ...page, content: menuPublicFooter(parsed.data, (t) => state(t).href) };
    }
  }
}

/**
 * The targets a menu of the site may link to (admin picker). Pages and categories with
 * `content:read`; products listed on the site when the caller may read the catalogue
 * (`readProducts`), otherwise only the live ones (they are public on the site anyway).
 */
export async function menuTargets(
  db: CmsDb,
  siteId: string,
  readProducts: boolean,
  /** ML-2: the site's default language; page targets are its pages (resolved per language). */
  defaultLocale: string,
): Promise<CmsMenuTargetsResponse> {
  const [pages, pubs, categories, listings, productPubs] = await Promise.all([
    db.cmsPage.findMany({
      where: { siteId, locale: defaultLocale, kind: { not: "FRAGMENT" }, path: { not: null } },
      select: { id: true, title: true, kind: true, path: true },
      orderBy: { path: "asc" },
      take: MAX_TARGETS,
    }),
    db.cmsPagePublication.findMany({
      where: { siteId },
      select: { pageId: true, status: true, revisionId: true },
    }),
    db.productCategory.findMany({
      where: { siteId },
      select: { id: true, name: true, slug: true, parentId: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.productSiteListing.findMany({
      where: { siteId },
      select: {
        id: true,
        productId: true,
        visibility: true,
        texts: { where: { locale: "en" }, select: { title: true } },
      },
      take: MAX_TARGETS,
    }),
    db.productPublication.findMany({
      where: { siteId },
      select: { productId: true, listingId: true, status: true, snapshot: true },
      take: MAX_TARGETS,
    }),
  ]);
  const revisions = pubs.length
    ? await db.cmsPageRevision.findMany({
        where: { id: { in: pubs.map((p) => p.revisionId) } },
        select: { id: true, path: true },
      })
    : [];
  const productIds = listings.map((l) => l.productId);
  const masters = productIds.length
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, code: true, status: true },
      })
    : [];

  const outPages = pages.map((p) => {
    const pub = pubs.find((x) => x.pageId === p.id);
    const rev = pub ? revisions.find((r) => r.id === pub.revisionId) : undefined;
    const live = pub?.status === "PUBLISHED" ? (rev?.path ?? null) : null;
    return {
      id: p.id,
      title: p.title,
      kind: p.kind as "DESIGN" | "TEMPLATE",
      path: p.path as string,
      livePath: live,
      status: (pub?.status ?? "DRAFT") as "PUBLISHED" | "UNPUBLISHED" | "DRAFT",
    };
  });

  const liveBySlug = new Map<string, number>();
  const products: CmsMenuTargetsResponse["products"] = [];
  for (const l of listings) {
    const master = masters.find((m) => m.id === l.productId);
    if (!master) continue;
    const pub = productPubs.find((p) => p.productId === l.productId);
    const snap = pub ? PublishedSnapshotSchema.safeParse(pub.snapshot) : null;
    const live =
      pub?.status === "PUBLISHED" &&
      pub.listingId === l.id &&
      l.visibility === "VISIBLE" &&
      master.status !== "ARCHIVED" &&
      snap?.success;
    if (live && snap?.success) {
      liveBySlug.set(snap.data.category.slug, (liveBySlug.get(snap.data.category.slug) ?? 0) + 1);
    }
    if (!live && !readProducts) continue;
    products.push({
      id: master.id,
      name: (live && snap?.success ? snap.data.name : null) ?? l.texts[0]?.title ?? master.name,
      code: master.code,
      livePath: live && snap?.success ? `/products/${snap.data.slug}` : null,
    });
  }
  products.sort((x, y) => x.name.localeCompare(y.name, "en"));

  // A category counts the live products of its own and of every descendant (as /products shows).
  const byId = new Map(categories.map((c) => [c.id, c]));
  const total = new Map<string, number>();
  for (const c of categories) {
    const n = liveBySlug.get(c.slug) ?? 0;
    if (n === 0) continue;
    for (
      let cur: typeof c | undefined = c, i = 0;
      cur && i < 10;
      cur = byId.get(cur.parentId ?? ""), i++
    ) {
      total.set(cur.id, (total.get(cur.id) ?? 0) + n);
    }
  }

  return {
    pages: outPages,
    products,
    productsComplete: readProducts,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId,
      path: menuCategoryPath(c.slug),
      liveProducts: total.get(c.id) ?? 0,
    })),
  };
}
