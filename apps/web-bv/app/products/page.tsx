import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { filterProducts, paginate, parseBrowse, trail, type BrowseParams } from "@/components/products/browse";
import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { BrowseResults } from "@/components/products/catalog-views";
import { LIVE_LINKS } from "@/components/products/live-links";
import { listCategories, listProducts } from "@/lib/catalog-api";
import { pageMetadata } from "@/lib/seo";

/**
 * DP-207: the list and each category view are their own canonical address (`?category=`, and
 * `?page=` beyond the first); a search result (`?q=`) is never indexed.
 */
export async function generateMetadata({ searchParams }: PageProps<"/products">): Promise<Metadata> {
  await connection();
  const p = parseBrowse(await searchParams);
  return pageMetadata({
    path: "/products",
    query: { category: p.category ?? undefined, page: p.page > 1 ? String(p.page) : undefined },
    title: "Products | Dream Petroleum BV",
    description: "Published products of Dream Petroleum BV.",
    noindex: Boolean(p.q),
  });
}

/**
 * Published BV products (PM-3), live from the platform API: only products approved, published
 * on BV and listed as visible appear. DP-160: browse by category (with its sub-categories),
 * search by name, code or category, and page through the results; every state is a URL.
 * DP-163: category cards with art and sub-category chips above the list, large horizontal
 * product cards from md, two compact cards per row on phones.
 */
export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <CatalogShell crumbs={[{ label: "Home", href: "/" }, { label: "Products" }]}>
      <header className="pb-8 pt-8 sm:pb-12 sm:pt-12">
        <p className="tp-eyebrow">Dream Petroleum BV</p>
        <h1 className="tp-display">Products</h1>
        <p className="tp-lead">
          Base oils, white oils, solvents and specialty products, with technical data and documents
          where available.
        </p>
      </header>
      <Suspense fallback={<ListSkeleton />}>
        <Browse searchParams={searchParams} />
      </Suspense>
    </CatalogShell>
  );
}

async function Browse({ searchParams }: { searchParams: PageProps<"/products">["searchParams"] }) {
  await connection();
  const params = parseBrowse(await searchParams);
  const [list, cats] = await Promise.all([listProducts(), listCategories()]);
  if (!list.ok) {
    return (
      <CatalogNotice title="The product catalogue is not available right now">
        Please try again in a moment.
      </CatalogNotice>
    );
  }
  if (list.data.length === 0) {
    return (
      <CatalogNotice title="No products published yet">
        Products appear here once they are approved and published for this site.
      </CatalogNotice>
    );
  }
  const categories = cats.ok ? cats.data : [];
  // an unknown category (a stale link) shows everything instead of an empty page
  const known = params.category && categories.some((c) => c.slug === params.category);
  const p: BrowseParams = { ...params, category: known ? params.category : null };
  const result = paginate(filterProducts(list.data, categories, p), p.page);
  const path = trail(categories, p.category);
  return <BrowseResults categories={categories} params={p} active={path} result={result} links={LIVE_LINKS} />;
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
