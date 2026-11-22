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
import { serverRead } from "../../../../lib/server-api";
import { bvPublicOrigin, siteSeoDefaults } from "../../../../lib/seo-server";
import { requireStaffSession } from "../../../../lib/server-session";

const CATALOG = "/api/v1/admin/catalog";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  await requireStaffSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const context = await serverRead(`${CATALOG}/context`, CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <EmptyState icon="shield" title="No access to the product catalogue">
        Your roles do not include reading products on any site.
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
  const back = { href: `/products?site=${sp}`, label: "All products" };
  if (!detail.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="products" title="Product" back={back} />
        <ErrorState title="This product could not be loaded">
          You are not allowed to read products on this site.
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
      label: `${d.type} · ${d.title} · revision ${d.activeRevision!.revisionNumber}`,
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
    const t = translations.get(locale) ?? null;
    const name = localeLabel(locale);
    if (!t) {
      return (
        <ErrorState title={`The ${name} texts could not be loaded`}>
          Try again in a moment.
        </ErrorState>
      );
    }
    const v = (o: { version: number }) => o.version;
    return (
      <Panel
        id={`listing-${locale}`}
        title={`${name} texts on ${SITE_SHORT[site.key]}`}
        description={`Everything a visitor reads about this product in ${name}, next to its English source. Codes, values, units, standards and brands stay as they are in every language.`}
      >
        <SourceToggle locale={defaultLocale}>
          <div className="space-y-4">
            <LanguageSummary data={t} />
            <TranslationSection title="Product text" state={t.listing?.state ?? null}>
              <KeepUnsaved resetKey={`tr-${locale}-listing-${t.listing?.version ?? 0}`}>
                <ListingTranslationForm productId={product.id} data={t} canEdit={site.canEdit} />
              </KeepUnsaved>
            </TranslationSection>
            {t.category ? (
              <TranslationSection
                title="Category"
                state={t.category.state}
                description="The name of this product's category on the site; shared by every product in it."
              >
                <KeepUnsaved resetKey={`tr-${locale}-category-${v(t.category)}`}>
                  <CategoryTranslationForm
                    category={t.category}
                    locale={locale}
                    enabled={t.enabled}
                    canEdit={site.canEdit}
                    idPrefix={`tr-${locale}-category`}
                  />
                </KeepUnsaved>
              </TranslationSection>
            ) : null}
            <TranslationSection
              title="Specification names"
              state={null}
              description="The names of this product's technical values (the values themselves are the same in every language)."
            >
              <KeepUnsaved resetKey={`tr-${locale}-specs-${t.specs.map(v).join(".")}`}>
                <SpecNamesTranslationForm
                  rows={t.specs.map((s) => ({ ...s, id: s.definitionId }))}
                  locale={locale}
                  enabled={t.enabled}
                  canEdit={canEditMaster && !archived}
                  idPrefix={`tr-${locale}`}
                />
              </KeepUnsaved>
            </TranslationSection>
            <TranslationSection
              title="Image alt texts"
              state={null}
              description="What a screen reader says for each image; the images themselves are shared."
            >
              <KeepUnsaved resetKey={`tr-${locale}-alts-${t.images.map(v).join(".")}`}>
                <ImageAltTranslationForm data={t} canEdit={canEditMaster && !archived} />
              </KeepUnsaved>
            </TranslationSection>
          </div>
        </SourceToggle>
      </Panel>
    );
  };
  /** The SEO texts of one other language on the SEO tab. */
  const seoPanel = (locale: string) => {
    const t = translations.get(locale) ?? null;
    const name = localeLabel(locale);
    if (!t) {
      return (
        <ErrorState title={`The ${name} SEO texts could not be loaded`}>
          Try again in a moment.
        </ErrorState>
      );
    }
    return (
      <Panel id={`seo-${locale}`} title={`${name} SEO on ${SITE_SHORT[site.key]}`}>
        <SourceToggle locale={defaultLocale}>
          <KeepUnsaved resetKey={`tr-${locale}-seo-${t.listing?.version ?? 0}`}>
            <ListingSeoTranslationForm productId={product.id} data={t} canEdit={site.canEdit} />
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
              <span className="sr-only">SKU </span>
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
                Version {product.version} · changed {DATE_TIME.format(new Date(product.updatedAt))}
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
                    alert: `publishing blocked on ${blockedSites} site${blockedSites === 1 ? "" : "s"}`,
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
                <p className="text-sm text-ink-3">Choose the site whose product text you edit.</p>
              </div>
              <LanguageTabs
                label="Language of the product text"
                locales={tabLocales}
                initial={lang}
                states={languageStates}
                panels={{
                  ...Object.fromEntries(others.map((l) => [l.locale, contentPanel(l.locale)])),
                  [defaultLocale]: (
                    <Panel
                      id="listing-panel"
                      title={`Product text on ${SITE_SHORT[site.key]}`}
                      description={
                        listing
                          ? `What the ${SITE_SHORT[site.key]} product page shows. Version ${listing.version} · changed ${DATE_TIME.format(new Date(listing.updatedAt))}`
                          : "This site does not list the product yet."
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
                          title="No categories on this site"
                          {...(site.canEdit
                            ? {
                                action: {
                                  href: `/products/categories?site=${sp}`,
                                  label: "Create categories",
                                },
                              }
                            : {})}
                        >
                          A product is listed in one of the site&apos;s categories. Create the first
                          category to list products here.
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
                Saving never publishes, unpublishes or changes the live site. Preview and publish on
                the{" "}
                <TabLink
                  tab="publication"
                  section="publication"
                  className="font-medium text-petrol-strong underline underline-offset-2"
                >
                  Publication
                </TabLink>{" "}
                tab.
              </p>
            </div>

            <details
              id="master"
              className="group scroll-mt-32 rounded-2xl border border-line bg-surface shadow-panel"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-2xl px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-petrol/40 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="type-display block text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
                    Shared product content
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-3">
                    Name, code, URL slug and a shared summary and description, the same for every
                    site. Not published as such: a site shows its own text above.
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
                  <span>
                    The shared summary and description appear on a site only where that site&apos;s
                    own field is empty, and only after the site is published again. Editing them
                    never changes a site&apos;s own text.
                  </span>
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
              title="Technical specifications"
              description="Platform-wide values of this product master; never copied per site. The validation report checks the values as you type."
              action={
                specs.ok ? (
                  <span className="text-xs text-ink-3">
                    {specs.data.values.length} of {specs.data.definitions.length} filled
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
                <ErrorState title="The specifications could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>

            <Panel
              id="cross-references"
              className="scroll-mt-32"
              title="Cross-references"
              description="Other brands' products related to this product master: similar, or verified against a source document."
              action={<span className="text-xs text-ink-3">{liveXrefs} active</span>}
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
                <ErrorState title="The cross-references could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>

            <Panel
              id="research"
              className="scroll-mt-32"
              title="Research notes"
              description="What the research found for this product on this site: questions, missing documents, conflicts, claim risks, values held for verification and sources. Never published."
              action={
                research?.ok ? (
                  <span className="text-xs text-ink-3">
                    {research.data.proposal.reviewData.items.length} items
                  </span>
                ) : undefined
              }
            >
              {!siteProposal ? (
                <p className="text-sm text-ink-3">
                  There is no research proposal for this product on {SITE_SHORT[site.key]}.
                </p>
              ) : research?.ok ? (
                <ResearchNotes
                  proposal={research.data.proposal}
                  reviewHref={reviewHref(siteProposal.id, sp, "verification")}
                />
              ) : (
                <ErrorState title="The research notes could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>

          {/* 3. Media & Documents: cover, gallery and PDF revisions. */}
          <ProductTabPanel tab="media">
            <Panel
              id="images"
              className="scroll-mt-32"
              title="Product images"
              description="One cover and a gallery. Originals stay private; live sites get metadata-free WebP copies of published images only."
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
                <ErrorState title="The images could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>

            <Panel
              id="documents"
              className="scroll-mt-32"
              title="Technical documents"
              description="TDS, SDS, COA and other PDFs of this product master. Every upload is a new, unchangeable revision."
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
                <ErrorState title="The documents could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>

          {/* 4. SEO (DP-209): the product's search and link-preview data on the selected site. */}
          <ProductTabPanel tab="seo">
            <div id="seo" className="scroll-mt-32 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <ProductSiteSwitcher sites={sites} current={site.id} />
                <p className="text-sm text-ink-3">Choose the site whose SEO you edit.</p>
              </div>
              <LanguageTabs
                label="Language of the SEO texts"
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
                      title={`SEO on ${SITE_SHORT[site.key]}`}
                      description={
                        site.key === "BV"
                          ? "Search result and link preview of the product page. Saved on the site listing; the site shows it after the next publication. A product that is not published or not shown is never indexed."
                          : "Only the BV site uses product SEO for now."
                      }
                      action={
                        currentSite?.outdated.listing ? (
                          <StatusPill tone="amber">Changes not published</StatusPill>
                        ) : undefined
                      }
                    >
                      {!listing ? (
                        <p className="text-sm text-ink-3">
                          List the product on this site first (Content tab).
                        </p>
                      ) : (
                        <KeepUnsaved resetKey={`seo-${site.id}-${listing.version}`}>
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
                                label: `${i.isCover ? "Cover · " : ""}${i.altText ?? i.originalFilename}`,
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
                  title="Publication"
                  description="Preview, publish and unpublish per site. A live site shows the published snapshot, never the current draft; every blocker says where it is fixed."
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
                  title="Second-person review"
                  description="Optional when you can publish directly. Publishers without approval rights publish an approved master only."
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
              <ErrorState title="The publication status could not be loaded">
                Try again in a moment.
              </ErrorState>
            )}

            <Panel
              id="history"
              className="scroll-mt-32"
              title="Review and publication history"
              description="Every submission, decision and publication, newest first. It cannot be edited."
            >
              {workflow.ok ? (
                <ReviewHistory events={workflow.data.history} siteKeys={siteKeys} />
              ) : (
                <ErrorState title="The history could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>
        </ProductTabs>
      </div>
    </NoticeProvider>
  );
}
