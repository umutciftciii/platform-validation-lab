import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { NewsList } from "@/components/news/news-pages";
import { getNews } from "@/lib/cms-home";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { cmsPageSeo, noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

const news = cache(getNews);

async function localeOf(params: PageProps<"/[locale]/news">["params"]): Promise<RouteLocale> {
  const { locale } = await params;
  return isRouteLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * DP-020: the BV news list. Only published articles, newest first by their first publication;
 * an empty list shows its empty state. Every article comes from the CMS, and so does the heading
 * (DP-153: the published `bv.news-index` page, its SEO fields give the browser title).
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/news">): Promise<Metadata> {
  await connection();
  const locale = await localeOf(params);
  const res = await news(locale);
  if (!res.ok) return noindexMetadata("Dream Petroleum BV");
  const { title, seo, copy } = res.data.heading;
  const site = await siteSeo();
  return pageMetadata(
    {
      path: "/news",
      locale,
      title: seo.title ?? `${copy.title || title} · ${site.siteName}`,
      description: seo.description ?? copy.intro,
      noindex: seo.noindex,
      ...cmsPageSeo(seo),
    },
    site,
  );
}

export default function NewsPage({ params }: PageProps<"/[locale]/news">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <News params={params} />
    </Suspense>
  );
}

async function News({ params }: { params: PageProps<"/[locale]/news">["params"] }) {
  await connection();
  const res = await news(await localeOf(params));
  if (!res.ok) return <HomeUnavailable reason="unavailable" />;
  return <NewsList view={res.data} />;
}
