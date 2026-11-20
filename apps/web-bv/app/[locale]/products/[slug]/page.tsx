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
import { catalogLocale } from "@/lib/catalog-locale";
import { localizeHref, type RouteLocale } from "@/lib/locale-routing";
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
import {
  XREF_PUBLIC_LABELS,
  xrefPublicNotice,
  type PublicCrossReference,
  type PublicDocument,
} from "@dream/contracts";

const product = cache(getProduct);

/**
 * DP-207: the product's title, description, canonical URL and Open Graph image from the published
 * snapshot. An unknown product never reaches this (proxy.ts answers 404); while the API cannot
 * answer, the page is not indexed.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/products/[slug]">): Promise<Metadata> {
  await connection();
  const locale = await catalogLocale();
  const { slug } = await params;
  const res = await product(slug);
  if (!res.ok) return noindexMetadata("Product | Dream Petroleum BV");
  const p = res.data;
  const site = await siteSeo();
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

function baseCrumbs(locale: RouteLocale) {
  return [
    { label: "Home", href: localizeHref(locale, "/") },
    { label: "Products", href: localizeHref(locale, "/products") },
  ];
}

async function ProductDetail({ params }: { params: PageProps<"/[locale]/products/[slug]">["params"] }) {
  await connection();
  const locale = await catalogLocale();
  const links = liveLinks(locale);
  const { slug } = await params;
  const [result, docs, xrefs, cats, list] = await Promise.all([
    product(slug),
    getProductDocuments(slug),
    getProductCrossReferences(slug),
    listCategories(),
    listProducts(),
  ]);
  if (!result.ok && result.reason === "not_found") notFound();
  const [home, products] = baseCrumbs(locale) as [{ label: string; href: string }, { label: string; href: string }];
  if (!result.ok) {
    return (
      <CatalogShell locale={locale} crumbs={[home, products]}>
        <div className="pt-8">
          <CatalogNotice title="This product is not available right now">
            Please try again in a moment, or go back to{" "}
            <Link href={products.href} className="underline">
              all products
            </Link>
            .
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
    <CatalogShell locale={locale} crumbs={[home, products, ...categoryCrumbs, { label: p.name }]}>
      <ProductJsonLd product={p} locale={locale} />
      <ProductDetailView
        p={p}
        related={related}
        links={links}
        extras={
          <>
            {docs.ok && docs.data.length ? <Documents slug={slug} locale={locale} items={docs.data} /> : null}

            {xrefs.ok && xrefs.data.length ? <CrossReferences items={xrefs.data} /> : null}
          </>
        }
      />
    </CatalogShell>
  );
}

const TYPE_LABEL: Record<PublicDocument["type"], string> = {
  TDS: "Technical data sheet",
  SDS: "Safety data sheet",
  COA: "Certificate of analysis",
  OTHER: "Document",
};

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  return (
    <section aria-labelledby="documents" className="mt-12">
      <h2 id="documents" className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">
        Documents
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
                {TYPE_LABEL[d.type]} · PDF · {sizeLabel(d.byteSize)}
                {d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? "" : "s"}` : ""} · revision{" "}
                {d.revisionNumber}
              </p>
            </div>
            {d.downloadable ? (
              <a
                href={documentHref(d.id)}
                download
                className="inline-flex items-center gap-2 rounded-full border border-glass/20 px-4 py-1.5 text-sm text-glass transition-colors hover:border-amber hover:text-amber"
              >
                Download
                <span className="sr-only"> {d.title} (PDF)</span>
              </a>
            ) : d.requestable ? (
              <Link
                href={localizeHref(locale, `/products/${slug}/documents/${d.id}`)}
                className="inline-flex items-center gap-2 rounded-full border border-amber/40 px-4 py-1.5 text-sm text-amber transition-colors hover:border-amber hover:bg-amber/10"
              >
                Request download
                <span className="sr-only"> {d.title} (PDF)</span>
              </Link>
            ) : (
              <span className="text-xs text-steel">
                {d.access === "MEMBERS_ONLY" ? "Available to members soon" : "Not available"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const VERIFIED_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

/**
 * PM-6: cross-references of this product (ADR-015; DP-091 publication rules). The labels and the
 * explanation are fixed, shared texts (@dream/contracts): a similar product is "comparable", never
 * an equivalent; a verified relation names the date of the documented check; third-party names
 * only identify and compare, with no affiliation, endorsement or performance claim.
 */
function CrossReferences({ items }: { items: PublicCrossReference[] }) {
  return (
    <section aria-labelledby="cross-references" className="mt-12">
      <h2 id="cross-references" className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">
        Cross-references
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
                  <span className="mr-1 font-mono text-amber">VERIFIED</span>
                  {XREF_PUBLIC_LABELS.VERIFIED}
                  {x.verifiedAt ? ` on ${VERIFIED_DATE.format(new Date(x.verifiedAt))}` : ""}
                </>
              ) : (
                <>
                  <span className="mr-1 font-mono text-glass/70">SIMILAR</span>
                  {XREF_PUBLIC_LABELS.SIMILAR}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-steel">{xrefPublicNotice("Dream Petroleum BV")}</p>
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
