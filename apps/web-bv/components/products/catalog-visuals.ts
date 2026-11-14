/**
 * DP-163: static art of the BV catalogue (apps/web-bv/public/media/catalog/).
 *
 *  - Category art: one illustration per existing top-level category slug. A category without art
 *    shows a plain placeholder; names and counts always come from the public API.
 *  - Product design samples: bottle mockups whose label carries the exact company logo SVG and the
 *    product code of the catalogue record, matched by `Product.code` (never by name).
 *
 * A design sample never replaces a product's own published image: it is shown only when the
 * product has no cover, and nothing here touches media records. ICCSYN-6-G3 and ICCSYN-6-G3P are
 * different products with their own samples.
 */
import type { PublicProductSummary } from "@dream/contracts";

const BASE = "/media/catalog";

export const CATEGORY_ART: Readonly<Record<string, string>> = {
  "base-oil": `${BASE}/categories/base-oil.webp`,
  "white-oil": `${BASE}/categories/white-oil.webp`,
  "transformer-oil": `${BASE}/categories/transformer-oil.webp`,
  "solvent-oil": `${BASE}/categories/solvent-oil.webp`,
  vaseline: `${BASE}/categories/vaseline.webp`,
  "lubrication-oil": `${BASE}/categories/lubrication-oil.webp`,
  "rubber-filled-with-oil-agent": `${BASE}/categories/rubber-filled-with-oil-agent.webp`,
  "sustainable-aviation-fuel": `${BASE}/categories/sustainable-aviation-fuel.webp`,
};

export const PRODUCT_SAMPLES: Readonly<Record<string, string>> = {
  "G1-SN150": `${BASE}/product-samples/g1-sn150.webp`,
  "ICCSYN-10-G3P": `${BASE}/product-samples/iccsyn-10-g3p.webp`,
  "ICCSYN-6-G3": `${BASE}/product-samples/iccsyn-6-g3.webp`,
  "ICCSYN-6-G3P": `${BASE}/product-samples/iccsyn-6-g3p.webp`,
};

export function categoryArt(slug: string): string | null {
  return Object.hasOwn(CATEGORY_ART, slug) ? (CATEGORY_ART[slug] ?? null) : null;
}

export type CardImage =
  | { kind: "cover"; id: string; altText: string | null }
  | { kind: "sample"; src: string }
  | { kind: "none" };

/** The product's own cover first; a design sample only when it has none. */
export function cardImage(p: Pick<PublicProductSummary, "code" | "cover">): CardImage {
  if (p.cover) return { kind: "cover", id: p.cover.id, altText: p.cover.altText };
  const src = Object.hasOwn(PRODUCT_SAMPLES, p.code) ? PRODUCT_SAMPLES[p.code] : undefined;
  return src ? { kind: "sample", src } : { kind: "none" };
}
