import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import {
  canonicalBrowse,
  filterProducts,
  paginate,
  parseBrowse,
  trail,
  type BrowseParams,
} from "@/components/products/browse";
import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { BrowseResults } from "@/components/products/catalog-views";
import { liveLinks } from "@/components/products/live-links";
import { listAlternates, selectorKey } from "@/lib/catalog-alternates";
import { listCategories, listProducts } from "@/lib/catalog-api";
import { catalogLocale } from "@/lib/catalog-locale";
import { dictionary, interpolate } from "@/lib/i18n";
import { DEFAULT_LOCALE, localizeHref, type RouteLocale } from "@/lib/locale-routing";
import { pageMetadata, siteSeo } from "@/lib/seo";

/**
 * The catalogue reads of one request, shared by the metadata and the list (one API read each).
 * ML-8c: in the page's language (the default language is asked as before).
 */
const readCatalog = cache((locale: RouteLocale) =>
  Promise.all([listProducts(locale), listCategories(locale)]),
);
const alternates = cache((locale: RouteLocale) => listAlternates(locale));

/**
 * DP-207: the list and each category view are their own canonical address (`?category=`, and
 * `?page=` beyond the first); a search result (`?q=`) is never indexed. ML-4: a category without
 * live products and a page beyond the last name the view actually shown (`canonicalBrowse`).
 */
export async function generateMetadata({ searchParams }: PageProps<"/[locale]/products">): Promise<Metadata> {
  await connection();
  const locale = await catalogLocale();
  const p = parseBrowse(await searchParams);
  const [site, [list, cats], others] = await Promise.all([
    siteSeo(locale),
    readCatalog(locale),
    alternates(locale),
  ]);
  const canonical = canonicalBrowse(p, list.ok ? list.data : null, cats.ok ? cats.data : []);
  const meta = dictionary(locale).meta;
  return pageMetadata(
    {
      path: "/products",
      locale,
      query: {
        category: canonical.category ?? undefined,
        page: canonical.page > 1 ? String(canonical.page) : undefined,
      },
      title: interpolate(meta.products, { site: site.siteName }),
      description: interpolate(meta.productsDescription, { site: site.siteName }),
      noindex: Boolean(p.q),
      // ML-8c: the lists of the other public languages that have products (only the unfiltered
      // list names them; pageMetadata drops hreflang for a view with a query).
      alternates: others.hreflang,
    },
    site,
  );
}

/**
 * Published BV products (PM-3), live from the platform API: only products approved, published
 * on BV and listed as visible appear. DP-160: browse by category (with its sub-categories),
 * search by name, code or category, and page through the results; every state is a URL.
 * DP-163: category cards with art and sub-category chips above the list, large horizontal
 * product cards from md, two compact cards per row on phones.
 */
export default async function ProductsPage({ searchParams }: PageProps<"/[locale]/products">) {
  const locale = await catalogLocale();
  const ui = dictionary(locale);
  return (
    <CatalogShell
      locale={locale}
      crumbs={[{ label: ui.common.home, href: localizeHref(locale, "/") }, { label: ui.common.products }]}
      languages={async () => selectorKey(await alternates(locale))}
    >
      <header className="pb-8 pt-8 sm:pb-12 sm:pt-12">
        <p className="tp-eyebrow">{ui.catalogue.eyebrow}</p>
        <h1 className="tp-display">{ui.catalogue.title}</h1>
        <p className="tp-lead">{ui.catalogue.lead}</p>
      </header>
      <Suspense fallback={<ListSkeleton />}>
        <Browse searchParams={searchParams} />
      </Suspense>
    </CatalogShell>
  );
}

async function Browse({ searchParams }: Pick<PageProps<"/[locale]/products">, "searchParams">) {
  await connection();
  const locale = await catalogLocale();
  const params = parseBrowse(await searchParams);
  const [list, cats] = await readCatalog(locale);
  const ui = dictionary(locale);
  // ML-8c: a language without a catalogue (not public, or no product published in it); the proxy
  // already answers these with a real 404.
  if (!list.ok && list.reason === "not_found") notFound();
  if (list.ok && list.data.length === 0 && locale !== DEFAULT_LOCALE) notFound();
  if (!list.ok) {
    return <CatalogNotice title={ui.catalogue.unavailableTitle}>{ui.common.tryAgain}</CatalogNotice>;
  }
  if (list.data.length === 0) {
    return <CatalogNotice title={ui.catalogue.emptyTitle}>{ui.catalogue.emptyText}</CatalogNotice>;
  }
  const categories = cats.ok ? cats.data : [];
  // an unknown category (a stale link) shows everything instead of an empty page
  const known = params.category && categories.some((c) => c.slug === params.category);
  const p: BrowseParams = { ...params, category: known ? params.category : null };
  const result = paginate(filterProducts(list.data, categories, p), p.page);
  const path = trail(categories, p.category);
  return (
    <BrowseResults
      categories={categories}
      params={p}
      active={path}
      result={result}
      links={liveLinks(locale)}
      locale={locale}
    />
  );
}

function ListSkeleton() {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-5 lg:grid-cols-2" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="h-72 animate-pulse rounded-2xl border border-glass/10 bg-glass/[0.04]" />
      ))}
    </ul>
  );
}
