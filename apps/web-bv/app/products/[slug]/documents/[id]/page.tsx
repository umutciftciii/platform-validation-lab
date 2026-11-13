import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { LeadRequestForm } from "@/components/products/lead-request-form";
import { getProduct, getProductDocuments } from "@/lib/catalog-api";
import { PRIVACY_PATH, sitePrivacy } from "@/lib/privacy";
import { COUNTRY_CODES, currentLeadFormTexts } from "@dream/contracts";

export const metadata: Metadata = {
  title: "Request a document | Dream Petroleum BV",
  robots: { index: false, follow: false },
};

/**
 * DP-042 (ADR-016): the short request form of a lead-gated document. Only documents the product
 * page lists as `requestable` on BV get a form; everything else is a 404. DP-095 D-T5: where the
 * privacy texts are not published (production with drafts), no form is offered.
 */
export default function DocumentRequestPage({ params }: PageProps<"/products/[slug]/documents/[id]">) {
  return (
    <CatalogShell crumbs={[{ label: "Home", href: "/" }, { label: "Products", href: "/products" }]}>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-glass/[0.03]" />}>
        <RequestDetail params={params} />
      </Suspense>
    </CatalogShell>
  );
}

const TYPE_LABEL = {
  TDS: "Technical data sheet",
  SDS: "Safety data sheet",
  COA: "Certificate of analysis",
  OTHER: "Document",
} as const;

async function RequestDetail({ params }: { params: PageProps<"/products/[slug]/documents/[id]">["params"] }) {
  await connection();
  const { slug, id } = await params;
  const [product, docs] = await Promise.all([getProduct(slug), getProductDocuments(slug)]);
  if ((!product.ok && product.reason === "not_found") || (!docs.ok && docs.reason === "not_found")) {
    notFound();
  }
  if (!product.ok || !docs.ok) {
    return (
      <CatalogNotice title="This document is not available right now">
        Please try again in a moment.
      </CatalogNotice>
    );
  }
  const doc = docs.data.find((d) => d.id === id);
  if (!doc || !doc.requestable) notFound();
  if (!sitePrivacy().publish) {
    return (
      <CatalogNotice title="Document requests are not open yet">
        This document will be available on request soon.
      </CatalogNotice>
    );
  }
  const texts = currentLeadFormTexts();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const countries = COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
  return (
    <div className="grid grid-cols-1 gap-10 pt-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 lg:pt-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">Document request</p>
        <h1 className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] font-medium leading-[1.08] [font-stretch:115%]">
          {doc.title}
        </h1>
        <p className="mt-3 text-steel">
          {TYPE_LABEL[doc.type]} · revision {doc.revisionNumber} · for{" "}
          <Link href={`/products/${slug}`} className="text-glass underline decoration-glass/30 underline-offset-4 hover:decoration-amber">
            {product.data.name}
          </Link>
        </p>
        <p className="mt-6 max-w-[52ch] leading-relaxed text-glass/90">
          Tell us who you are and the PDF downloads right away. The copy you receive is marked with your name,
          your company and a request reference.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-steel">
          <li>· The download link stays valid for 15 minutes, for up to 3 downloads.</li>
          <li>· Product news by e-mail only if you tick the separate box.</li>
        </ul>
      </div>
      <LeadRequestForm
        documentId={doc.id}
        documentTitle={doc.title}
        countries={countries}
        texts={texts}
        privacyHref={PRIVACY_PATH}
      />
    </div>
  );
}
