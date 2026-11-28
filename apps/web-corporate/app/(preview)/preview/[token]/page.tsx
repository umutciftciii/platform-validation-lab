import { connection } from "next/server";

import { HomePage } from "@/components/home-page";
import { ArticlePage, NewsList } from "@/components/news-pages";
import { ProductsPage } from "@/components/products-page";
import { SiteFrame } from "@/components/site-frame";
import { TemplateSections } from "@/components/template-sections";
import { getNews } from "@/lib/cms";
import { contactSectionForm } from "@/lib/contact-section";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/locale-routing";
import { newsPage } from "@/lib/news-view";
import { previewRead } from "@/lib/preview-read";

/**
 * COM-2a (DP-321): the current draft a signed admin link names, on this site and in its draft's
 * language: a content page, a designed page (home, portfolio; COM-2b), or a fragment (navigation,
 * footer, SEO defaults) on the home page — the real CMS home page, as the API sends it. COM-3: a
 * news article's draft, and the news list heading's draft over the published articles (the first
 * page of the list).
 * The link is valid for 15 minutes and only on this site (the API checks both); never indexed,
 * never cached. The privacy link is left out: a preview never leads visitors anywhere new.
 */
export default async function PreviewPage({ params }: PageProps<"/preview/[token]">) {
  await connection();
  const { token } = await params;
  const res = await previewRead(token);
  if (!res.ok) {
    const t = dictionary(DEFAULT_LOCALE);
    return (
      <SiteFrame
        locale={DEFAULT_LOCALE}
        nav={null}
        footer={null}
        languages={[]}
        privacyHref={null}
        preview
      >
        <div className="container-site section">
          <p className="notice prose-width">
            {res.reason === "unavailable" ? t.unavailable : t.preview.unavailable}
          </p>
        </div>
      </SiteFrame>
    );
  }
  const view = res.data;
  if (view.kind === "template") {
    const page = view.page;
    // COM-4: a preview shows the form as the published page would (another language than English
    // counts as not public here: a preview proves nothing about a language).
    const form = page.sections.some((s) => s.type === "contact")
      ? await contactSectionForm(view.locale, { preview: true })
      : null;
    return (
      <SiteFrame
        locale={view.locale}
        nav={page.nav}
        footer={page.footer}
        languages={page.nav?.languages ?? []}
        privacyHref={null}
        preview
      >
        <TemplateSections
          title={page.title}
          sections={page.sections}
          contact={page.footer?.contact ?? null}
          form={form}
          locale={view.locale}
        />
      </SiteFrame>
    );
  }
  if (view.kind === "article" || view.kind === "news") {
    const page = view.page;
    return (
      <SiteFrame
        locale={view.locale}
        nav={page.nav}
        footer={page.footer}
        languages={page.nav?.languages ?? []}
        privacyHref={null}
        preview
      >
        {view.kind === "article" ? (
          <ArticlePage view={view.page} />
        ) : (
          <NewsList
            heading={view.page.heading}
            list={newsPage(view.page.articles, undefined)!}
            locale={view.locale}
          />
        )}
      </SiteFrame>
    );
  }
  const page = view.page;
  // COM-7: the home page's news block lists the published articles, as on the site.
  const news = view.kind === "home" ? await getNews(view.locale) : null;
  return (
    <SiteFrame
      locale={view.locale}
      nav={page.nav}
      footer={page.footer}
      languages={page.nav?.languages ?? []}
      privacyHref={null}
      preview
    >
      {view.kind === "home" ? (
        <HomePage
          content={view.page.content}
          articles={news?.ok ? news.data.articles : []}
          locale={view.locale}
        />
      ) : (
        <ProductsPage content={view.page.content} locale={view.locale} />
      )}
    </SiteFrame>
  );
}
