import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { NewsList } from "@/components/news/news-pages";
import { getNews } from "@/lib/cms-home";
import { cmsPageSeo, noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

const news = cache(getNews);

/**
 * DP-020: the BV news list. Only published articles, newest first by their first publication;
 * an empty list shows its empty state. Every article comes from the CMS, and so does the heading
 * (DP-153: the published `bv.news-index` page, its SEO fields give the browser title).
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const res = await news();
  if (!res.ok) return noindexMetadata("Dream Petroleum BV");
  const { title, seo, copy } = res.data.heading;
  const site = await siteSeo();
  return pageMetadata(
    {
      path: "/news",
      title: seo.title ?? `${copy.title || title} · ${site.siteName}`,
      description: seo.description ?? copy.intro,
      noindex: seo.noindex,
      ...cmsPageSeo(seo),
    },
    site,
  );
}

export default function NewsPage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <News />
    </Suspense>
  );
}

async function News() {
  await connection();
  const res = await news();
  if (!res.ok) return <HomeUnavailable reason="unavailable" />;
  return <NewsList view={res.data} />;
}
