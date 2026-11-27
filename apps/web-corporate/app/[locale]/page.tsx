import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { HomePage } from "@/components/home-page";
import { SiteFrame } from "@/components/site-frame";
import { getPublishedHome } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { privacyLink } from "@/lib/privacy";
import { noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedHome);

async function localeOf(params: PageProps<"/[locale]">["params"]): Promise<RouteLocale> {
  const { locale } = await params;
  return isRouteLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * COM-2b: the corporate home at `/en`, `/tr` (`/` answers 301 to `/en` in proxy.ts) — the
 * published `corporate.home` of that language with the published navigation and footer. Not
 * published in the language: the site's 404 (HTTP 404, noindex), never content from code (the
 * COM-2a placeholder is gone). The API unreachable: the unavailable notice.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  await connection();
  const locale = await localeOf(params);
  const res = await published(locale);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata("Dream Petroleum");
  }
  const { seo, alternates } = res.data;
  const site = await siteSeo(locale);
  // Without an SEO title of its own the home page uses the site's default title (as on BV).
  return pageMetadata(
    {
      path: "/",
      locale,
      title: seo.title ?? site.defaultTitle,
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

export default async function Home({ params }: PageProps<"/[locale]">) {
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
    >
      <HomePage content={view.content} />
    </SiteFrame>
  );
}
