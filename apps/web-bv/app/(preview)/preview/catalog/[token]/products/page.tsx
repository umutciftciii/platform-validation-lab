import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { filterProducts, paginate, parseBrowse, trail, type BrowseParams } from "@/components/products/browse";
import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { BrowseResults } from "@/components/products/catalog-views";
import {
  PreviewBanner,
  PreviewCardBadge,
  PreviewUnavailable,
  previewLinks,
} from "@/components/products/preview-parts";
import { previewBase, previewList } from "@/lib/catalog-preview-api";

/** DP-173: never indexed, never followed, never cached (see next.config headers too). */
export const metadata: Metadata = {
  title: "Catalogue preview · Dream Petroleum BV",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * DP-173 (ADR-022 D5): the company preview of the BV catalogue list and categories, in the live
 * design (shared views). Every product the site lists appears, published or not, with its current
 * data; the review state is a line on each card.
 */
export default function PreviewProductsPage({
  params,
  searchParams,
}: PageProps<"/preview/catalog/[token]/products">) {
  return (
    <CatalogShell crumbs={[{ label: "Preview" }, { label: "Products" }]}>
      <Suspense fallback={null}>
        <PreviewBrowse params={params} searchParams={searchParams} />
      </Suspense>
    </CatalogShell>
  );
}

async function PreviewBrowse({
  params,
  searchParams,
}: {
  params: PageProps<"/preview/catalog/[token]/products">["params"];
  searchParams: PageProps<"/preview/catalog/[token]/products">["searchParams"];
}) {
  await connection();
  const { token } = await params;
  const res = await previewList(token);
  if (!res.ok) {
    return (
      <div className="pt-8">
        <PreviewUnavailable reason={res.reason} />
      </div>
    );
  }
  const { items, categories, expiresAt } = res.data;
  const browse = parseBrowse(await searchParams);
  const known = browse.category && categories.some((c) => c.slug === browse.category);
  const p: BrowseParams = { ...browse, category: known ? browse.category : null };
  const result = paginate(filterProducts(items, categories, p), p.page);
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  return (
    <>
      <PreviewBanner expiresAt={expiresAt} />
      <header className="pb-8 pt-8 sm:pb-12 sm:pt-12">
        <p className="tp-eyebrow">Dream Petroleum BV · Preview</p>
        <h1 className="tp-display">Products</h1>
        <p className="tp-lead">
          {items.length} products listed for review. Current site data; proposed texts are shown on
          each product page, apart from it.
        </p>
      </header>
      {items.length === 0 ? (
        <CatalogNotice title="No products listed">The site lists no products yet.</CatalogNotice>
      ) : (
        <BrowseResults
          categories={categories}
          params={p}
          active={trail(categories, p.category)}
          result={result}
          links={previewLinks(previewBase(token))}
          badge={(slug) => {
            const i = bySlug.get(slug);
            return i ? (
              <PreviewCardBadge status={i.proposalStatus} hasText={i.hasProposalText} unpublished={i.unpublished} />
            ) : null;
          }}
        />
      )}
    </>
  );
}
