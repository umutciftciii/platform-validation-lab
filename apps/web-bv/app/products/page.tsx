import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import {
  browseHref,
  buildTree,
  filterProducts,
  paginate,
  parseBrowse,
  trail,
  type BrowseParams,
  type CategoryNode,
} from "@/components/products/browse";
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
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      {categories.length ? (
        <CategoryFilter tree={buildTree(categories)} params={p} total={list.data.length} open={path} />
      ) : null}
      <div className={categories.length ? "" : "lg:col-span-2"}>
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
            <ProductGrid products={result.items} />
            <Pager params={p} page={result.page} pages={result.pages} />
          </>
        )}
      </div>
    </div>
  );
}

/** Desktop: a tree in the side column. Mobile: the same links in a closed disclosure. */
function CategoryFilter({
  tree,
  params,
  total,
  open,
}: {
  tree: CategoryNode[];
  params: BrowseParams;
  total: number;
  open: PublicCategory[];
}) {
  const openSlugs = new Set(open.map((c) => c.slug));
  const label = open.at(-1)?.name ?? "All products";
  const list = (
    <ul className="space-y-0.5 text-sm">
      <li>
        <CategoryLink href={browseHref({ q: params.q })} active={!params.category} count={total}>
          All products
        </CategoryLink>
      </li>
      {tree.map((n) => (
        <CategoryItem key={n.slug} node={n} params={params} openSlugs={openSlugs} depth={0} />
      ))}
    </ul>
  );
  return (
    <aside aria-label="Product categories">
      <details className="group rounded-2xl border border-glass/10 bg-glass/[0.03] lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-glass">
          <span>
            <span className="text-steel">Category: </span>
            {label}
          </span>
          <span aria-hidden="true" className="text-steel transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-glass/10 px-2 py-2">{list}</div>
      </details>
      <div className="hidden lg:sticky lg:top-24 lg:block">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-steel">Categories</p>
        {list}
      </div>
    </aside>
  );
}

function CategoryItem({
  node,
  params,
  openSlugs,
  depth,
}: {
  node: CategoryNode;
  params: BrowseParams;
  openSlugs: Set<string>;
  depth: number;
}) {
  const active = params.category === node.slug;
  const expanded = openSlugs.has(node.slug);
  return (
    <li>
      <CategoryLink
        href={browseHref({ category: node.slug, q: params.q })}
        active={active}
        count={node.count}
        depth={depth}
      >
        {node.name}
      </CategoryLink>
      {node.children.length && expanded ? (
        <ul>
          {node.children.map((c) => (
            <CategoryItem key={c.slug} node={c} params={params} openSlugs={openSlugs} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CategoryLink({
  href,
  active,
  count,
  depth = 0,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  depth?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
      className={`flex items-center justify-between gap-3 rounded-lg py-2 pr-3 transition-colors focus-visible:outline-2 focus-visible:outline-amber ${
        active ? "bg-amber/10 text-amber" : "text-glass/85 hover:bg-glass/[0.05] hover:text-glass"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-steel">{count}</span>
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

function ProductGrid({ products }: { products: PublicProductSummary[] }) {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-3">
      {products.map((p) => (
        <li key={p.slug}>
          <Link
            href={`/products/${p.slug}`}
            className="group flex h-full flex-col overflow-hidden rounded-2xl border border-glass/10 bg-glass/[0.03] transition-colors hover:border-amber/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
          >
            <div className="relative aspect-square bg-navy/60">
              {p.cover ? (
                <Image
                  src={imageSrc(p.cover.id, "thumb")}
                  alt={p.cover.altText ?? ""}
                  fill
                  unoptimized
                  sizes="(min-width: 1280px) 25vw, 45vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-5">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-amber sm:text-xs">
                {p.category.name}
              </p>
              <h2 className="text-sm font-medium leading-snug text-glass [font-stretch:108%] sm:text-lg">{p.name}</h2>
              {p.summary ? (
                <p className="hidden text-sm leading-relaxed text-steel sm:line-clamp-3">{p.summary}</p>
              ) : null}
              <p className="mt-auto pt-1 font-mono text-[0.7rem] text-steel/80 sm:pt-2 sm:text-xs">{p.code}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
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
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="h-80 animate-pulse rounded-2xl border border-glass/10 bg-glass/[0.04]" />
      ))}
    </ul>
  );
}
