/**
 * ML-8c (DP-239, ADR-028 D7/D8): the counterparts of a catalogue page in the other PUBLIC
 * languages, for the language selector and hreflang.
 *
 *  - A product's counterpart is the same product (slugs are language-neutral) in a language where
 *    it is published: the API answers `GET /products/<slug>?locale=` only for a live publication
 *    with a complete text in that language. Its hreflang entry is named only when the product is
 *    indexable (no noindex, its own canonical address); both are language-neutral fields of the
 *    snapshot, so the counterpart answers the same.
 *  - Where the product is not published in a language, the selector goes to that language's
 *    product list while it has products, otherwise to its home (never a 404 or a draft address);
 *    hreflang names nothing there.
 *  - The product list's counterpart is the list of a language that has at least one product.
 *  - Only languages that are public now (`visibleLocales`, fail closed): while `nl` is not public
 *    nothing is asked and nothing is returned, so the English pages stay exactly as before.
 */
import { seoIsSelfCanonical } from "@dream/contracts";
import { cache } from "react";

import { getProduct, listProducts } from "@/lib/catalog-api";
import type { HreflangAlternate } from "@/lib/hreflang";
import { isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { visibleLocales } from "@/lib/public-locales";

export interface CatalogueAlternates {
  /** hreflang counterparts (paths inside their language). */
  hreflang: HreflangAlternate[];
  /** Language selector targets (paths inside their language); a language left out goes home. */
  selector: { locale: RouteLocale; path: string }[];
}

const NONE: CatalogueAlternates = { hreflang: [], selector: [] };

/** One read per request and language (the metadata and the page frame share it). */
const productIn = cache((slug: string, locale: RouteLocale) => getProduct(slug, locale));
const listIn = cache((locale: RouteLocale) => listProducts(locale));

async function hasProducts(locale: RouteLocale): Promise<boolean> {
  const list = await listIn(locale);
  return list.ok && list.data.length > 0;
}

async function others(locale: RouteLocale): Promise<RouteLocale[]> {
  return (await visibleLocales()).filter(
    (l): l is RouteLocale => isRouteLocale(l) && l !== locale,
  );
}

export async function productAlternates(
  locale: RouteLocale,
  slug: string,
): Promise<CatalogueAlternates> {
  const langs = await others(locale);
  if (langs.length === 0) return NONE;
  const out: CatalogueAlternates = { hreflang: [], selector: [] };
  await Promise.all(
    langs.map(async (l) => {
      const path = `/products/${slug}`;
      const res = await productIn(slug, l);
      if (res.ok) {
        const indexable = !res.data.seo.noindex && seoIsSelfCanonical(path, res.data.seo.canonicalPath);
        out.hreflang.push({ locale: l, path, indexable });
        out.selector.push({ locale: l, path });
      } else if (await hasProducts(l)) {
        out.selector.push({ locale: l, path: "/products" });
      }
    }),
  );
  return out;
}

export async function listAlternates(locale: RouteLocale): Promise<CatalogueAlternates> {
  const langs = await others(locale);
  if (langs.length === 0) return NONE;
  const out: CatalogueAlternates = { hreflang: [], selector: [] };
  await Promise.all(
    langs.map(async (l) => {
      if (!(await hasProducts(l))) return;
      out.hreflang.push({ locale: l, path: "/products", indexable: true });
      out.selector.push({ locale: l, path: "/products" });
    }),
  );
  return out;
}

/** A stable key of the selector targets (React `cache` compares arguments by identity). */
export function selectorKey(a: CatalogueAlternates): string {
  return a.selector
    .map((s) => `${s.locale}:${s.path}`)
    .sort()
    .join(",");
}

export function parseSelectorKey(key: string): { locale: RouteLocale; path: string }[] {
  if (!key) return [];
  return key.split(",").flatMap((part) => {
    const i = part.indexOf(":");
    const locale = part.slice(0, i);
    return isRouteLocale(locale) ? [{ locale, path: part.slice(i + 1) }] : [];
  });
}
