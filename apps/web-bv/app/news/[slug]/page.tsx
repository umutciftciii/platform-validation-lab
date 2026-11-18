import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { ArticlePage, ArticleRemoved, NEWS_UI } from "@/components/news/news-pages";
import { getNewsChrome, getPublishedArticle } from "@/lib/cms-home";
import { noindexMetadata, pageMetadata } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedArticle);

/**
 * DP-020: a published news article at /news/<slug>, with the published navigation and footer.
 * Unknown: 404. Taken off the site: a "no longer available" page (noindex). Never a draft.
 */
export async function generateMetadata({ params }: PageProps<"/news/[slug]">): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const res = await published(slug);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata(
      res.reason === "unpublished" ? `${NEWS_UI.removed.title} · Dream Petroleum BV` : "Dream Petroleum BV",
    );
  }
  const { path, title, seo, excerpt, coverImage, coverAlt, firstPublishedAt } = res.data;
  // DP-207: canonical URL and og:image from the site's public origin (lib/seo.ts).
  return pageMetadata({
    path,
    type: "article",
    title: seo.title ?? title,
    description: seo.description ?? excerpt,
    noindex: seo.noindex,
    images: coverImage ? [{ url: coverImage, alt: coverAlt }] : [],
    publishedTime: firstPublishedAt,
  });
}

export default function NewsArticlePage({ params }: PageProps<"/news/[slug]">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Article params={params} />
    </Suspense>
  );
}

async function Article({ params }: { params: PageProps<"/news/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const res = await published(slug);
  if (res.ok) return <ArticlePage view={res.data} />;
  if (res.reason === "not_found") notFound();
  if (res.reason === "unpublished") {
    // The navigation and footer come with the news list read.
    const { nav, footer } = await getNewsChrome();
    return <ArticleRemoved nav={nav} footer={footer} />;
  }
  return <HomeUnavailable reason="unavailable" />;
}
