import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import {
  browseHref,
  categoryLabel,
  chipRows,
  filterProducts,
  paginate,
  packSize,
  parseBrowse,
  topCategories,
  trail,
  type BrowseParams,
} from "@/components/products/browse";
import { cardImage, categoryArt } from "@/components/products/catalog-visuals";
import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { imageSrc, listCategories, listProducts } from "@/lib/catalog-api";
import type { PublicCategory, PublicProductSummary } from "@dream/contracts";

export const metadata: Metadata = {
  title: "Products | Dream Petroleum BV",
  description: "Published products of Dream Petroleum BV.",
  robots: { index: false, follow: false },
};

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
  const current = path.at(-1) ?? null;
  return (
    <div>
      {categories.length ? <CategoryStrip categories={categories} params={p} active={path} /> : null}
      <SearchBar params={p} />
      <p className="mt-4 text-sm text-steel" role="status">
        {result.total === 1 ? "1 product" : `${result.total} products`}
        {current ? ` in ${current.name}` : ""}
        {p.q ? ` matching “${p.q}”` : ""}
      </p>
      {result.total === 0 ? (
        <div className="mt-6">
          <CatalogNotice title="No products match">
            Try another word or{" "}
            <Link href={browseHref({ category: p.category })} className="underline">
              clear the search
            </Link>
            .
          </CatalogNotice>
        </div>
      ) : (
        <>
          <ProductGrid products={result.items} categories={categories} />
          <Pager params={p} page={result.page} pages={result.pages} />
        </>
      )}
    </div>
  );
}

/**
 * DP-163: the top-level categories as image cards in one row (scrolls sideways on narrow screens),
 * then, while a category is chosen, its sub-categories as chips. Names and counts are the public
 * API's (live products only); long names stop after two lines and keep their full text in the
 * accessible name.
 */
function CategoryStrip({
  categories,
  params,
  active,
}: {
  categories: PublicCategory[];
  params: BrowseParams;
  active: PublicCategory[];
}) {
  const activeSlugs = new Set(active.map((c) => c.slug));
  const rows = chipRows(categories, params.category);
  const countLabel = (n: number) => (n === 1 ? "1 product" : `${n} products`);
  return (
    <nav aria-label="Product categories" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Categories</h2>
        {params.category ? (
          <Link
            href={browseHref({ q: params.q })}
            className="text-sm text-amber underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-amber"
          >
            All products
          </Link>
        ) : null}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:gap-2.5 sm:px-0">
        {topCategories(categories).map((c) => {
          const art = categoryArt(c.slug);
          const on = activeSlugs.has(c.slug);
          return (
            <li key={c.slug} className="w-24 shrink-0 snap-start sm:w-28">
              <Link
                href={browseHref({ category: c.slug, q: params.q })}
                aria-current={params.category === c.slug ? "page" : undefined}
                aria-label={`${c.name}, ${countLabel(c.count)}`}
                title={c.name}
                className={`flex h-full flex-col overflow-hidden rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                  on ? "border-amber/70 bg-amber/[0.06]" : "border-glass/10 bg-glass/[0.03] hover:border-amber/40"
                }`}
              >
                <span className="relative block aspect-square bg-navy">
                  {art ? (
                    <Image
                      src={art}
                      alt=""
                      fill
                      unoptimized
                      loading="eager"
                      sizes="112px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 bg-gradient-to-br from-[#0f2338] to-navy" />
                  )}
                </span>
                <span className="flex flex-1 flex-col justify-between gap-0.5 px-2 pb-2 pt-1.5 sm:px-2.5">
                  <span
                    aria-hidden="true"
                    className={`line-clamp-2 min-h-[2.5em] text-[0.7rem] font-medium leading-[1.25] sm:text-xs ${on ? "text-amber" : "text-glass"}`}
                  >
                    {c.name}
                  </span>
                  <span aria-hidden="true" className="font-mono text-[0.6rem] tabular-nums text-steel sm:text-[0.65rem]">
                    {c.count}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rows.map((r) => (
        <ul key={r.parent.slug} aria-label={`${r.parent.name} sub-categories`} className="mt-3 flex flex-wrap gap-2">
          <li>
            <Chip href={browseHref({ category: r.parent.slug, q: params.q })} on={params.category === r.parent.slug}>
              All {r.parent.name}
              <span className="font-mono text-xs text-steel">{r.parent.count}</span>
            </Chip>
          </li>
          {r.children.map((c) => (
            <li key={c.slug}>
              <Chip href={browseHref({ category: c.slug, q: params.q })} on={activeSlugs.has(c.slug)}>
                {c.name}
                <span className="font-mono text-xs text-steel">{c.count}</span>
              </Chip>
            </li>
          ))}
        </ul>
      ))}
    </nav>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
        on ? "border-amber bg-amber/10 text-amber" : "border-glass/15 text-glass/85 hover:border-amber/60 hover:text-glass"
      }`}
    >
      {children}
    </Link>
  );
}

/** A plain GET form: works without JavaScript and keeps the chosen category. */
function SearchBar({ params }: { params: BrowseParams }) {
  return (
    <form action="/products" method="get" role="search" className="flex gap-2">
      {params.category ? <input type="hidden" name="category" value={params.category} /> : null}
      <label className="min-w-0 flex-1">
        <span className="sr-only">Search products</span>
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          maxLength={80}
          placeholder="Search by name or code"
          className="h-11 w-full rounded-full border border-glass/15 bg-glass/[0.04] px-5 text-sm text-glass placeholder:text-steel/80 focus:border-amber focus:outline-none"
        />
      </label>
      <button
        type="submit"
        className="h-11 shrink-0 rounded-full bg-amber px-5 text-sm font-medium text-ink transition-colors hover:bg-amber/90"
      >
        Search
      </button>
    </form>
  );
}

/**
 * DP-163: mobile, two narrow cards per row (image above, title reserved for three lines so the
 * codes line up); from md, large horizontal cards (bottle left, information right), two per row
 * from lg. The whole card links to the product page.
 */
function ProductGrid({ products, categories }: { products: PublicProductSummary[]; categories: PublicCategory[] }) {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-5 lg:grid-cols-2">
      {products.map((p) => {
        const img = cardImage(p);
        return (
          <li key={p.slug} className="flex">
            <Link
              href={`/products/${p.slug}`}
              className="group grid w-full grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-glass/10 bg-glass/[0.03] transition-colors hover:border-amber/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber md:grid-cols-[42%_minmax(0,1fr)] md:grid-rows-1"
            >
              <div className="relative aspect-[4/5] bg-navy/60">
                {img.kind === "cover" ? (
                  <Image
                    src={imageSrc(img.id, "thumb")}
                    alt={img.altText ?? ""}
                    fill
                    unoptimized
                    sizes="(min-width: 1024px) 22vw, (min-width: 768px) 40vw, 45vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : img.kind === "sample" ? (
                  <Image
                    src={img.src}
                    alt=""
                    fill
                    unoptimized
                    sizes="(min-width: 1024px) 22vw, (min-width: 768px) 40vw, 45vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 p-3 sm:p-4 md:gap-2.5 md:p-6">
                {/* DP-167: on phones the category path takes exactly two lines (ellipsis after), so
                    the codes of a row line up; the full path stays in the DOM and the title. */}
                <p
                  title={categoryLabel(categories, p.category)}
                  className="line-clamp-2 min-h-[calc(1.4em*2)] text-[0.65rem] font-semibold uppercase leading-[1.4] tracking-[0.12em] text-amber sm:text-xs md:line-clamp-none md:min-h-0"
                >
                  {categoryLabel(categories, p.category)}
                </p>
                <h2 className="line-clamp-4 min-h-[calc(1.35em*4)] text-sm font-medium leading-[1.35] text-glass [font-stretch:108%] sm:text-base md:line-clamp-3 md:min-h-0 md:text-xl md:leading-snug">
                  {p.name}
                </h2>
                {/* DP-169: on phones the pack size gets its own line, so variants that share one
                    image stay distinguishable when a long name is cut; the line is reserved on every
                    card to keep the codes aligned. Already part of the name for screen readers. */}
                <p
                  aria-hidden="true"
                  className="min-h-[1.4em] text-xs font-semibold leading-[1.4] text-glass/90 md:hidden"
                >
                  {packSize(p.name) ?? ""}
                </p>
                {/* DP-167: long codes (PJ-PHARMA-YELLOW-165KG) wrap on phones; two reserved lines keep the
                    codes of a row on the same top line. The code is never cut. */}
                <p className="mt-auto min-h-[calc(1.35em*2+0.25rem)] break-words pt-1 font-mono text-[0.7rem] leading-[1.35] text-steel/80 sm:text-xs md:mt-0 md:min-h-0 md:pt-0 md:text-sm md:text-steel">
                  {p.code}
                </p>
                {p.summary ? (
                  <p className="hidden text-sm leading-relaxed text-steel md:line-clamp-3">{p.summary}</p>
                ) : null}
                {p.hasTechnicalData || p.hasDocuments ? (
                  <ul aria-label="Available content" className="mt-1 hidden flex-wrap gap-1.5 md:flex">
                    {p.hasTechnicalData ? <Indicator>Technical data</Indicator> : null}
                    {p.hasDocuments ? <Indicator>Documents</Indicator> : null}
                  </ul>
                ) : null}
                <span aria-hidden="true" className="mt-auto hidden pt-2 text-sm font-medium text-amber md:block">
                  View product →
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Indicator({ children }: { children: ReactNode }) {
  return <li className="rounded-full border border-glass/15 px-2.5 py-1 text-xs text-glass">{children}</li>;
}

function Pager({ params, page, pages }: { params: BrowseParams; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (n: number) => browseHref({ ...params, page: n });
  const btn = "inline-flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-sm transition-colors";
  return (
    <nav aria-label="Pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={`${btn} border-glass/15 text-glass hover:border-amber`} rel="prev">
          <span aria-hidden="true">←</span>
          <span className="sr-only">Previous page</span>
        </Link>
      ) : null}
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <Link
          key={n}
          href={href(n)}
          aria-current={n === page ? "page" : undefined}
          className={`${btn} ${n === page ? "border-amber bg-amber/10 text-amber" : "border-glass/15 text-glass hover:border-amber"}`}
        >
          {n}
        </Link>
      ))}
      {page < pages ? (
        <Link href={href(page + 1)} className={`${btn} border-glass/15 text-glass hover:border-amber`} rel="next">
          <span aria-hidden="true">→</span>
          <span className="sr-only">Next page</span>
        </Link>
      ) : null}
    </nav>
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
