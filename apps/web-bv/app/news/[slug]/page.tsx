import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { ArticlePage, ArticleRemoved, NEWS_UI } from "@/components/news/news-pages";
import { getNewsChrome, getPublishedArticle } from "@/lib/cms-home";

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
    return {
      title: res.reason === "unpublished" ? `${NEWS_UI.removed.title} · Dream Petroleum BV` : "Dream Petroleum BV",
      robots: { index: false, follow: false },
    };
  }
  const { title, seo, excerpt, firstPublishedAt } = res.data;
  const description = seo.description ?? excerpt;
  // Canonical URL and og:image need the site's public origin (metadataBase), which the BV app
  // does not set yet (DP-152); until then they are left out rather than pointing at localhost.
  return {
    title: seo.title ?? title,
    description,
    openGraph: {
      type: "article",
      title: seo.title ?? title,
      description,
      ...(firstPublishedAt ? { publishedTime: firstPublishedAt } : {}),
    },
    // noindex of the article; otherwise the site-wide setting of the root layout applies.
    ...(seo.noindex ? { robots: { index: false, follow: false } } : {}),
  };
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
