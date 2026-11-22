import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { ProductDetailView } from "@/components/products/catalog-views";
import { trail } from "@/components/products/browse";
import { liveLinks } from "@/components/products/live-links";
import { ProductJsonLd } from "@/components/seo/json-ld";
import { Rich } from "@/components/i18n/rich";
import { productAlternates, selectorKey } from "@/lib/catalog-alternates";
import { catalogLocale } from "@/lib/catalog-locale";
import { dictionary, formatDate, formatNumber, interpolate, plural } from "@/lib/i18n";
import { DEFAULT_LOCALE, localizeHref, type RouteLocale } from "@/lib/locale-routing";
import { noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";
import {
  documentHref,
  imageSrc,
  getProduct,
  getProductCrossReferences,
  getProductDocuments,
  listCategories,
  listProducts,
} from "@/lib/catalog-api";
import type { PublicCrossReference, PublicDocument } from "@dream/contracts";

/** ML-8c: one read per request and language (metadata and page share it). */
const product = cache((slug: string, locale: RouteLocale) => getProduct(slug, locale));
const alternates = cache((locale: RouteLocale, slug: string) => productAlternates(locale, slug));

/**
 * DP-207: the product's title, description, canonical URL and Open Graph image from the published
 * snapshot. An unknown product never reaches this (proxy.ts answers 404); while the API cannot
 * answer, the page is not indexed.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/products/[slug]">): Promise<Metadata> {
  await connection();
  const locale = await catalogLocale();
  const { slug } = await params;
  const res = await product(slug, locale);
  if (!res.ok) return noindexMetadata(dictionary(locale).meta.productFallback);
  const p = res.data;
  const site = await siteSeo(locale);
  const image = (i: (typeof p.images)[number]) => ({
    url: imageSrc(i.id, "display"),
    alt: i.altText,
    width: i.width,
    height: i.height,
  });
  // DP-209: the published SEO of the product (snapshot); the OG image is one of its images.
  const og = p.seo.ogImageId ? p.images.find((i) => i.id === p.seo.ogImageId) : undefined;
  return pageMetadata(
    {
      path: `/products/${p.slug}`,
      locale,
      title: p.seo.title ?? `${p.name} | ${site.siteName}`,
      description: p.seo.description ?? p.summary,
      noindex: p.seo.noindex,
      canonicalPath: p.seo.canonicalPath,
      ogTitle: p.seo.ogTitle,
      ogDescription: p.seo.ogDescription,
      ogImage: og ? image(og) : null,
      images: p.images.slice(0, 1).map(image),
      // ML-5 / ML-8c: a product has a counterpart only where it is published in that language's
      // catalogue (its own complete text) and indexable there; never a guessed /nl address.
      alternates: (await alternates(locale, p.slug)).hreflang,
    },
    site,
  );
}

/**
 * One published BV product (PM-3): the approved snapshot from the platform API. Unknown,
 * unpublished or hidden products are a 404; nothing of a draft is ever rendered.
 */
export default async function ProductPage({ params }: PageProps<"/[locale]/products/[slug]">) {
  const locale = await catalogLocale();
  return (
    <Suspense
      fallback={
        <CatalogShell locale={locale} crumbs={baseCrumbs(locale)}>
          <DetailSkeleton />
        </CatalogShell>
      }
    >
      <ProductDetail params={params} />
    </Suspense>
  );
}

/** ML-8c: the language selector targets of this product (same product, list or home). */
function languagesOf(locale: RouteLocale, slug: string) {
  return async () => selectorKey(await alternates(locale, slug));
}

function baseCrumbs(locale: RouteLocale) {
  const ui = dictionary(locale).common;
  return [
    { label: ui.home, href: localizeHref(locale, "/") },
    { label: ui.products, href: localizeHref(locale, "/products") },
  ];
}

async function ProductDetail({ params }: { params: PageProps<"/[locale]/products/[slug]">["params"] }) {
  await connection();
  const locale = await catalogLocale();
  const links = liveLinks(locale);
  const { slug } = await params;
  const [result, docs, xrefs, cats, list] = await Promise.all([
    product(slug, locale),
    getProductDocuments(slug, locale),
    getProductCrossReferences(slug, locale),
    listCategories(locale),
    listProducts(locale),
  ]);
  if (!result.ok && result.reason === "not_found") notFound();
  const [home, products] = baseCrumbs(locale) as [{ label: string; href: string }, { label: string; href: string }];
  if (!result.ok) {
    const ui = dictionary(locale).product;
    return (
      <CatalogShell locale={locale} crumbs={[home, products]} languages={languagesOf(locale, slug)}>
        <div className="pt-8">
          <CatalogNotice title={ui.unavailableTitle}>
            <Rich
              text={ui.unavailableText}
              values={{
                all: (
                  <Link href={products.href} className="underline">
                    {ui.allProducts}
                  </Link>
                ),
              }}
            />
          </CatalogNotice>
        </div>
      </CatalogShell>
    );
  }
  const p = result.data;
  // DP-162: Home / Products / <category chain> / <product>, each category a filtered list
  const chain = trail(cats.ok ? cats.data : [], p.category.slug);
  const categoryCrumbs = (chain.length ? chain : [{ slug: p.category.slug, name: p.category.name }]).map(
    (c) => ({ label: c.name, href: links.list({ category: c.slug }) }),
  );
  const related = list.ok
    ? list.data.filter((x) => x.category.slug === p.category.slug && x.slug !== p.slug).slice(0, 4)
    : [];
  return (
    <CatalogShell
      locale={locale}
      crumbs={[home, products, ...categoryCrumbs, { label: p.name }]}
      languages={languagesOf(locale, slug)}
    >
      <ProductJsonLd product={p} locale={locale} />
      <ProductDetailView
        p={p}
        related={related}
        links={links}
        locale={locale}
        extras={
          <>
            {docs.ok && docs.data.length ? <Documents slug={slug} locale={locale} items={docs.data} /> : null}

            {xrefs.ok && xrefs.data.length ? <CrossReferences items={xrefs.data} locale={locale} /> : null}
          </>
        }
      />
    </CatalogShell>
  );
}

/** "1.4 MB" · "1,4 MB" (ML-6: the locale's decimal separator; units stay as they are). */
function sizeLabel(bytes: number, locale: RouteLocale): string {
  return bytes >= 1024 * 1024
    ? `${formatNumber(locale, bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} MB`
    : `${formatNumber(locale, Math.max(1, Math.round(bytes / 1024)), { useGrouping: false })} KB`;
}

/**
 * PM-5: documents of this product. PUBLIC ones link to a download; lead-gated ones (DP-042) to the
 * short request form; members-only ones say why they are closed.
 */
function Documents({
  slug,
  locale,
  items,
}: {
  slug: string;
  locale: RouteLocale;
  items: PublicDocument[];
}) {
  const ui = dictionary(locale).documents;
  return (
    <section aria-labelledby="documents" className="mt-12">
      <h2 id="documents" className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">
        {ui.heading}
      </h2>
      <ul className="mt-3 divide-y divide-glass/10 border-y border-glass/10">
        {items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
            <div className="min-w-0">
              <p className="text-glass">
                <span className="mr-2 font-mono text-xs text-amber">{d.type === "OTHER" ? "PDF" : d.type}</span>
                {d.title}
              </p>
              <p className="text-xs text-steel">
                {ui.type[d.type]} · PDF · {sizeLabel(d.byteSize, locale)}
                {/* ML-8c: documents are not translated; outside English their language is named
                    (ML-9 adds a language per document). */}
                {locale !== DEFAULT_LOCALE ? (
                  <>
                    {" · "}
                    <span lang="en">{ui.inEnglish}</span>
                  </>
                ) : null}
                {d.pageCount ? ` · ${plural(locale, ui.pages, d.pageCount)}` : ""} ·{" "}
                {interpolate(ui.revision, { number: d.revisionNumber })}
              </p>
            </div>
            {d.downloadable ? (
              <a
                href={documentHref(d.id)}
                download
                className="inline-flex items-center gap-2 rounded-full border border-glass/20 px-4 py-1.5 text-sm text-glass transition-colors hover:border-amber hover:text-amber"
              >
                {ui.download}
                <span className="sr-only"> {interpolate(ui.fileForScreenReaders, { title: d.title })}</span>
              </a>
            ) : d.requestable ? (
              <Link
                href={localizeHref(locale, `/products/${slug}/documents/${d.id}`)}
                className="inline-flex items-center gap-2 rounded-full border border-amber/40 px-4 py-1.5 text-sm text-amber transition-colors hover:border-amber hover:bg-amber/10"
              >
                {ui.requestDownload}
                <span className="sr-only"> {interpolate(ui.fileForScreenReaders, { title: d.title })}</span>
              </Link>
            ) : (
              <span className="text-xs text-steel">
                {d.access === "MEMBERS_ONLY" ? ui.membersSoon : ui.notAvailable}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * PM-6: cross-references of this product (ADR-015; DP-091 publication rules). The labels and the
 * explanation are fixed, shared texts (@dream/contracts): a similar product is "comparable", never
 * an equivalent; a verified relation names the date of the documented check; third-party names
 * only identify and compare, with no affiliation, endorsement or performance claim.
 */
function CrossReferences({ items, locale }: { items: PublicCrossReference[]; locale: RouteLocale }) {
  // ML-6: English is the approved text of @dream/contracts (lib/i18n/en.ts refers to it).
  const ui = dictionary(locale).crossReferences;
  return (
    <section aria-labelledby="cross-references" className="mt-12">
      <h2 id="cross-references" className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">
        {ui.heading}
      </h2>
      <ul className="mt-3 divide-y divide-glass/10 border-y border-glass/10">
        {items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
            <div className="min-w-0">
              <p className="text-glass">
                {x.brand} {x.product}
                {x.grade ? <span className="text-steel"> · {x.grade}</span> : null}
              </p>
              <p className="text-xs text-steel">{x.manufacturer}</p>
            </div>
            <p className="text-xs text-steel">
              {x.relation === "VERIFIED" ? (
                <>
                  <span className="mr-1 font-mono text-amber">{ui.verifiedBadge}</span>
                  {ui.verified}
                  {x.verifiedAt ? interpolate(ui.verifiedOn, { date: formatDate(locale, x.verifiedAt) }) : ""}
                </>
              ) : (
                <>
                  <span className="mr-1 font-mono text-glass/70">{ui.similarBadge}</span>
                  {ui.similar}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-steel">
        {interpolate(ui.notice, { company: "Dream Petroleum BV" })}
      </p>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-10 pt-8 lg:grid-cols-2" aria-busy="true">
      <div className="aspect-square animate-pulse rounded-2xl bg-glass/[0.05]" />
      <div className="space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-glass/[0.08]" />
        <div className="h-12 w-3/4 animate-pulse rounded bg-glass/[0.08]" />
        <div className="h-24 animate-pulse rounded bg-glass/[0.05]" />
      </div>
    </div>
  );
}
