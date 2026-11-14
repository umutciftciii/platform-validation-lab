import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { formatSpecValue } from "@/components/products/format";
import { browseHref, trail } from "@/components/products/browse";
import {
  documentHref,
  getProduct,
  getProductCrossReferences,
  getProductDocuments,
  imageSrc,
  listCategories,
  listProducts,
} from "@/lib/catalog-api";
import {
  XREF_PUBLIC_LABELS,
  xrefPublicNotice,
  type PublicCrossReference,
  type PublicDocument,
  type PublicProduct,
  type PublicProductSummary,
} from "@dream/contracts";

const product = cache(getProduct);

/** The product's own browser title; the catalogue stays out of search engines until launch. */
export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  await connection();
  const res = await product((await params).slug);
  return {
    title: res.ok ? `${res.data.name} | Dream Petroleum BV` : "Product | Dream Petroleum BV",
    ...(res.ok && res.data.summary ? { description: res.data.summary } : {}),
    robots: { index: false, follow: false },
  };
}

/**
 * One published BV product (PM-3): the approved snapshot from the platform API. Unknown,
 * unpublished or hidden products are a 404; nothing of a draft is ever rendered.
 */
export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <Suspense
      fallback={
        <CatalogShell crumbs={[{ label: "Home", href: "/" }, { label: "Products", href: "/products" }]}>
          <DetailSkeleton />
        </CatalogShell>
      }
    >
      <ProductDetail params={params} />
    </Suspense>
  );
}

async function ProductDetail({ params }: { params: PageProps<"/products/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const [result, docs, xrefs, cats, list] = await Promise.all([
    product(slug),
    getProductDocuments(slug),
    getProductCrossReferences(slug),
    listCategories(),
    listProducts(),
  ]);
  if (!result.ok && result.reason === "not_found") notFound();
  const home = { label: "Home", href: "/" };
  const products = { label: "Products", href: "/products" };
  if (!result.ok) {
    return (
      <CatalogShell crumbs={[home, products]}>
        <div className="pt-8">
          <CatalogNotice title="This product is not available right now">
            Please try again in a moment, or go back to{" "}
            <Link href="/products" className="underline">
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
    (c) => ({ label: c.name, href: browseHref({ category: c.slug }) }),
  );
  const related = list.ok
    ? list.data.filter((x) => x.category.slug === p.category.slug && x.slug !== p.slug).slice(0, 4)
    : [];
  const [cover, ...gallery] = p.images;
  const spec = p.specs.filter((s) => s.basis !== "TYPICAL");
  const typical = p.specs.filter((s) => s.basis === "TYPICAL");
  return (
    <CatalogShell crumbs={[home, products, ...categoryCrumbs, { label: p.name }]}>
      <article className="grid grid-cols-1 gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:pt-12">
        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-glass/10 bg-navy/60">
            {cover ? (
              <Image
                src={imageSrc(cover.id, "display")}
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
                    src={imageSrc(img.id, "thumb")}
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
          <Link href={browseHref({ category: p.category.slug })} className="tp-eyebrow hover:underline">
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
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-full bg-amber px-6 text-sm font-medium text-ink transition-colors hover:bg-amber/90"
            >
              Ask about this product
            </Link>
          </div>

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

          {docs.ok && docs.data.length ? <Documents slug={slug} items={docs.data} /> : null}

          {xrefs.ok && xrefs.data.length ? <CrossReferences items={xrefs.data} /> : null}
        </div>
      </article>

      {related.length ? <Related items={related} category={p.category} /> : null}
    </CatalogShell>
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
}: {
  items: PublicProductSummary[];
  category: { slug: string; name: string };
}) {
  return (
    <section aria-labelledby="related" className="mt-20 border-t border-glass/10 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="related" className="tp-title">
          More in {category.name}
        </h2>
        <Link href={browseHref({ category: category.slug })} className="text-sm text-amber hover:underline">
          View all
        </Link>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {items.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/products/${r.slug}`}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-glass/10 bg-glass/[0.03] transition-colors hover:border-amber/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              <div className="relative aspect-square bg-navy/60">
                {r.cover ? (
                  <Image
                    src={imageSrc(r.cover.id, "thumb")}
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
function Documents({ slug, items }: { slug: string; items: PublicDocument[] }) {
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
                href={`/products/${slug}/documents/${d.id}`}
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
