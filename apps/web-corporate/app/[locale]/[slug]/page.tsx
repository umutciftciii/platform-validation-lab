import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { SiteFrame } from "@/components/site-frame";
import { TemplateSections } from "@/components/template-sections";
import { getPublishedPage } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale } from "@/lib/locale-routing";
import { privacyLink } from "@/lib/privacy";
import { noindexMetadata, pageMetadata, siteSeo } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedPage);

type Params = PageProps<"/[locale]/[slug]">["params"];

async function read(params: Params) {
  const { locale: raw, slug } = await params;
  const locale = isRouteLocale(raw) ? raw : DEFAULT_LOCALE;
  return { locale, res: await published(slug, locale) };
}

/**
 * COM-1: a CMS content page of dreampetroleum.com at `/<locale>/<slug>` — the published revision
 * in that language with the published corporate navigation and footer. The app's own routes
 * (privacy) take precedence; the CMS refuses those slugs. Not published or unknown: 404 (the proxy
 * answers it before rendering), never a draft or content from code.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  await connection();
  const { locale, res } = await read(params);
  if (!res.ok) {
    if (res.reason === "not_found") notFound();
    return noindexMetadata("Dream Petroleum");
  }
  const { path, title, seo, alternates } = res.data;
  return pageMetadata(
    {
      path,
      locale,
      title: seo.title ?? title,
      description: seo.description,
      noindex: seo.noindex,
      canonicalPath: seo.canonicalPath,
      ogTitle: seo.ogTitle,
      ogDescription: seo.ogDescription,
      alternates,
    },
    await siteSeo(locale),
  );
}

export default async function CmsPage({ params }: { params: Params }) {
  await connection();
  const { locale, res } = await read(params);
  if (!res.ok && res.reason === "not_found") notFound();
  const privacyHref = await privacyLink(locale);
  if (!res.ok) {
    return (
      <SiteFrame locale={locale} nav={null} footer={null} languages={[]} privacyHref={privacyHref}>
        <article className="page">
          <p>{dictionary(locale).unavailable}</p>
        </article>
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
      <TemplateSections title={view.title} sections={view.sections} />
    </SiteFrame>
  );
}
