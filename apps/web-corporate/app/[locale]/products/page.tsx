import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { ProductsPage } from "@/components/products-page";
import { SiteFrame } from "@/components/site-frame";
import { getPublishedProducts } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { privacyLink } from "@/lib/privacy";
import { corporateImage } from "@/lib/section-view";
import { noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedProducts);

async function localeOf(params: PageProps<"/[locale]/products">["params"]): Promise<RouteLocale> {
  const { locale } = await params;
  return isRouteLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * COM-2b (DP-094): the product portfolio at `/en/products`, `/tr/products` — the published
 * `corporate.products` of that language (one page, anchored groups) with the published
 * navigation and footer. An app route ahead of `[slug]` (the CMS reserves the `products` slug);
 * not published in the language: the site's 404, never content from code.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/products">): Promise<Metadata> {
  await connection();
  const locale = await localeOf(params);
  const res = await published(locale);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata("Dream Petroleum");
  }
  const { seo, alternates } = res.data;
  const site = await siteSeo(locale);
  const { title } = res.data;
  return pageMetadata(
    {
      path: res.data.path,
      locale,
      title: seo.title ?? title,
      description: seo.description,
      noindex: seo.noindex,
      canonicalPath: seo.canonicalPath,
      ogTitle: seo.ogTitle,
      ogDescription: seo.ogDescription,
      alternates,
    },
    site,
  );
}

export default async function Products({ params }: PageProps<"/[locale]/products">) {
  await connection();
  const locale = await localeOf(params);
  const res = await published(locale);
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
  const view = res.data;
  return (
    <SiteFrame
      locale={locale}
      nav={view.nav}
      footer={view.footer}
      languages={view.nav?.languages ?? []}
      privacyHref={privacyHref}
      overlay={corporateImage(view.content.intro.image) !== null}
    >
      <ProductsPage content={view.content} locale={locale} />
    </SiteFrame>
  );
}
