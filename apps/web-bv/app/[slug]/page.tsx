import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomeSkeleton } from "@/components/home/home-page";
import { TemplatePage } from "@/components/template/template-page";
import { getPublishedPage } from "@/lib/cms-home";

// One API read per request for the metadata and the page.
const published = cache(getPublishedPage);

/**
 * A CMS template page of the BV site at `/<slug>` (CMS S3, DP-017): the published revision with the
 * published navigation and footer. The app's own routes (products, privacy, preview, …) take
 * precedence over this dynamic segment, and the CMS refuses those slugs. Not published or unknown:
 * 404, never a draft or content from code.
 */
export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const res = await published(slug);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return { title: "Dream Petroleum BV", robots: { index: false, follow: false } };
  }
  const { title, seo } = res.data;
  return {
    title: seo.title ?? title,
    ...(seo.description ? { description: seo.description } : {}),
    // noindex of the page; otherwise the site-wide setting of the root layout applies.
    ...(seo.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export default function CmsPage({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <PublishedPage params={params} />
    </Suspense>
  );
}

async function PublishedPage({ params }: { params: PageProps<"/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const res = await published(slug);
  if (!res.ok) notFound();
  return <TemplatePage view={res.data} />;
}
