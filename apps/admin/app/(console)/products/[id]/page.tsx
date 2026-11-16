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
  ProductWorkflowResponseSchema,
  ProposalResponseSchema,
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
import {
  PageHeader,
  pickSite,
  ProductStatusPill,
  SITE_SHORT,
  siteParam,
  VisibilityPill,
} from "../../../../components/catalog/parts";
import {
  ProductMasterForm,
  ProductStateButton,
} from "../../../../components/catalog/product-master-form";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../../components/ui";
import { parseProductTab } from "../../../../lib/product-tabs";
import { serverRead } from "../../../../lib/server-api";
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
  const liveCount = workflow.ok
    ? workflow.data.sites.filter((s) => s.publication?.status === "PUBLISHED").length
    : 0;

  // Publication: one red marker when no site can be published or republished as it stands.
  const blockedSites = workflow.ok ? workflow.data.sites.filter((s) => !s.readiness.ok).length : 0;
  // DP-193: the site's research proposal, for "Copy into the form" on the listing.
  const siteProposal = workflow.ok
    ? (workflow.data.sites.find((s) => s.siteId === site.id)?.proposal ?? null)
    : null;
  const tab = parseProductTab(query["tab"]);
  // DP-180: the research notes of this site's proposal (review items and sources), read only.
  const research = siteProposal
    ? await serverRead(`${CATALOG}/proposals/${siteProposal.id}`, ProposalResponseSchema)
    : null;

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
              <ProductStatusPill status={product.status} />
              {workflow.ok ? (
                <StatusPill tone={liveCount > 0 ? "success" : "neutral"}>
                  {liveCount > 0
                    ? `Live on ${liveCount} of ${workflow.data.sites.length} site${workflow.data.sites.length === 1 ? "" : "s"}`
                    : "Not live"}
                </StatusPill>
              ) : null}
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
          {/* 1. Content: platform-wide master texts, then this site's listing and texts. */}
          <ProductTabPanel tab="content">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              <Panel
                id="master"
                className="scroll-mt-32 xl:col-span-3"
                title="Product master"
                description="Name, code, summary and description: platform-wide, the same on every site."
              >
                <KeepUnsaved resetKey={`${product.id}-${product.version}`}>
                  <ProductMasterForm product={product} canEdit={canEditMaster} siteParam={sp} />
                </KeepUnsaved>
              </Panel>

              <div id="listing" className="scroll-mt-32 space-y-4 xl:col-span-2">
                <ProductSiteSwitcher sites={sites} current={site.id} />
                <Panel
                  id="listing-panel"
                  title={`Listing on ${SITE_SHORT[site.key]}`}
                  description={
                    listing
                      ? `Version ${listing.version} · changed ${DATE_TIME.format(new Date(listing.updatedAt))}`
                      : "This site does not list the product yet."
                  }
                  action={<VisibilityPill visibility={listing?.visibility ?? null} />}
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
                    <ListingForm
                      key={`${site.id}-${listing?.version ?? 0}`}
                      productId={product.id}
                      siteId={site.id}
                      siteName={SITE_SHORT[site.key]}
                      listing={listing}
                      categories={categories.ok ? categories.data.items : []}
                      canEdit={site.canEdit}
                      productArchived={archived}
                      proposal={siteProposal}
                    />
                  )}
                </Panel>
                <p className="px-1 text-xs text-ink-3">
                  Saving changes nothing on the live site. Preview and publish on the{" "}
                  <TabLink
                    tab="publication"
                    section="publication"
                    className="font-medium text-petrol-strong underline underline-offset-2"
                  >
                    Publication
                  </TabLink>{" "}
                  tab. A hidden listing takes a published product off this site at once.
                </p>
              </div>
            </div>
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
                />
              ) : (
                <ErrorState title="The documents could not be loaded">
                  Try again in a moment.
                </ErrorState>
              )}
            </Panel>
          </ProductTabPanel>

          {/* 4. Publication: review, per-site readiness and blockers, publish, history. */}
          <ProductTabPanel tab="publication">
            {workflow.ok ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                <Panel
                  id="publication"
                  className="scroll-mt-32 xl:col-span-3"
                  title="Publication"
                  description="Preview, publish and unpublish per site. A live site shows the published snapshot, never the current draft; every blocker says where it is fixed."
                >
                  <PublicationPanel data={workflow.data} productSlug={product.slug} />
                </Panel>
                <Panel
                  id="review"
                  className="scroll-mt-32 xl:col-span-2"
                  title="Second-person review"
                  description="Optional when you can publish directly. Publishers without approval rights publish an approved master only."
                  action={<ProductStatusPill status={workflow.data.status} />}
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
