import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomePage, HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { OrganizationJsonLd } from "@/components/seo/json-ld";
import { getPublishedHome } from "@/lib/cms-home";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { cmsPageSeo, noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedHome);

async function localeOf(params: PageProps<"/[locale]">["params"]): Promise<RouteLocale> {
  const { locale } = await params;
  return isRouteLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * The BV home page (CMS S2, DP-134): the published `bv.home` revision with the published
 * navigation and footer, read at request time. ML-3: per language at `/en`, `/nl` (`/` answers
 * 301 to `/en` in proxy.ts). Not published: the unavailable state, with a 404
 * status where the response has not started yet; never content from code.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  await connection();
  const locale = await localeOf(params);
  const res = await published(locale);
  if (!res.ok) return noindexMetadata("Dream Petroleum BV");
  const { seo, alternates } = res.data;
  const site = await siteSeo(locale);
  // DP-207: indexable only under the site policy (production + DP_SEO_INDEXING=on), lib/seo.ts.
  // DP-209: without an SEO title of its own the home page uses the site's default title.
  return pageMetadata(
    {
      path: "/",
      locale,
      title: seo.title ?? site.defaultTitle,
      description: seo.description,
      noindex: seo.noindex,
      alternates,
      ...cmsPageSeo(seo),
    },
    site,
  );
}

export default function Home({ params }: PageProps<"/[locale]">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <PublishedHome params={params} />
    </Suspense>
  );
}

async function PublishedHome({ params }: { params: PageProps<"/[locale]">["params"] }) {
  await connection();
  const locale = await localeOf(params);
  const res = await published(locale);
  if (!res.ok) return <HomeUnavailable reason={res.reason} />;
  return (
    <>
      <OrganizationJsonLd locale={locale} />
      <HomePage view={res.data} />
    </>
  );
}
