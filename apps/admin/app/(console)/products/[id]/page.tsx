import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CatalogContextResponseSchema,
  CategoryListResponseSchema,
  ProductDetailResponseSchema,
  ProductCrossReferenceListResponseSchema,
  ProductDocumentListResponseSchema,
  ProductImageListResponseSchema,
  ProductSpecsResponseSchema,
  ProductTranslationsResponseSchema,
  ProductWorkflowResponseSchema,
  ProposalResponseSchema,
  type ProductTranslationsResponse,
  type SiteLocale,
} from "@dream/contracts";
import { CrossReferenceManager } from "../../../../components/catalog/cross-reference-manager";
import { DocumentManager } from "../../../../components/catalog/document-manager";
import { ImageManager } from "../../../../components/catalog/image-manager";
import { NoticeProvider } from "../../../../components/catalog/notices";
import {
  KeepUnsaved,
  ProductSiteSwitcher,
  ProductTabPanel,
  ProductTabs,
  TabLink,
} from "../../../../components/catalog/product-tabs";
import { SpecEditor } from "../../../../components/catalog/spec-editor";
import { ResearchNotes } from "../../../../components/catalog/proposal-review";
import { reviewHref } from "../../../../lib/review-tabs";
import {
  PublicationPanel,
  ReviewHistory,
  ReviewPanel,
} from "../../../../components/catalog/workflow";
import { ListingForm } from "../../../../components/catalog/listing-form";
import { ProductSeoForm } from "../../../../components/catalog/product-seo-form";
import {
  CategoryTranslationForm,
  ImageAltTranslationForm,
  LanguageSummary,
  LanguageTabs,
  ListingSeoTranslationForm,
  ListingTranslationForm,
  SourceToggle,
  SpecNamesTranslationForm,
  TranslationSection,
} from "../../../../components/catalog/translation-editor";
import { localeLabel, parseLang } from "../../../../lib/translations";
import {
  PageHeader,
  pickSite,
  ProductHeaderStatus,
  SITE_SHORT,
  siteParam,
  SiteStatusPill,
} from "../../../../components/catalog/parts";
import {
  ProductMasterForm,
  ProductStateButton,
} from "../../../../components/catalog/product-master-form";
import { Icon } from "../../../../components/icons";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../../components/ui";
import { parseProductTab } from "../../../../lib/product-tabs";
import {
  blockedSiteCount,
  headerStatus,
  siteDisplayStatus,
} from "../../../../lib/publication-status";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { bvPublicOrigin, siteSeoDefaults } from "../../../../lib/seo-server";
import { requireStaffSession } from "../../../../lib/server-session";

const CATALOG = "/api/v1/admin/catalog";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  // i18n-ignore: IANA time zone, not UI text
  timeZone: "Europe/Amsterdam",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.detail.page.metaTitle") };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  await requireStaffSession();
  const [{ id }, query, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslator(),
    getAdminLocale(),
  ]);
  const formatDate = (iso: string) => dateTimeFormat(locale, DATE_TIME).format(new Date(iso));
  if (!UUID.test(id)) notFound();
  const context = await serverRead(`${CATALOG}/context`, CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <EmptyState icon="shield" title={t("catalog.detail.page.noAccess.title")}>
        {t("catalog.detail.page.noAccess.text")}
      </EmptyState>
    );
  }
  const { sites, canEditMaster } = context.data;
  const site = pickSite(sites, typeof query["site"] === "string" ? query["site"] : undefined);
  const [detail, categories, specs, images, workflow, documents, xrefs] = await Promise.all([
    serverRead(`${CATALOG}/products/${id}?siteId=${site.id}`, ProductDetailResponseSchema),
    serverRead(`${CATALOG}/sites/${site.id}/categories`, CategoryListResponseSchema),
    serverRead(`${CATALOG}/products/${id}/specs`, ProductSpecsResponseSchema),
    serverRead(`${CATALOG}/products/${id}/images`, ProductImageListResponseSchema),
    serverRead(`${CATALOG}/products/${id}/workflow`, ProductWorkflowResponseSchema),
    serverRead(`${CATALOG}/products/${id}/documents`, ProductDocumentListResponseSchema),
    serverRead(
      `${CATALOG}/products/${id}/cross-references`,
      ProductCrossReferenceListResponseSchema,
    ),
  ]);
  if (!detail.ok && detail.status === 404) notFound();
  const sp = siteParam(site);
  const back = { href: `/products?site=${sp}`, label: t("catalog.detail.page.back") };
  if (!detail.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="products" title={t("catalog.detail.page.title")} back={back} />
        <ErrorState title={t("catalog.detail.page.loadError.title")}>
          {t("catalog.detail.page.loadError.text")}
        </ErrorState>
      </div>
    );
  }
  const { product, listing } = detail.data;
  const archived = product.status === "ARCHIVED";

  const imageItems = images.ok ? images.data.items : [];
  const specCount = specs.ok ? specs.data.values.length : 0;
  const documentItems = documents.ok ? documents.data.items : [];
  const activeDocuments = documentItems.filter((d) => d.status === "ACTIVE").length;
  const xrefItems = xrefs.ok ? xrefs.data.items : [];
  const liveXrefs = xrefItems.filter((x) => x.status !== "REMOVED").length;
  // PM-6: evidence for a verification is the active revision of an active technical document.
  const xrefSources = documentItems
    .filter((d) => d.status === "ACTIVE" && d.activeRevision)
    .map((d) => ({
      revisionId: d.activeRevision!.id,
      label: t("catalog.detail.page.xrefSource", {
        type: d.type,
        title: d.title,
        revision: d.activeRevision!.revisionNumber,
      }),
    }));
  const siteKeys = Object.fromEntries(sites.map((s) => [s.id, s.key]));
  // DP-197: Draft / Published / Unpublished per site (live = published and shown);
  // DP-203: Not listed when the site has no listing.
  const statusOf = (s: {
    publication: { status: "PUBLISHED" | "UNPUBLISHED" } | null;
    listing: { visibility: "VISIBLE" | "HIDDEN" } | null;
  }) =>
    siteDisplayStatus({
      publication: s.publication,
      listing: s.listing?.visibility ?? null,
      productStatus: product.status,
    });
  const currentSite = workflow.ok
    ? (workflow.data.sites.find((s) => s.siteId === site.id) ?? null)
    : null;
  // Publication: one red marker when a listed site cannot be published or republished as it
  // stands. DP-197: the same plan as the site cards; DP-203: an unlisted site is no blocker.
  const blockedSites = workflow.ok
    ? blockedSiteCount(workflow.data.sites, workflow.data.status)
    : 0;
  // DP-193: the site's research proposal, for "Copy into the form" on the listing.
  const siteProposal = workflow.ok
    ? (workflow.data.sites.find((s) => s.siteId === site.id)?.proposal ?? null)
    : null;
  const tab = parseProductTab(query["tab"]);
  // DP-180: the research notes of this site's proposal (review items and sources), read only.
  // ML-8b: the site's enabled languages (default first) and the texts of each other language.
  const languages = currentSite?.languages ?? [];
  const tabLocales: SiteLocale[] = languages.map((l, i) => ({
    locale: l.locale,
    enabled: true,
    public: l.public,
    isDefault: l.isDefault,
    sortOrder: i,
  }));
  const defaultLocale = languages.find((l) => l.isDefault)?.locale ?? "en";
  const lang = parseLang(query["lang"], tabLocales);
  const others = languages.filter((l) => !l.isDefault);
  const [research, siteSeo, ...translationReads] = await Promise.all([
    siteProposal
      ? serverRead(`${CATALOG}/proposals/${siteProposal.id}`, ProposalResponseSchema)
      : null,
    siteSeoDefaults(site.id),
    ...others.map((l) =>
      serverRead(
        `${CATALOG}/products/${id}/translations?siteId=${site.id}&locale=${encodeURIComponent(l.locale)}`,
        ProductTranslationsResponseSchema,
      ),
    ),
  ]);
  const translations = new Map<string, ProductTranslationsResponse | null>(
    others.map((l, i) => {
      const r = translationReads[i];
      return [l.locale, r && r.ok ? r.data : null];
    }),
  );
  const languageStates = Object.fromEntries(languages.map((l) => [l.locale, l.state]));
  /** The editors of one other language on the Content tab. */
  const contentPanel = (locale: string) => {
    const data = translations.get(locale) ?? null;
    const name = localeLabel(locale, t);
    if (!data) {
      return (
        <ErrorState title={t("catalog.detail.page.translation.loadError", { language: name })}>
          {t("catalog.detail.page.tryAgain")}
        </ErrorState>
      );
    }
    const v = (o: { version: number }) => o.version;
    return (
      <Panel
        id={`listing-${locale}`}
        title={t("catalog.detail.page.translation.title", {
          language: name,
          site: SITE_SHORT[site.key],
        })}
        description={t("catalog.detail.page.translation.description", { language: name })}
      >
        <SourceToggle locale={defaultLocale}>
          <div className="space-y-4">
            <LanguageSummary data={data} />
            <TranslationSection
              title={t("catalog.detail.page.translation.productText")}
              state={data.listing?.state ?? null}
            >
              <KeepUnsaved
                // i18n-ignore: remount key, not UI text
                resetKey={`tr-${locale}-listing-${data.listing?.version ?? 0}`}
              >
                <ListingTranslationForm productId={product.id} data={data} canEdit={site.canEdit} />
              </KeepUnsaved>
            </TranslationSection>
            {data.category ? (
              <TranslationSection
                title={t("catalog.detail.page.translation.category")}
                state={data.category.state}
                description={t("catalog.detail.page.translation.categoryDescription")}
              >
                <KeepUnsaved
                  // i18n-ignore: remount key, not UI text
                  resetKey={`tr-${locale}-category-${v(data.category)}`}
                >
                  <CategoryTranslationForm
                    category={data.category}
                    locale={locale}
                    enabled={data.enabled}
                    canEdit={site.canEdit}
                    // i18n-ignore: element id prefix, not UI text
                    idPrefix={`tr-${locale}-category`}
                  />
                </KeepUnsaved>
              </TranslationSection>
            ) : null}
            <TranslationSection
              title={t("catalog.detail.page.translation.specNames")}
              state={null}
              description={t("catalog.detail.page.translation.specNamesDescription")}
            >
              <KeepUnsaved
                // i18n-ignore: remount key, not UI text
                resetKey={`tr-${locale}-specs-${data.specs.map(v).join(".")}`}
              >
                <SpecNamesTranslationForm
                  rows={data.specs.map((s) => ({ ...s, id: s.definitionId }))}
                  locale={locale}
                  enabled={data.enabled}
                  canEdit={canEditMaster && !archived}
                  idPrefix={`tr-${locale}`}
                />
              </KeepUnsaved>
            </TranslationSection>
            <TranslationSection
              title={t("catalog.detail.page.translation.imageAlts")}
              state={null}
              description={t("catalog.detail.page.translation.imageAltsDescription")}
            >
              <KeepUnsaved
                // i18n-ignore: remount key, not UI text
                resetKey={`tr-${locale}-alts-${data.images.map(v).join(".")}`}
              >
                <ImageAltTranslationForm data={data} canEdit={canEditMaster && !archived} />
              </KeepUnsaved>
            </TranslationSection>
          </div>
        </SourceToggle>
      </Panel>
    );
  };
  /** The SEO texts of one other language on the SEO tab. */
  const seoPanel = (locale: string) => {
    const data = translations.get(locale) ?? null;
    const name = localeLabel(locale, t);
    if (!data) {
      return (
        <ErrorState title={t("catalog.detail.page.translation.seoLoadError", { language: name })}>
          {t("catalog.detail.page.tryAgain")}
        </ErrorState>
      );
    }
    return (
      <Panel
        id={`seo-${locale}`}
        title={t("catalog.detail.page.translation.seoTitle", {
          language: name,
          site: SITE_SHORT[site.key],
        })}
      >
        <SourceToggle locale={defaultLocale}>
          <KeepUnsaved
            // i18n-ignore: remount key, not UI text
            resetKey={`tr-${locale}-seo-${data.listing?.version ?? 0}`}
          >
            <ListingSeoTranslationForm productId={product.id} data={data} canEdit={site.canEdit} />
          </KeepUnsaved>
        </SourceToggle>
      </Panel>
    );
  };

  return (
    <NoticeProvider>
      <div className="space-y-6 sm:space-y-8">
        <PageHeader
          icon="products"
          title={product.name}
          back={back}
          description={
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="sr-only">{`${t("catalog.detail.page.sku")} `}</span>
              <span className="tabular rounded-md bg-surface-2 px-2 py-0.5 font-mono text-ink-2 ring-1 ring-line">
                {product.code}
              </span>
              {/* DP-203: the site publication status first; the master status apart, labelled. */}
              {workflow.ok ? (
                <ProductHeaderStatus status={headerStatus(workflow.data.sites, product.status)} />
              ) : (
                <ProductHeaderStatus status={{ sites: [], master: product.status }} />
              )}
              <span className="text-ink-3">
                {t("catalog.detail.page.versionChanged", {
                  version: product.version,
                  date: formatDate(product.updatedAt),
                })}
              </span>
            </span>
          }
          actions={canEditMaster ? <ProductStateButton product={product} /> : undefined}
        />

        <ProductTabs
          productId={product.id}
          siteParam={sp}
          initialTab={tab}
          badges={{
            technical: { count: specCount },
            media: { count: imageItems.length + activeDocuments },
            publication: {
              ...(blockedSites > 0
                ? {
                    alert: t("catalog.detail.page.blocked", { count: blockedSites }),
                  }
                : {}),
            },
          }}
        >
          {/* 1. Content (DP-202): the selected site's own texts first — what its product page
              shows — then the shared master content, collapsed and clearly secondary. */}
          <ProductTabPanel tab="content">
            <div id="listing" className="scroll-mt-32 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <ProductSiteSwitcher sites={sites} current={site.id} />
                <p className="text-sm text-ink-3">{t("catalog.detail.page.content.chooseSite")}</p>
              </div>
              <LanguageTabs
                label={t("catalog.detail.page.content.language")}
                locales={tabLocales}
                initial={lang}
                states={languageStates}
                panels={{
                  ...Object.fromEntries(others.map((l) => [l.locale, contentPanel(l.locale)])),
                  [defaultLocale]: (
                    <Panel
                      id="listing-panel"
                      title={t("catalog.detail.page.content.title", { site: SITE_SHORT[site.key] })}
                      description={
                        listing
                          ? t("catalog.detail.page.content.description", {
                              site: SITE_SHORT[site.key],
                              version: listing.version,
                              date: formatDate(listing.updatedAt),
                            })
                          : t("catalog.detail.page.content.notListed")
                      }
                      action={
                        !listing ? (
                          <SiteStatusPill status="NOT_LISTED" />
                        ) : currentSite ? (
                          <SiteStatusPill status={statusOf(currentSite)} />
                        ) : undefined
                      }
                    >
                      {categories.ok && categories.data.items.length === 0 && !listing ? (
                        <EmptyState
                          icon="folder"
                          title={t("catalog.detail.page.content.noCategories.title")}
                          {...(site.canEdit
                            ? {
                                action: {
                                  href: `/products/categories?site=${sp}`,
                                  label: t("catalog.detail.page.content.noCategories.action"),
                                },
                              }
                            : {})}
                        >
                          {t("catalog.detail.page.content.noCategories.text")}
                        </EmptyState>
                      ) : (
                        // DP-209: kept while it has unsaved edits (an SEO save also raises the
                        // listing version); remounted with the new version once it is clean.
                        <KeepUnsaved resetKey={`${site.id}-${listing?.version ?? 0}`}>
                          <ListingForm
                            productId={product.id}
                            siteId={site.id}
                            siteName={SITE_SHORT[site.key]}
                            listing={listing}
                            categories={categories.ok ? categories.data.items : []}
                            canEdit={site.canEdit}
                            proposal={siteProposal}
                            shared={{
                              name: product.name,
                              summary: product.summary,
                              description: product.description,
                            }}
                          />
                        </KeepUnsaved>
                      )}
                    </Panel>
                  ),
                }}
              />
              <p className="px-1 text-xs text-ink-3">
                {t("catalog.detail.page.content.savingNote.before")}{" "}
                <TabLink
                  tab="publication"
                  section="publication"
                  className="font-medium text-petrol-strong underline underline-offset-2"
                >
                  {t("catalog.detail.page.content.savingNote.link")}
                </TabLink>{" "}
                {t("catalog.detail.page.content.savingNote.after")}
              </p>
            </div>

            <details
              id="master"
              className="group scroll-mt-32 rounded-2xl border border-line bg-surface shadow-panel"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-2xl px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-petrol/40 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="type-display block text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
                    {t("catalog.detail.page.content.shared.title")}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-3">
                    {t("catalog.detail.page.content.shared.description")}
                  </span>
                </span>
                <Icon
                  name="chevron"
                  size={18}
                  className="mt-1 shrink-0 rotate-90 text-ink-3 transition-transform group-open:-rotate-90"
                />
              </summary>
              <div className="space-y-4 border-t border-line px-5 pb-5 pt-4 sm:px-6">
                <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2 ring-1 ring-inset ring-line">
                  <Icon name="eye" size={16} className="mt-0.5 shrink-0 text-ink-3" />
                  <span>{t("catalog.detail.page.content.shared.note")}</span>
                </p>
                <KeepUnsaved resetKey={`${product.id}-${product.version}`}>
                  <ProductMasterForm product={product} canEdit={canEditMaster} siteParam={sp} />
                </KeepUnsaved>
              </div>
            </details>
          </ProductTabPanel>

          {/* 2. Technical: specifications with their validation, and cross-references. */}
          <ProductTabPanel tab="technical">
            <Panel
              id="specs"
              className="scroll-mt-32"
              title={t("catalog.detail.page.specs.title")}
              description={t("catalog.detail.page.specs.description")}
              action={
                specs.ok ? (
                  <span className="text-xs text-ink-3">
                    {t("catalog.detail.page.specs.filled", {
                      filled: specs.data.values.length,
                      total: specs.data.definitions.length,
                    })}
                  </span>
                ) : undefined
              }
            >
              {specs.ok ? (
                <KeepUnsaved resetKey={`specs-${specs.data.productVersion}`}>
                  <SpecEditor
                    productId={product.id}
                    data={specs.data}
                    canEdit={canEditMaster}
                    archived={archived}
                  />
                </KeepUnsaved>
              ) : (
                <ErrorState title={t("catalog.detail.page.specs.loadError")}>
                  {t("catalog.detail.page.tryAgain")}
                </ErrorState>
              )}
            </Panel>

            <Panel
              id="cross-references"
              className="scroll-mt-32"
              title={t("catalog.detail.page.xrefs.title")}
              description={t("catalog.detail.page.xrefs.description")}
              action={
                <span className="text-xs text-ink-3">
                  {t("catalog.detail.page.xrefs.active", { n: liveXrefs })}
                </span>
              }
            >
              {xrefs.ok ? (
                <CrossReferenceManager
                  key={xrefItems.map((x) => `${x.id}:${x.version}`).join(",")}
                  productId={product.id}
                  items={xrefItems}
                  canEdit={xrefs.data.canEdit}
                  canApprove={xrefs.data.canApprove}
                  productArchived={archived}
                  sources={xrefSources}
                />
              ) : (
                <ErrorState title={t("catalog.detail.page.xrefs.loadError")}>
                  {t("catalog.detail.page.tryAgain")}
                </ErrorState>
              )}
            </Panel>

            <Panel
              id="research"
              className="scroll-mt-32"
              title={t("catalog.detail.page.research.title")}
              description={t("catalog.detail.page.research.description")}
              action={
                research?.ok ? (
                  <span className="text-xs text-ink-3">
                    {t("catalog.detail.page.research.items", {
                      n: research.data.proposal.reviewData.items.length,
                    })}
                  </span>
                ) : undefined
              }
            >
              {!siteProposal ? (
                <p className="text-sm text-ink-3">
                  {t("catalog.detail.page.research.none", { site: SITE_SHORT[site.key] })}
                </p>
              ) : research?.ok ? (
                <ResearchNotes
                  proposal={research.data.proposal}
                  reviewHref={reviewHref(siteProposal.id, sp, "verification")}
                  t={t}
                />
              ) : (
                <ErrorState title={t("catalog.detail.page.research.loadError")}>
                  {t("catalog.detail.page.tryAgain")}
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>

          {/* 3. Media & Documents: cover, gallery and PDF revisions. */}
          <ProductTabPanel tab="media">
            <Panel
              id="images"
              className="scroll-mt-32"
              title={t("catalog.detail.page.images.title")}
              description={t("catalog.detail.page.images.description")}
            >
              {images.ok ? (
                <ImageManager
                  key={imageItems.map((i) => `${i.id}:${i.version}:${i.sortOrder}`).join(",")}
                  productId={product.id}
                  initial={imageItems}
                  canEdit={canEditMaster}
                  archived={archived}
                />
              ) : (
                <ErrorState title={t("catalog.detail.page.images.loadError")}>
                  {t("catalog.detail.page.tryAgain")}
                </ErrorState>
              )}
            </Panel>

            <Panel
              id="documents"
              className="scroll-mt-32"
              title={t("catalog.detail.page.documents.title")}
              description={t("catalog.detail.page.documents.description")}
            >
              {documents.ok ? (
                <DocumentManager
                  key={documentItems.map((d) => `${d.id}:${d.version}`).join(",")}
                  productId={product.id}
                  initial={documentItems}
                  canEdit={documents.data.canEdit}
                  productArchived={archived}
                  languages={documents.data.languages}
                />
              ) : (
                <ErrorState title={t("catalog.detail.page.documents.loadError")}>
                  {t("catalog.detail.page.tryAgain")}
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>

          {/* 4. SEO (DP-209): the product's search and link-preview data on the selected site. */}
          <ProductTabPanel tab="seo">
            <div id="seo" className="scroll-mt-32 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <ProductSiteSwitcher sites={sites} current={site.id} />
                <p className="text-sm text-ink-3">{t("catalog.detail.page.seo.chooseSite")}</p>
              </div>
              <LanguageTabs
                label={t("catalog.detail.page.seo.language")}
                locales={tabLocales}
                initial={lang}
                states={Object.fromEntries(
                  others.map((l) => [
                    l.locale,
                    translations.get(l.locale)?.listing?.seoState ?? null,
                  ]),
                )}
                panels={{
                  ...Object.fromEntries(others.map((l) => [l.locale, seoPanel(l.locale)])),
                  [defaultLocale]: (
                    <Panel
                      id="seo-panel"
                      title={t("catalog.detail.page.seo.title", { site: SITE_SHORT[site.key] })}
                      description={
                        site.key === "BV"
                          ? t("catalog.detail.page.seo.descriptionBv")
                          : t("catalog.detail.page.seo.descriptionOther")
                      }
                      action={
                        currentSite?.outdated.listing ? (
                          <StatusPill tone="amber">
                            {t("catalog.detail.page.seo.outdated")}
                          </StatusPill>
                        ) : undefined
                      }
                    >
                      {!listing ? (
                        <p className="text-sm text-ink-3">
                          {t("catalog.detail.page.seo.listFirst")}
                        </p>
                      ) : (
                        <KeepUnsaved
                          // i18n-ignore: remount key, not UI text
                          resetKey={`seo-${site.id}-${listing.version}`}
                        >
                          <ProductSeoForm
                            productId={product.id}
                            siteId={site.id}
                            siteName={SITE_SHORT[site.key]}
                            listing={listing}
                            canEdit={site.canEdit}
                            productName={listing.text?.title ?? product.name}
                            productSummary={listing.text?.summary ?? product.summary}
                            path={`/products/${product.slug}`}
                            images={imageItems
                              .filter((i) => i.isPublic)
                              .map((i) => ({
                                id: i.id,
                                isCover: i.isCover,
                                label: i.isCover
                                  ? t("catalog.detail.page.seo.coverOption", {
                                      name: i.altText ?? i.originalFilename,
                                    })
                                  : (i.altText ?? i.originalFilename),
                              }))}
                            siteSeo={siteSeo}
                            origin={site.key === "BV" ? bvPublicOrigin() : null}
                          />
                        </KeepUnsaved>
                      )}
                    </Panel>
                  ),
                }}
              />
            </div>
          </ProductTabPanel>

          {/* 5. Publication: review, per-site readiness and blockers, publish, history. */}
          <ProductTabPanel tab="publication">
            {workflow.ok ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                <Panel
                  id="publication"
                  className="scroll-mt-32 xl:col-span-3"
                  title={t("catalog.detail.page.publication.title")}
                  description={t("catalog.detail.page.publication.description")}
                >
                  <PublicationPanel
                    data={workflow.data}
                    productSlug={product.slug}
                    canEditSite={Object.fromEntries(sites.map((s) => [s.id, s.canEdit]))}
                  />
                </Panel>
                <Panel
                  id="review"
                  className="scroll-mt-32 xl:col-span-2"
                  title={t("catalog.detail.page.review.title")}
                  description={t("catalog.detail.page.review.description")}
                  action={
                    <ProductHeaderStatus status={{ sites: [], master: workflow.data.status }} />
                  }
                >
                  <KeepUnsaved resetKey={`review-${workflow.data.version}`}>
                    <ReviewPanel data={workflow.data} />
                  </KeepUnsaved>
                </Panel>
              </div>
            ) : (
              <ErrorState title={t("catalog.detail.page.publication.loadError")}>
                {t("catalog.detail.page.tryAgain")}
              </ErrorState>
            )}

            <Panel
              id="history"
              className="scroll-mt-32"
              title={t("catalog.detail.page.history.title")}
              description={t("catalog.detail.page.history.description")}
            >
              {workflow.ok ? (
                <ReviewHistory events={workflow.data.history} siteKeys={siteKeys} />
              ) : (
                <ErrorState title={t("catalog.detail.page.history.loadError")}>
                  {t("catalog.detail.page.tryAgain")}
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>
        </ProductTabs>
      </div>
    </NoticeProvider>
  );
}
