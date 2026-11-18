/**
 * DP-209: the SEO of a product listing (columns `seo*` of ProductSiteListing) in the contracts'
 * shape. Saved by CatalogService.updateListingSeo, copied into the publication snapshot by
 * WorkflowService.publish, read back by the public catalogue and the SEO overview.
 */
import type { ProductSeo } from "@dream/contracts";

/** DP-209: the SEO columns of a listing as the contracts name them. */
export function listingSeo(l: {
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgTitle: string | null;
  seoOgDescription: string | null;
  seoCanonicalPath: string | null;
  seoNoindex: boolean;
  seoOgImageId: string | null;
}): ProductSeo {
  return {
    title: l.seoTitle,
    description: l.seoDescription,
    ogTitle: l.seoOgTitle,
    ogDescription: l.seoOgDescription,
    canonicalPath: l.seoCanonicalPath,
    noindex: l.seoNoindex,
    ogImageId: l.seoOgImageId,
  };
}

/** DP-209: the listing's SEO columns (selected wherever the listing's SEO is read). */
export const LISTING_SEO_SELECT = {
  seoTitle: true,
  seoDescription: true,
  seoOgTitle: true,
  seoOgDescription: true,
  seoCanonicalPath: true,
  seoNoindex: true,
  seoOgImageId: true,
} as const;
