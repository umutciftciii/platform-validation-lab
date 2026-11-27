import type { Metadata } from "next";
import { connection } from "next/server";

import { HomePlaceholder } from "@/components/home-placeholder";
import { SiteFrame } from "@/components/site-frame";
import { getSiteFrame } from "@/lib/cms";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { privacyLink } from "@/lib/privacy";
import { pageMetadata, siteSeo } from "@/lib/seo";

async function localeOf(params: PageProps<"/[locale]">["params"]): Promise<RouteLocale> {
  const { locale } = await params;
  return isRouteLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * COM-1: the corporate home at `/en`, `/tr` (`/` answers 301 to `/en` in proxy.ts). Its designed
 * page comes with COM-2b (`corporate.home`); until then a short notice in the corporate design
 * (COM-2a) inside the published navigation and footer, never indexed (noindex) and never in the
 * sitemap.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  await connection();
  const locale = await localeOf(params);
  const site = await siteSeo(locale);
  return pageMetadata({ path: "/", locale, title: site.defaultTitle, noindex: true }, site);
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  await connection();
  const locale = await localeOf(params);
  const [frame, privacyHref] = await Promise.all([getSiteFrame("/", locale), privacyLink(locale)]);
  return (
    <SiteFrame
      locale={locale}
      nav={frame.nav}
      footer={frame.footer}
      languages={frame.languages}
      privacyHref={privacyHref}
    >
      <HomePlaceholder locale={locale} />
    </SiteFrame>
  );
}
