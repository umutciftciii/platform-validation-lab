import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { imageSrc, listProducts } from "@/lib/catalog-api";

export const metadata: Metadata = {
  title: "Products | Dream Petroleum BV",
  description: "Published products of Dream Petroleum BV.",
  robots: { index: false, follow: false },
};

/**
 * Published BV products (PM-3), live from the platform API: only products approved, published
 * on BV and listed as visible appear. The list renders at request time behind a skeleton.
 */
export default function ProductsPage() {
  return (
    <CatalogShell crumbs={[{ label: "Home", href: "/" }, { label: "Products" }]}>
      <div className="pb-8 pt-6 sm:pb-12 sm:pt-12">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">Dream Petroleum BV</p>
        <h1 className="mt-3 text-[clamp(2rem,5vw,3.5rem)] font-medium leading-none [font-stretch:115%]">
          Products
        </h1>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <ProductList />
      </Suspense>
    </CatalogShell>
  );
}

async function ProductList() {
  await connection();
  const list = await listProducts();
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
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {list.data.map((p) => (
        <li key={p.slug}>
          <Link
            href={`/products/${p.slug}`}
            className="group flex h-full flex-col overflow-hidden rounded-2xl border border-glass/10 bg-glass/[0.03] transition-colors hover:border-amber/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
          >
            <div className="relative aspect-[4/3] bg-navy/60">
              {p.cover ? (
                <Image
                  src={imageSrc(p.cover.id, "thumb")}
                  alt={p.cover.altText ?? ""}
                  fill
                  unoptimized
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
              <p className="text-xs uppercase tracking-[0.16em] text-steel">{p.category.name}</p>
              <h2 className="text-xl font-medium text-glass [font-stretch:110%]">{p.name}</h2>
              <p className="line-clamp-3 text-sm leading-relaxed text-steel">{p.summary}</p>
              <p className="mt-auto pt-2 font-mono text-xs text-steel/80">{p.code}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
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
