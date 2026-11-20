/**
 * The live catalogue's URLs for the shared views (DP-173), in the page's language (ML-3:
 * `/en/products/...`). Images are technical endpoints and stay unprefixed.
 */
import { browseHref } from "@/components/products/browse";
import type { CatalogLinks } from "@/components/products/catalog-views";
import { imageSrc } from "@/lib/catalog-api";
import { localizeHref, type RouteLocale } from "@/lib/locale-routing";

export function liveLinks(locale: RouteLocale): CatalogLinks {
  return {
    list: (p) => localizeHref(locale, browseHref(p)),
    product: (slug) => localizeHref(locale, `/products/${slug}`),
    searchAction: localizeHref(locale, "/products"),
    image: imageSrc,
    contact: localizeHref(locale, "/contact"),
  };
}
