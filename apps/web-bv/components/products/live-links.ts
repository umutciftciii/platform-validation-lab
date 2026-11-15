/**
 * The live catalogue's URLs for the shared views (DP-173): the same paths the pages always used.
 */
import { browseHref } from "@/components/products/browse";
import type { CatalogLinks } from "@/components/products/catalog-views";
import { imageSrc } from "@/lib/catalog-api";

export const LIVE_LINKS: CatalogLinks = {
  list: browseHref,
  product: (slug) => `/products/${slug}`,
  searchAction: "/products",
  image: imageSrc,
};
