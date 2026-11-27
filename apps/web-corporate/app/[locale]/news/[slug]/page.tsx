import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { ArticlePage, ArticleRemoved } from "@/components/news-pages";
import { SiteFrame } from "@/components/site-frame";
import { getPublishedArticle, getSiteFrame } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale } from "@/lib/locale-routing";
import { privacyLink } from "@/lib/privacy";
import { noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedArticle);

type Params = PageProps<"/[locale]/news/[slug]">["params"];

async function read(params: Params) {
  const { locale: raw, slug } = await params;
  const locale = isRouteLocale(raw) ? raw : DEFAULT_LOCALE;
  return { locale, res: await published(slug, locale) };
}

/**
 * COM-3: a published corporate news article at `/<l>/news/<slug>`, with the published navigation
 * and footer of its language. Unknown: 404. Taken off the site: a "no longer available" page
 * (noindex). Never a draft (drafts are shown only through a signed preview link).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  await connection();
  const { locale, res } = await read(params);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata(
      res.reason === "unpublished" ? dictionary(locale).news.removedTitle : "Dream Petroleum",
    );
  }
  const { path, title, seo, excerpt, alternates } = res.data;
  return pageMetadata(
    {
      path,
      locale,
      title: seo.title ?? title,
      description: seo.description ?? excerpt,
      noindex: seo.noindex,
      canonicalPath: seo.canonicalPath,
      ogTitle: seo.ogTitle,
      ogDescription: seo.ogDescription,
      alternates,
    },
    await siteSeo(locale),
  );
}

export default async function NewsArticle({ params }: { params: Params }) {
  await connection();
  const { locale, res } = await read(params);
  if (!res.ok && res.reason === "not_found") notFound();
  const privacyHref = await privacyLink(locale);
  if (!res.ok) {
    if (res.reason === "unpublished") {
      const frame = await getSiteFrame("/news", locale);
      return (
        <SiteFrame
          locale={locale}
          nav={frame.nav}
          footer={frame.footer}
          languages={frame.languages}
          privacyHref={privacyHref}
        >
          <ArticleRemoved locale={locale} />
        </SiteFrame>
      );
    }
    return (
      <SiteFrame locale={locale} nav={null} footer={null} languages={[]} privacyHref={privacyHref}>
        <div className="container-site section">
          <p className="notice prose-width">{dictionary(locale).unavailable}</p>
        </div>
      </SiteFrame>
    );
  }
  const view = res.data;
  return (
    <SiteFrame
      locale={locale}
      nav={view.nav}
      footer={view.footer}
      languages={view.nav?.languages ?? []}
      privacyHref={privacyHref}
    >
      <ArticlePage view={view} />
    </SiteFrame>
  );
}
