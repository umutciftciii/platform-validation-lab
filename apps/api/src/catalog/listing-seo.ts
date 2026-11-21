/**
 * DP-209 / DP-214 (ML-8a): the SEO of a product listing in the contracts' shape. The texts
 * (title, description, OG title, OG description) are per language on `ProductListingText`; the
 * canonical path, noindex and OG image are language-neutral columns of `ProductSiteListing`.
 * Saved by CatalogService.updateListingSeo (default language) and the translation endpoints,
 * copied into the publication snapshot, read back by the public catalogue and the SEO overview.
 */
import type { ProductSeo } from "@dream/contracts";

interface SeoTexts {
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgTitle: string | null;
  seoOgDescription: string | null;
}

interface SeoNeutral {
  seoCanonicalPath: string | null;
  seoNoindex: boolean;
  seoOgImageId: string | null;
}

/** The listing's SEO in one language: its text row (null: none yet) and the neutral columns. */
export function listingSeo(neutral: SeoNeutral, text: SeoTexts | null | undefined): ProductSeo {
  return {
    title: text?.seoTitle ?? null,
    description: text?.seoDescription ?? null,
    ogTitle: text?.seoOgTitle ?? null,
    ogDescription: text?.seoOgDescription ?? null,
    canonicalPath: neutral.seoCanonicalPath,
    noindex: neutral.seoNoindex,
    ogImageId: neutral.seoOgImageId,
  };
}

/** The language-neutral SEO columns of a listing. */
export const LISTING_SEO_NEUTRAL_SELECT = {
  seoCanonicalPath: true,
  seoNoindex: true,
  seoOgImageId: true,
} as const;
