import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { ArticlePage, ArticleRemoved, NEWS_UI } from "@/components/news/news-pages";
import { getNewsChrome, getPublishedArticle } from "@/lib/cms-home";
import { DEFAULT_LOCALE, isRouteLocale } from "@/lib/locale-routing";
import { cmsPageSeo, noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedArticle);

type Params = PageProps<"/[locale]/news/[slug]">["params"];

async function read(params: Params) {
  const { locale: raw, slug } = await params;
  const locale = isRouteLocale(raw) ? raw : DEFAULT_LOCALE;
  return { locale, res: await published(slug, locale) };
}

/**
 * DP-020: a published news article at /news/<slug>, with the published navigation and footer.
 * Unknown: 404. Taken off the site: a "no longer available" page (noindex). Never a draft.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/news/[slug]">): Promise<Metadata> {
  await connection();
  const { locale, res } = await read(params);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata(
      res.reason === "unpublished" ? `${NEWS_UI.removed.title} · Dream Petroleum BV` : "Dream Petroleum BV",
    );
  }
  const { path, title, seo, excerpt, coverImage, coverAlt, firstPublishedAt, alternates } = res.data;
  // DP-207: canonical URL and og:image from the site's public origin (lib/seo.ts).
  return pageMetadata(
    {
      path,
      locale,
      type: "article",
      title: seo.title ?? title,
      description: seo.description ?? excerpt,
      noindex: seo.noindex,
      images: coverImage ? [{ url: coverImage, alt: coverAlt }] : [],
      publishedTime: firstPublishedAt,
      alternates,
      ...cmsPageSeo(seo),
    },
    await siteSeo(locale),
  );
}

export default function NewsArticlePage({ params }: PageProps<"/[locale]/news/[slug]">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Article params={params} />
    </Suspense>
  );
}

async function Article({ params }: { params: Params }) {
  await connection();
  const { locale, res } = await read(params);
  if (res.ok) return <ArticlePage view={res.data} />;
  if (res.reason === "not_found") notFound();
  if (res.reason === "unpublished") {
    // The navigation and footer come with the news list read.
    const { nav, footer } = await getNewsChrome(locale);
    return <ArticleRemoved nav={nav} footer={footer} />;
  }
  return <HomeUnavailable reason="unavailable" />;
}
