/**
 * View helpers of the product catalogue screens (PM-1): category tree order, list query strings
 * and page links. Pure functions, unit-tested.
 */
import {
  LISTING_FILTERS,
  LISTING_VISIBILITIES,
  PRODUCT_SORT_FIELDS,
  PRODUCT_STATUSES,
  type Category,
} from "@dream/contracts";

export interface TreeRow {
  category: Category;
  depth: number;
}

/** Categories in tree order (parents before children, siblings by sortOrder then name). */
export function flattenTree(items: readonly Category[]): TreeRow[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of items) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  const ids = new Set(items.map((c) => c.id));
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent not visible) still appear, at the top level.
  for (const c of items) {
    if (!seen.has(c.id) && c.parentId && !ids.has(c.parentId)) {
      seen.add(c.id);
      out.push({ category: c, depth: 0 });
      walk(c.id, 1);
    }
  }
  return out;
}

/** The category's path for a label: "Base Oils / Synthetic / PAO". */
export function categoryPath(items: readonly Category[], id: string): string {
  const byId = new Map(items.map((c) => [c.id, c]));
  const parts: string[] = [];
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" / ");
}

export interface ListFilters {
  q: string;
  status: string;
  listing: string;
  visibility: string;
  category: string;
  sort: string;
  order: string;
  page: number;
}

const pick = (v: unknown, allowed: readonly string[], fallback: string): string =>
  typeof v === "string" && allowed.includes(v) ? v : fallback;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the list filters from the page URL; anything unknown falls back to the default. */
export function readFilters(params: Record<string, string | string[] | undefined>): ListFilters {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = Number.parseInt(one("page") ?? "1", 10);
  const category = one("category") ?? "";
  return {
    q: (one("q") ?? "").trim().slice(0, 100),
    status: pick(one("status"), PRODUCT_STATUSES, ""),
    listing: pick(one("listing"), LISTING_FILTERS, "all"),
    visibility: pick(one("visibility"), LISTING_VISIBILITIES, ""),
    category: UUID.test(category) ? category : "",
    sort: pick(one("sort"), PRODUCT_SORT_FIELDS, "name"),
    order: pick(one("order"), ["asc", "desc"], "asc"),
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export const PAGE_SIZE = 25;

/** Query string of GET /api/v1/admin/catalog/products for the filters on one site. */
export function apiListQuery(siteId: string, f: ListFilters): string {
  const q = new URLSearchParams({ siteId });
  if (f.q) q.set("q", f.q);
  if (f.status) q.set("status", f.status);
  if (f.listing !== "all") q.set("listing", f.listing);
  if (f.visibility) q.set("visibility", f.visibility);
  if (f.category) q.set("categoryId", f.category);
  q.set("sort", f.sort);
  q.set("order", f.order);
  q.set("page", String(f.page));
  q.set("pageSize", String(PAGE_SIZE));
  return q.toString();
}

/** The console URL of the product list with these filters (defaults left out). */
export function listHref(site: string, f: Partial<ListFilters>): string {
  const q = new URLSearchParams({ site });
  if (f.q) q.set("q", f.q);
  if (f.status) q.set("status", f.status);
  if (f.listing && f.listing !== "all") q.set("listing", f.listing);
  if (f.visibility) q.set("visibility", f.visibility);
  if (f.category) q.set("category", f.category);
  if (f.sort && f.sort !== "name") q.set("sort", f.sort);
  if (f.order && f.order !== "asc") q.set("order", f.order);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  return `/products?${q.toString()}`;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** "2.4 MB", "830 KB", "512 B". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
