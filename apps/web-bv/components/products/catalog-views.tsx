/**
 * Shared views of the BV catalogue (DP-160, DP-162, DP-163; DP-173). The live product pages and
 * the company preview render the same markup; everything that differs is passed in: the URLs
 * (`links`), a line on the cards (`badge`), the blocks of the product page (`afterIntro`,
 * `extras`) and whether the enquiry button shows. The live pages pass the live URLs and their
 * documents and cross-references, so their output is unchanged.
 */
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  categoryLabel,
  chipRows,
  packSize,
  topCategories,
  type BrowseParams,
} from "@/components/products/browse";
import { cardImage, categoryArt } from "@/components/products/catalog-visuals";
import { CatalogNotice } from "@/components/products/catalog-shell";
import { formatSpecValue } from "@/components/products/format";
import type { PublicCategory, PublicProduct, PublicProductSummary } from "@dream/contracts";

/** Where the catalogue's links and images point (live site or preview). */
export interface CatalogLinks {
  list(p: Partial<BrowseParams>): string;
  product(slug: string): string;
  searchAction: string;
  image(id: string, variant: "thumb" | "display"): string;
}

/** The list under the page header: categories, search, count, cards and pages. */
export function BrowseResults({
  categories,
  params,
  active,
  result,
  links,
  badge,
}: {
  categories: PublicCategory[];
  params: BrowseParams;
  active: PublicCategory[];
  result: { items: PublicProductSummary[]; total: number; page: number; pages: number };
  links: CatalogLinks;
  badge?: (slug: string) => ReactNode;
}) {
  const current = active.at(-1) ?? null;
  return (
    <div>
      {categories.length ? (
        <CategoryStrip categories={categories} params={params} active={active} links={links} />
      ) : null}
      <SearchBar params={params} links={links} />
      <p className="mt-4 text-sm text-steel" role="status">
        {result.total === 1 ? "1 product" : `${result.total} products`}
        {current ? ` in ${current.name}` : ""}
        {params.q ? ` matching “${params.q}”` : ""}
      </p>
      {result.total === 0 ? (
        <div className="mt-6">
          <CatalogNotice title="No products match">
            Try another word or{" "}
            <Link href={links.list({ category: params.category })} className="underline">
              clear the search
            </Link>
            .
          </CatalogNotice>
        </div>
      ) : (
        <>
          <ProductGrid products={result.items} categories={categories} links={links} badge={badge} />
          <Pager params={params} page={result.page} pages={result.pages} links={links} />
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
  links,
}: {
  categories: PublicCategory[];
  params: BrowseParams;
  active: PublicCategory[];
  links: CatalogLinks;
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
            href={links.list({ q: params.q })}
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
                href={links.list({ category: c.slug, q: params.q })}
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
            <Chip href={links.list({ category: r.parent.slug, q: params.q })} on={params.category === r.parent.slug}>
              All {r.parent.name}
              <span className="font-mono text-xs text-steel">{r.parent.count}</span>
            </Chip>
          </li>
          {r.children.map((c) => (
            <li key={c.slug}>
              <Chip href={links.list({ category: c.slug, q: params.q })} on={activeSlugs.has(c.slug)}>
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
function SearchBar({ params, links }: { params: BrowseParams; links: CatalogLinks }) {
  return (
    <form action={links.searchAction} method="get" role="search" className="flex gap-2">
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
function ProductGrid({
  products,
  categories,
  links,
  badge,
}: {
  products: PublicProductSummary[];
  categories: PublicCategory[];
  links: CatalogLinks;
  /** DP-173: an extra line on the card (the preview's review state); none on the live site. */
  badge?: (slug: string) => ReactNode;
}) {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-5 lg:grid-cols-2">
      {products.map((p) => {
        const img = cardImage(p);
        return (
          <li key={p.slug} className="flex">
            <Link
              href={links.product(p.slug)}
              className="group grid w-full grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-glass/10 bg-glass/[0.03] transition-colors hover:border-amber/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber md:grid-cols-[42%_minmax(0,1fr)] md:grid-rows-1"
            >
              <div className="relative aspect-[4/5] bg-navy/60">
                {img.kind === "cover" ? (
                  <Image
                    src={links.image(img.id, "thumb")}
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
                {badge ? badge(p.slug) : null}
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

function Pager({
  params,
  page,
  pages,
  links,
}: {
  params: BrowseParams;
  page: number;
  pages: number;
  links: CatalogLinks;
}) {
  if (pages <= 1) return null;
  const href = (n: number) => links.list({ ...params, page: n });
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

/**
 * The product page body (DP-162): images, name, code, texts, the enquiry button, technical data,
 * then `extras` (the live documents and cross-references; the preview's own blocks) and the
 * related products. `afterIntro` sits under the texts (the preview's research proposal).
 */
export function ProductDetailView({
  p,
  related,
  links,
  enquiry = true,
  afterIntro,
  extras,
}: {
  p: PublicProduct;
  related: PublicProductSummary[];
  links: CatalogLinks;
  enquiry?: boolean;
  afterIntro?: ReactNode;
  extras?: ReactNode;
}) {
  const [cover, ...gallery] = p.images;
  const spec = p.specs.filter((s) => s.basis !== "TYPICAL");
  const typical = p.specs.filter((s) => s.basis === "TYPICAL");
  return (
    <>
      <article className="grid grid-cols-1 gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:pt-12">
        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-glass/10 bg-navy/60">
            {cover ? (
              <Image
                src={links.image(cover.id, "display")}
                alt={cover.altText ?? p.name}
                fill
                unoptimized
                priority
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover"
              />
            ) : null}
          </div>
          {gallery.length ? (
            <ul className="grid grid-cols-4 gap-3">
              {gallery.map((img) => (
                <li
                  key={img.id}
                  className="relative aspect-square overflow-hidden rounded-xl border border-glass/10 bg-navy/60"
                >
                  <Image
                    src={links.image(img.id, "thumb")}
                    alt={img.altText ?? ""}
                    fill
                    unoptimized
                    sizes="25vw"
                    className="object-cover"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="min-w-0">
          <Link href={links.list({ category: p.category.slug })} className="tp-eyebrow hover:underline">
            {p.category.name}
          </Link>
          <h1 className="mt-3 text-[clamp(2rem,4vw,3.25rem)] font-medium leading-[1.05] [font-stretch:108%] [text-wrap:balance]">
            {p.name}
          </h1>
          <p className="mt-3 font-mono text-sm text-steel">{p.code}</p>
          {p.summary ? <p className="tp-lead">{p.summary}</p> : null}
          {p.description ? (
            <p className="mt-4 whitespace-pre-line leading-relaxed text-[#cdd8e2]">{p.description}</p>
          ) : null}
          {afterIntro}
          {enquiry ? (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="inline-flex h-11 items-center rounded-full bg-amber px-6 text-sm font-medium text-ink transition-colors hover:bg-amber/90"
              >
                Ask about this product
              </Link>
            </div>
          ) : null}

          <section aria-labelledby="specs" className="mt-12">
            <h2 id="specs" className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">
              Technical data
            </h2>
            {spec.length || typical.length ? (
              <>
                {spec.length ? <SpecTable title="Specification" note={null} specs={spec} /> : null}
                {typical.length ? (
                  <SpecTable
                    title="Typical values"
                    note="Typical values are for information only; they are not specification limits."
                    specs={typical}
                  />
                ) : null}
              </>
            ) : (
              <div className="mt-3 rounded-2xl border border-glass/10 bg-glass/[0.03] px-5 py-6">
                <p className="text-glass">Technical data for this product is available on request.</p>
                <p className="mt-1 text-sm text-steel">
                  Our team will share the current specification and documents for your application.
                </p>
              </div>
            )}
          </section>

          {extras}
        </div>
      </article>

      {related.length ? <Related items={related} category={p.category} links={links} /> : null}
    </>
  );
}

type Spec = PublicProduct["specs"][number];

/** One table per kind of value (DP-156): specification limits, then typical values. */
function SpecTable({ title, note, specs }: { title: string; note: string | null; specs: Spec[] }) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-medium text-glass">{title}</h3>
      {note ? <p className="mt-1 text-xs text-steel">{note}</p> : null}
      <dl className="mt-2 divide-y divide-glass/10 border-y border-glass/10">
        {specs.map((s) => (
          <div
            key={`${s.key}:${s.basis}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-0.5 py-3"
          >
            <dt className="text-sm text-[#cdd8e2]">{s.name}</dt>
            <dd className="text-right tabular-nums text-glass">{formatSpecValue(s)}</dd>
            {s.testMethod ? (
              <dd className="col-span-2 text-xs text-steel/80">Test method: {s.testMethod}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

function Related({
  items,
  category,
  links,
}: {
  items: PublicProductSummary[];
  category: { slug: string; name: string };
  links: CatalogLinks;
}) {
  return (
    <section aria-labelledby="related" className="mt-20 border-t border-glass/10 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="related" className="tp-title">
          More in {category.name}
        </h2>
        <Link href={links.list({ category: category.slug })} className="text-sm text-amber hover:underline">
          View all
        </Link>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {items.map((r) => (
          <li key={r.slug}>
            <Link
              href={links.product(r.slug)}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-glass/10 bg-glass/[0.03] transition-colors hover:border-amber/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              <div className="relative aspect-square bg-navy/60">
                {r.cover ? (
                  <Image
                    src={links.image(r.cover.id, "thumb")}
                    alt={r.cover.altText ?? ""}
                    fill
                    unoptimized
                    sizes="(min-width: 1024px) 20vw, 45vw"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="p-4">
                <p className="text-sm font-medium leading-snug text-glass">{r.name}</p>
                <p className="mt-1 font-mono text-xs text-steel/80">{r.code}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

