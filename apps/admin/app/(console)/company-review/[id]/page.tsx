import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CategoryListResponseSchema,
  ProductDetailResponseSchema,
  ProductDocumentListResponseSchema,
  ProductImageListResponseSchema,
  ProductSpecsResponseSchema,
  ProposalResponseSchema,
  type ReviewItemKind,
} from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { PreviewLinkButton } from "../../../../components/catalog/preview-link-button";
import { ProposalDecision } from "../../../../components/catalog/proposal-decision";
import { ProposalTextEditor } from "../../../../components/catalog/proposal-editor";
import {
  ClaimRisks,
  ContentComparison,
  CurrentSiteData,
  CurrentTechnicalData,
  DocumentsCheck,
  HeldValues,
  OpenPoints,
  ProposalHistory,
  ProposalStatusPill,
  ReviewItems,
  SourceTag,
  SourcesPanel,
  VerificationNav,
} from "../../../../components/catalog/proposal-review";
import {
  ReviewTabLink,
  ReviewTabPanel,
  ReviewTabs,
} from "../../../../components/catalog/review-tabs";
import { Icon } from "../../../../components/icons";
import { ErrorState, Panel } from "../../../../components/ui";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import {
  COMPANY_REVIEW_PATH,
  decisionBlockedText,
  statusHint,
} from "../../../../lib/proposals-view";
import { parseReviewTab, reviewAttention } from "../../../../lib/review-tabs";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

const CATALOG = "/api/v1/admin/catalog";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("companyReview.title") };
}

/**
 * DP-172 (ADR-022), DP-189: one product in the company review, in four tabs (Content Review,
 * Missing & Verification, Sources, History). Current site data, the research proposal and the
 * review items keep their provenance tags; DP-002 held values have a block of their own and are
 * never shown as product specifications. The decision (approve, request changes) is in Content
 * Review; the API decides who may make it.
 *
 * DP-191: a user who may revise proposals on the site edits the proposed text in Content Review
 * (the current site text stays next to it as the reference); everyone else sees the comparison.
 */
export default async function CompanyReviewProductPage({
  params,
  searchParams,
}: PageProps<"/company-review/[id]">) {
  await requireStaffSession();
  const [{ id }, query, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslator(),
    getAdminLocale(),
  ]);
  if (!UUID.test(id)) notFound();
  const site = typeof query["site"] === "string" ? query["site"] : undefined;
  const back = {
    href: `${COMPANY_REVIEW_PATH}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
    label: t("companyReview.allProposals"),
  };
  const res = await serverRead(`${CATALOG}/proposals/${id}`, ProposalResponseSchema);
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title={t("companyReview.title")} back={back} />
        <ErrorState title={t("companyReview.detail.loadErrorTitle")}>
          {t("companyReview.detail.loadErrorText")}
        </ErrorState>
      </div>
    );
  }
  const { proposal, events, canDecide, canRevise, decisionBlocked } = res.data;
  const pid = proposal.productId;
  const [detail, categories, specs, images, documents] = await Promise.all([
    serverRead(`${CATALOG}/products/${pid}?siteId=${proposal.siteId}`, ProductDetailResponseSchema),
    serverRead(`${CATALOG}/sites/${proposal.siteId}/categories`, CategoryListResponseSchema),
    serverRead(`${CATALOG}/products/${pid}/specs`, ProductSpecsResponseSchema),
    serverRead(`${CATALOG}/products/${pid}/images`, ProductImageListResponseSchema),
    serverRead(`${CATALOG}/products/${pid}/documents`, ProductDocumentListResponseSchema),
  ]);

  const counts: Partial<Record<ReviewItemKind, number>> = {};
  for (const i of proposal.reviewData.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  const attention = reviewAttention(counts);
  const specCount = specs.ok ? specs.data.values.length : 0;
  const verificationCount =
    attention.conflicts + attention.questions + attention.held + attention.missingDocuments;
  const blocked = canDecide ? null : decisionBlockedText(decisionBlocked, t);
  const tab = parseReviewTab(query["tab"]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title={proposal.productName}
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="sr-only">{t("companyReview.detail.sku")} </span>
            <span
              data-sku=""
              className="tabular rounded-md bg-surface-2 px-2 py-0.5 font-mono text-ink-2 ring-1 ring-line"
            >
              {proposal.productCode}
            </span>
            <ProposalStatusPill status={proposal.status} t={t} />
            <span className="text-ink-3">
              {t("companyReview.detail.versionHint", {
                version: proposal.version,
                hint: statusHint(proposal.status, t),
              })}
            </span>
          </span>
        }
      />

      <ReviewTabs
        proposalId={proposal.id}
        site={site}
        initialTab={tab}
        badges={{
          verification: {
            count: verificationCount,
            ...(attention.conflicts > 0
              ? { alert: t("companyReview.count.conflicts", { count: attention.conflicts }) }
              : {}),
          },
          sources: { count: proposal.reviewData.sources.length },
          history: { count: events.length },
        }}
      >
        {/* 1. Content Review: the current text against the proposal, and the decision. */}
        <ReviewTabPanel tab="content">
          {blocked ? (
            <p
              role="status"
              data-decision-notice=""
              className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2 ring-1 ring-inset ring-line-strong"
            >
              <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-petrol-strong" />
              <span className="min-w-0">
                <span className="font-medium text-ink">{blocked.title}.</span>{" "}
                <ReviewTabLink tab="content" section="decision" className="underline">
                  {t("companyReview.detail.seeWhy")}
                </ReviewTabLink>
              </span>
            </p>
          ) : null}
          <OpenPoints attention={attention} t={t} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
            <div className="min-w-0 space-y-6">
              <CurrentSiteData
                detail={detail.ok ? detail.data : null}
                categories={categories.ok ? categories.data.items : []}
                images={images.ok ? images.data : null}
                t={t}
              />
              {canRevise && detail.ok ? (
                <ProposalTextEditor
                  proposalId={proposal.id}
                  version={proposal.version}
                  status={proposal.status}
                  text={{ summary: proposal.summary, description: proposal.description }}
                  current={{
                    summary: detail.data.listing?.text?.summary ?? detail.data.product.summary,
                    description:
                      detail.data.listing?.text?.description ?? detail.data.product.description,
                  }}
                  placeholder={proposal.reviewData.items.some((i) => i.kind === "PLACEHOLDER")}
                  tags={
                    <>
                      <SourceTag kind="site" t={t} />
                      <SourceTag kind="proposal" t={t} />
                    </>
                  }
                />
              ) : (
                <ContentComparison
                  detail={detail.ok ? detail.data : null}
                  proposal={proposal}
                  t={t}
                />
              )}
              <ClaimRisks proposal={proposal} t={t} />
            </div>
            <div className="min-w-0 space-y-6 xl:sticky xl:top-32">
              <Panel
                title={t("companyReview.detail.decision")}
                id="decision"
                className="scroll-mt-32"
              >
                <ProposalDecision
                  proposalId={proposal.id}
                  version={proposal.version}
                  canDecide={canDecide}
                  decisionBlocked={decisionBlocked}
                />
              </Panel>
              <Panel
                title={t("companyReview.detail.previewTitle")}
                id="preview"
                className="scroll-mt-32"
                description={t("companyReview.detail.previewText")}
              >
                <PreviewLinkButton
                  siteId={proposal.siteId}
                  productSlug={detail.ok ? detail.data.product.slug : undefined}
                />
              </Panel>
            </div>
          </div>
        </ReviewTabPanel>

        {/* 2. Missing & Verification: conflicts, questions, held values, documents. */}
        <ReviewTabPanel tab="verification">
          <VerificationNav
            groups={[
              {
                id: "attention",
                label: t("companyReview.detail.nav.conflicts"),
                count: attention.conflicts,
              },
              {
                id: "questions",
                label: t("companyReview.detail.nav.questions"),
                count: attention.questions,
              },
              { id: "held", label: t("companyReview.detail.nav.held"), count: attention.held },
              {
                id: "documents",
                label: t("companyReview.detail.nav.documents"),
                count: attention.missingDocuments,
              },
              {
                id: "current-technical",
                label: t("companyReview.detail.nav.technical"),
                count: specCount,
              },
            ]}
            t={t}
          />
          {verificationCount === 0 ? (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-3">
              {t("companyReview.detail.nothingToVerify")}
            </p>
          ) : null}
          <ReviewItems proposal={proposal} t={t} />
          <HeldValues proposal={proposal} t={t} />
          <DocumentsCheck
            proposal={proposal}
            documents={documents.ok ? documents.data : null}
            t={t}
          />
          <CurrentTechnicalData specs={specs.ok ? specs.data : null} t={t} locale={locale} />
        </ReviewTabPanel>

        {/* 3. Sources of the research. */}
        <ReviewTabPanel tab="sources">
          <SourcesPanel proposal={proposal} t={t} />
        </ReviewTabPanel>

        {/* 4. History: authors, decisions, comments and status changes. */}
        <ReviewTabPanel tab="history">
          <ProposalHistory proposal={proposal} events={events} t={t} locale={locale} />
        </ReviewTabPanel>
      </ReviewTabs>
    </div>
  );
}
