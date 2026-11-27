import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { NewsList } from "@/components/news-pages";
import { SiteFrame } from "@/components/site-frame";
import { getNews } from "@/lib/cms";
import { dictionary, interpolate } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { newsPage } from "@/lib/news-view";
import { privacyLink } from "@/lib/privacy";
import { noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const news = cache(getNews);

type Props = PageProps<"/[locale]/news">;

async function read({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale: RouteLocale = isRouteLocale(raw) ? raw : DEFAULT_LOCALE;
  const page = (await searchParams)["page"];
  return { locale, page, res: await news(locale) };
}

/**
 * COM-3: the corporate news list at `/en/news`, `/tr/news` — the published articles of that
 * language, newest first by their first publication, 12 a page (`?page=2`), under the published
 * `corporate.news-index` heading (its SEO fields give the title and description). Without a
 * published heading in the language, or for a page the list does not have: the site's 404.
 * Page 1 is the list's canonical address with its counterparts in the other language; the next
 * pages are canonical to themselves, without hreflang (their articles differ per language).
 */
export async function generateMetadata(props: Props): Promise<Metadata> {
  await connection();
  const { locale, page, res } = await read(props);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata("Dream Petroleum");
  }
  const list = newsPage(res.data.articles, page);
  if (!list) notFound();
  const { title, seo, copy } = res.data.heading;
  const site = await siteSeo(locale);
  const base = seo.title ?? `${copy.title || title} · ${site.siteName}`;
  const first = list.page === 1;
  return pageMetadata(
    {
      path: "/news",
      canonicalSearch: first ? null : `?page=${list.page}`,
      locale,
      title: first
        ? base
        : interpolate(dictionary(locale).news.pageTitle, { title: base, page: String(list.page) }),
      description: seo.description ?? copy.intro,
      noindex: seo.noindex,
      canonicalPath: first ? seo.canonicalPath : null,
      ogTitle: seo.ogTitle,
      ogDescription: seo.ogDescription,
      alternates: first ? res.data.alternates : [],
    },
    site,
  );
}

export default async function News(props: Props) {
  await connection();
  const { locale, page, res } = await read(props);
  if (!res.ok && res.reason === "not_found") notFound();
  const privacyHref = await privacyLink(locale);
  if (!res.ok) {
    return (
      <SiteFrame locale={locale} nav={null} footer={null} languages={[]} privacyHref={privacyHref}>
        <div className="container-site section">
          <p className="notice prose-width">{dictionary(locale).unavailable}</p>
        </div>
      </SiteFrame>
    );
  }
  const list = newsPage(res.data.articles, page);
  if (!list) notFound();
  const view = res.data;
  return (
    <SiteFrame
      locale={locale}
      nav={view.nav}
      footer={view.footer}
      languages={view.nav?.languages ?? []}
      privacyHref={privacyHref}
    >
      <NewsList heading={view.heading} list={list} locale={locale} />
    </SiteFrame>
  );
}
