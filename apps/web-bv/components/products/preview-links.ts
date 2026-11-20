/**
 * DP-173: the company preview's URLs for the shared catalogue views. Every link stays under the
 * preview base (`/preview/catalog/<token>`), so browsing never leaves the preview by accident.
 */
import { DEFAULT_LOCALE, localePath } from "../../lib/locale-routing.ts";
import type { BrowseParams } from "./browse.ts";
import type { CatalogLinks } from "./catalog-views.tsx";

export function previewLinks(base: string): CatalogLinks {
  const list = (p: Partial<BrowseParams>) => {
    const sp = new URLSearchParams();
    if (p.category) sp.set("category", p.category);
    if (p.q) sp.set("q", p.q);
    if (p.page && p.page > 1) sp.set("page", String(p.page));
    const s = sp.toString();
    return s ? `${base}/products?${s}` : `${base}/products`;
  };
  return {
    list,
    product: (slug) => `${base}/products/${slug}`,
    searchAction: `${base}/products`,
    image: (id, variant) => `${base}/images/${id}/${variant}`,
    // ML-3: the preview has no language of its own; the live contact page in the default one.
    contact: localePath(DEFAULT_LOCALE, "/contact"),
  };
}

