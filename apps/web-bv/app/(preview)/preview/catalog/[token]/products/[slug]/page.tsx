import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogShell } from "@/components/products/catalog-shell";
import { ProductDetailView } from "@/components/products/catalog-views";
import {
  HeldBlock,
  NoDocumentsNote,
  PreviewBanner,
  PreviewUnavailable,
  ProposalBlock,
  previewLinks,
} from "@/components/products/preview-parts";
import { previewBase, previewList, previewProduct } from "@/lib/catalog-preview-api";

export const metadata: Metadata = {
  title: "Product preview · Dream Petroleum BV",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * DP-173 (ADR-022 D5): one product of the company preview in the live product-page design. The
 * product's CURRENT data fills the page as on the live site; the research proposal sits in its own
 * block, the DP-002 held and withheld values in another, never in the technical data. No enquiry
 * button, no documents, no cross-references.
 */
export default function PreviewProductPage({ params }: PageProps<"/preview/catalog/[token]/products/[slug]">) {
  return (
    <Suspense fallback={null}>
      <PreviewDetail params={params} />
    </Suspense>
  );
}

async function PreviewDetail({
  params,
}: {
  params: PageProps<"/preview/catalog/[token]/products/[slug]">["params"];
}) {
  await connection();
  const { token, slug } = await params;
  const base = previewBase(token);
  const links = previewLinks(base);
  const [res, list] = await Promise.all([previewProduct(token, slug), previewList(token)]);
  if (!res.ok && res.reason === "not_found" && list.ok) notFound();
  if (!res.ok) {
    return (
      <CatalogShell crumbs={[{ label: "Preview" }]}>
        <div className="pt-8">
          <PreviewUnavailable reason={res.reason} />
        </div>
      </CatalogShell>
    );
  }
  const { product: p, proposal, held, expiresAt } = res.data;
  const related = list.ok
    ? list.data.items.filter((x) => x.category.slug === p.category.slug && x.slug !== p.slug).slice(0, 4)
    : [];
  return (
    <CatalogShell
      crumbs={[
        { label: "Preview", href: links.list({}) },
        { label: p.category.name, href: links.list({ category: p.category.slug }) },
        { label: p.name },
      ]}
    >
      <PreviewBanner expiresAt={expiresAt} />
      <ProductDetailView
        p={p}
        related={related}
        links={links}
        enquiry={false}
        afterIntro={<ProposalBlock proposal={proposal} />}
        extras={
          <>
            <HeldBlock held={held} />
            <NoDocumentsNote />
          </>
        }
      />
    </CatalogShell>
  );
}
