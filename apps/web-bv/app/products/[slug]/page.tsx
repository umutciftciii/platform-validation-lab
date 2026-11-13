import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { formatSpecValue } from "@/components/products/format";
import {
  documentHref,
  getProduct,
  getProductCrossReferences,
  getProductDocuments,
  imageSrc,
} from "@/lib/catalog-api";
import {
  XREF_PUBLIC_LABELS,
  xrefPublicNotice,
  type PublicCrossReference,
  type PublicDocument,
} from "@dream/contracts";

export const metadata: Metadata = {
  title: "Product | Dream Petroleum BV",
  robots: { index: false, follow: false },
};

/**
 * One published BV product (PM-3): the approved snapshot from the platform API. Unknown,
 * unpublished or hidden products are a 404; nothing of a draft is ever rendered.
 */
export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <CatalogShell crumbs={[{ label: "Home", href: "/" }, { label: "Products", href: "/products" }]}>
      <Suspense fallback={<DetailSkeleton />}>
        <ProductDetail params={params} />
      </Suspense>
    </CatalogShell>
  );
}

async function ProductDetail({ params }: { params: PageProps<"/products/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const [result, docs, xrefs] = await Promise.all([
    getProduct(slug),
    getProductDocuments(slug),
    getProductCrossReferences(slug),
  ]);
  if (!result.ok && result.reason === "not_found") notFound();
  if (!result.ok) {
    return (
      <CatalogNotice title="This product is not available right now">
        Please try again in a moment, or go back to{" "}
        <Link href="/products" className="underline">
          all products
        </Link>
        .
      </CatalogNotice>
    );
  }
  const p = result.data;
  const [cover, ...gallery] = p.images;
  return (
    <article className="grid grid-cols-1 gap-10 pt-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14 lg:pt-10">
      <div className="space-y-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-glass/10 bg-navy/60">
          {cover ? (
            <Image
              src={imageSrc(cover.id, "display")}
              alt={cover.altText ?? p.name}
              fill
              unoptimized
              priority
              sizes="(min-width: 1024px) 55vw, 100vw"
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

      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">{p.category.name}</p>
        <h1 className="mt-3 text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.05] [font-stretch:115%]">
          {p.name}
        </h1>
        <p className="mt-2 font-mono text-sm text-steel">{p.code}</p>
        <p className="mt-6 text-lg leading-relaxed text-glass/90">{p.summary}</p>
        {p.description ? (
          <p className="mt-4 whitespace-pre-line leading-relaxed text-steel">{p.description}</p>
        ) : null}

        {p.specs.length ? (
          <section aria-labelledby="specs" className="mt-10">
            <h2 id="specs" className="text-sm font-medium uppercase tracking-[0.16em] text-steel">
              Technical data
            </h2>
            <dl className="mt-3 divide-y divide-glass/10 border-y border-glass/10">
              {p.specs.map((s) => (
                <div key={s.key} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[1fr_auto] sm:gap-6">
                  <dt className="text-sm text-steel">
                    {s.name}
                    {s.testMethod ? (
                      <span className="block text-xs text-steel/70">{s.testMethod}</span>
                    ) : null}
                  </dt>
                  <dd className="tabular-nums text-glass sm:text-right">{formatSpecValue(s)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {docs.ok && docs.data.length ? <Documents slug={slug} items={docs.data} /> : null}

        {xrefs.ok && xrefs.data.length ? <CrossReferences items={xrefs.data} /> : null}

        <Link
          href="/products"
          className="mt-10 inline-flex items-center gap-2 text-sm text-steel hover:text-glass"
        >
          <span aria-hidden="true">←</span> All products
        </Link>
      </div>
    </article>
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
    <section aria-labelledby="documents" className="mt-10">
      <h2 id="documents" className="text-sm font-medium uppercase tracking-[0.16em] text-steel">
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
    <section aria-labelledby="cross-references" className="mt-10">
      <h2 id="cross-references" className="text-sm font-medium uppercase tracking-[0.16em] text-steel">
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
    <div className="grid grid-cols-1 gap-10 pt-6 lg:grid-cols-2" aria-busy="true">
      <div className="aspect-[4/3] animate-pulse rounded-2xl bg-glass/[0.05]" />
      <div className="space-y-4">
        <div className="h-4 w-32 animate-pulse rounded bg-glass/[0.08]" />
        <div className="h-12 w-3/4 animate-pulse rounded bg-glass/[0.08]" />
        <div className="h-24 animate-pulse rounded bg-glass/[0.05]" />
      </div>
    </div>
  );
}
