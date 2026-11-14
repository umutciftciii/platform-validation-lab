/**
 * DP-160: browsing the public catalogue by URL: `?category=<slug>` (a category and everything
 * below it), `?q=<text>` (name, code or category, case and accent insensitive) and `?page=<n>`.
 * Pure functions over the public list, so the page renders on the server with no client script
 * and every state is a shareable link. The category slugs are the live site's, so its old
 * `/products?category=<slug>` links keep their meaning.
 */
import type { PublicCategory, PublicProductSummary } from "@dream/contracts";

export const PAGE_SIZE = 24;
const Q_MAX = 80;

export interface BrowseParams {
  category: string | null;
  q: string;
  page: number;
}

export interface CategoryNode extends PublicCategory {
  children: CategoryNode[];
}

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** Reads the URL parameters; anything malformed falls back to the default, never an error. */
export function parseBrowse(sp: Record<string, string | string[] | undefined>): BrowseParams {
  const category = one(sp["category"]).trim().toLowerCase();
  const q = one(sp["q"]).replace(/\s+/g, " ").trim().slice(0, Q_MAX);
  const page = Number.parseInt(one(sp["page"]), 10);
  return {
    category: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(category) ? category : null,
    q,
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

export function buildTree(items: readonly PublicCategory[]): CategoryNode[] {
  const nodes = new Map(items.map((c) => [c.slug, { ...c, children: [] as CategoryNode[] }]));
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentSlug ? nodes.get(n.parentSlug) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

/** The slug and every slug below it. */
export function withDescendants(items: readonly PublicCategory[], slug: string): Set<string> {
  const out = new Set([slug]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of items) {
      if (c.parentSlug && out.has(c.parentSlug) && !out.has(c.slug)) {
        out.add(c.slug);
        grew = true;
      }
    }
  }
  return out;
}

/** The chain from the root down to the category (for the breadcrumb and the open branch). */
export function trail(items: readonly PublicCategory[], slug: string | null): PublicCategory[] {
  const bySlug = new Map(items.map((c) => [c.slug, c]));
  const out: PublicCategory[] = [];
  for (let c = slug ? bySlug.get(slug) : undefined, i = 0; c && i < 10; c = c.parentSlug ? bySlug.get(c.parentSlug) : undefined, i++) {
    out.unshift(c);
  }
  return out;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function filterProducts(
  products: readonly PublicProductSummary[],
  categories: readonly PublicCategory[],
  p: BrowseParams,
): PublicProductSummary[] {
  const inCategory = p.category ? withDescendants(categories, p.category) : null;
  const terms = fold(p.q).split(" ").filter(Boolean);
  return products.filter((x) => {
    if (inCategory && !inCategory.has(x.category.slug)) return false;
    if (terms.length === 0) return true;
    const hay = fold(`${x.name} ${x.code} ${x.category.name}`);
    return terms.every((t) => hay.includes(t));
  });
}

export function paginate<T>(items: readonly T[], page: number) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  return {
    items: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    total: items.length,
  };
}

/** A link to the list with these parameters (defaults are left out of the URL). */
export function browseHref(p: Partial<BrowseParams>): string {
  const sp = new URLSearchParams();
  if (p.category) sp.set("category", p.category);
  if (p.q) sp.set("q", p.q);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  const s = sp.toString();
  return s ? `/products?${s}` : "/products";
}
