import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Rich } from "@/components/i18n/rich";
import { CatalogNotice, CatalogShell } from "@/components/products/catalog-shell";
import { LeadRequestForm } from "@/components/products/lead-request-form";
import { getProduct, getProductDocuments } from "@/lib/catalog-api";
import { catalogLocale } from "@/lib/catalog-locale";
import { countryOptions, dictionary, leadFormUi } from "@/lib/i18n";
import { documentLang } from "@/lib/document-language";
import { formLegalTexts } from "@/lib/form-texts";
import { sitePrivacyNow } from "@/lib/legal-texts-api";
import { DEFAULT_LOCALE, localizeHref } from "@/lib/locale-routing";
import { privacyPolicyHref } from "@/lib/privacy";
import { visibleLocales } from "@/lib/public-locales";
import { COUNTRY_CODES } from "@dream/contracts";

/** ML-6: the title in the page's language. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: dictionary(await catalogLocale()).meta.documentRequest,
    robots: { index: false, follow: false },
  };
}

/**
 * DP-042 (ADR-016): the short request form of a lead-gated document. Only documents the product
 * page lists as `requestable` on BV get a form; everything else is a 404. DP-095 D-T5: where the
 * privacy texts are not published (production with drafts), no form is offered.
 * ML-10 (ADR-028 D12): the form shows the legal texts of the page's language and sends that
 * language; where they may not be offered (a translation under DP-095 review) there is no form,
 * only a notice in the page's language — never the texts of another language.
 */
export default async function DocumentRequestPage({
  params,
}: PageProps<"/[locale]/products/[slug]/documents/[id]">) {
  const locale = await catalogLocale();
  const ui = dictionary(locale).common;
  return (
    <CatalogShell
      locale={locale}
      crumbs={[
        { label: ui.home, href: localizeHref(locale, "/") },
        { label: ui.products, href: localizeHref(locale, "/products") },
      ]}
    >
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-glass/[0.03]" />}>
        <RequestDetail params={params} />
      </Suspense>
    </CatalogShell>
  );
}

async function RequestDetail({
  params,
}: {
  params: PageProps<"/[locale]/products/[slug]/documents/[id]">["params"];
}) {
  await connection();
  const locale = await catalogLocale();
  const { slug, id } = await params;
  const ui = dictionary(locale);
  const t = ui.documentRequest;
  const [product, docs] = await Promise.all([
    getProduct(slug, locale),
    getProductDocuments(slug, locale),
  ]);
  if ((!product.ok && product.reason === "not_found") || (!docs.ok && docs.reason === "not_found")) {
    notFound();
  }
  if (!product.ok || !docs.ok) {
    return (
      <CatalogNotice title={t.unavailableTitle}>{ui.common.tryAgain}</CatalogNotice>
    );
  }
  const doc = docs.data.find((d) => d.id === id);
  if (!doc || !doc.requestable) notFound();
  // DP-298: the gate and the texts are the API's snapshot of the published versions (fail closed).
  const privacy = await sitePrivacyNow();
  if (!privacy.gate.publish) {
    return (
      <CatalogNotice title={t.closedTitle}>{t.closedText}</CatalogNotice>
    );
  }
  // English pages read no language list (as before); other languages must be public (fail closed).
  const legal = formLegalTexts(
    locale,
    locale === DEFAULT_LOCALE ? [] : await visibleLocales(),
    privacy.snapshot.registry,
  );
  if (!legal) {
    return (
      <CatalogNotice title={t.notInLanguageTitle}>{t.notInLanguageText}</CatalogNotice>
    );
  }
  const texts = {
    privacyNotice: { version: legal.privacyNotice.version, text: legal.privacyNotice.text },
    marketingConsent: { version: legal.marketingConsent.version, text: legal.marketingConsent.text },
  };
  const countries = countryOptions(locale, COUNTRY_CODES);
  return (
    <div className="grid grid-cols-1 gap-10 pt-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 lg:pt-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">{t.eyebrow}</p>
        {/* ML-9: the title is in the document's language (ADR-028 D10). */}
        <h1
          lang={documentLang(locale, doc.language)}
          className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] font-medium leading-[1.08] [font-stretch:115%]"
        >
          {doc.title}
        </h1>
        <p className="mt-3 text-steel">
          <Rich
            text={t.about}
            values={{
              type: ui.documents.type[doc.type],
              revision: doc.revisionNumber,
              product: (
                <Link
                  href={localizeHref(locale, `/products/${slug}`)}
                  className="text-glass underline decoration-glass/30 underline-offset-4 hover:decoration-amber"
                >
                  {product.data.name}
                </Link>
              ),
            }}
          />
        </p>
        <p className="mt-6 max-w-[52ch] leading-relaxed text-glass/90">{t.intro}</p>
        <ul className="mt-6 space-y-2 text-sm text-steel">
          <li>· {t.validity}</li>
          <li>· {t.newsOptIn}</li>
        </ul>
      </div>
      <LeadRequestForm
        documentId={doc.id}
        documentTitle={doc.title}
        documentLang={documentLang(locale, doc.language)}
        countries={countries}
        texts={texts}
        privacyHref={privacyPolicyHref(locale, privacy.locales)}
        locale={locale}
        ui={leadFormUi(locale)}
      />
    </div>
  );
}
