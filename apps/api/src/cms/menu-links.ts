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
 * Plain functions over a site-scoped client, no Nest wiring.
 */
import {
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
  type CmsMenuTargetsResponse,
  type CmsPublicPage,
  type MenuLinkRef,
  type MenuTarget,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { PublicSite } from "../iam/public-site.js";
import { liveRows as liveProductRows } from "../catalog/live.js";
import type { CmsDb, LiveRow } from "./cms-content.js";

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

/** The address of each referenced live item of the site, read once per request. */
async function publicResolver(
  site: PublicSite,
  live: LiveRow[],
  links: MenuLinkRef[],
): Promise<(t: MenuTarget) => string | null> {
  const refs = menuReferences(links);
  const pagePath = new Map<string, string>();
  for (const row of live) {
    if (row.page.kind !== "FRAGMENT" && row.revision.path)
      pagePath.set(row.pageId, row.revision.path);
  }
  const productPath = new Map<string, string>();
  if (refs.productIds.length) {
    const rows = await liveProductRows(site, { productId: { in: refs.productIds } });
    for (const r of rows) {
      const snap = PublishedSnapshotSchema.safeParse(r.snapshot);
      if (snap.success) productPath.set(r.productId, `/products/${snap.data.slug}`);
    }
  }
  const categoryPath = new Map<string, string>();
  if (refs.categoryIds.length) {
    const cats = await site.db.productCategory.findMany({
      where: { siteId: site.siteId, id: { in: refs.categoryIds } },
      select: { id: true, slug: true },
    });
    for (const c of cats) categoryPath.set(c.id, menuCategoryPath(c.slug));
  }
  return (t) => {
    switch (t.type) {
      case "page":
        return pagePath.get(t.pageId) ?? null;
      case "product":
        return productPath.get(t.productId) ?? null;
      case "category":
        return categoryPath.get(t.categoryId) ?? null;
      case "path":
        return t.path;
      case "url":
        return t.url;
      case "none":
        return null;
    }
  };
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
      const resolve = await publicResolver(site, live, navLinks(parsed.data));
      fragments[key] = { ...page, content: menuPublicNav(parsed.data, resolve) };
    } else {
      const parsed = BvFooterMenuSchema.safeParse(page.content);
      if (!parsed.success) {
        fragments[key] = null;
        continue;
      }
      const resolve = await publicResolver(site, live, footerLinks(parsed.data));
      fragments[key] = { ...page, content: menuPublicFooter(parsed.data, resolve) };
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
): Promise<CmsMenuTargetsResponse> {
  const [pages, pubs, categories, listings, productPubs] = await Promise.all([
    db.cmsPage.findMany({
      where: { siteId, kind: { not: "FRAGMENT" }, path: { not: null } },
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
