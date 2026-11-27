import { connection } from "next/server";

import { HomePage } from "@/components/home-page";
import { ProductsPage } from "@/components/products-page";
import { SiteFrame } from "@/components/site-frame";
import { TemplateSections } from "@/components/template-sections";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/locale-routing";
import { previewRead } from "@/lib/preview-read";

/**
 * COM-2a (DP-321): the current draft a signed admin link names, on this site and in its draft's
 * language: a content page, a designed page (home, portfolio; COM-2b), or a fragment (navigation,
 * footer, SEO defaults) on the home page — the real CMS home page, as the API sends it.
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
          locale={view.locale}
        />
      </SiteFrame>
    );
  }
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
      {view.kind === "home" ? (
        <HomePage content={view.page.content} />
      ) : (
        <ProductsPage content={view.page.content} locale={view.locale} />
      )}
    </SiteFrame>
  );
}
