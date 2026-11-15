import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CategoryListResponseSchema,
  ProductDetailResponseSchema,
  ProductDocumentListResponseSchema,
  ProductImageListResponseSchema,
  ProductSpecsResponseSchema,
  ProposalResponseSchema,
} from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { ProposalDecision } from "../../../../components/catalog/proposal-decision";
import {
  CurrentSiteData,
  HeldValues,
  ProposalHistory,
  ProposalStatusPill,
  ResearchProposal,
  ReviewItems,
  SourcesPanel,
} from "../../../../components/catalog/proposal-review";
import { ErrorState, Panel } from "../../../../components/ui";
import { COMPANY_REVIEW_PATH, STATUS_META } from "../../../../lib/proposals-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

const CATALOG = "/api/v1/admin/catalog";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Company review" };

/**
 * DP-172 (ADR-022): one product in the company review. Current site data, the research proposal
 * and the review items are separate, labelled sections; DP-002 held values have a block of their
 * own and are never shown as product specifications.
 */
export default async function CompanyReviewProductPage({
  params,
  searchParams,
}: PageProps<"/company-review/[id]">) {
  await requireStaffSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const siteQuery = typeof query["site"] === "string" ? `?site=${query["site"]}` : "";
  const back = { href: `${COMPANY_REVIEW_PATH}${siteQuery}`, label: "All proposals" };
  const res = await serverRead(`${CATALOG}/proposals/${id}`, ProposalResponseSchema);
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title="Company review" back={back} />
        <ErrorState title="This proposal could not be loaded">
          Your role may not include this site. Reload the page to try again.
        </ErrorState>
      </div>
    );
  }
  const { proposal, events, canDecide, decisionBlocked } = res.data;
  const pid = proposal.productId;
  const [detail, categories, specs, images, documents] = await Promise.all([
    serverRead(`${CATALOG}/products/${pid}?siteId=${proposal.siteId}`, ProductDetailResponseSchema),
    serverRead(`${CATALOG}/sites/${proposal.siteId}/categories`, CategoryListResponseSchema),
    serverRead(`${CATALOG}/products/${pid}/specs`, ProductSpecsResponseSchema),
    serverRead(`${CATALOG}/products/${pid}/images`, ProductImageListResponseSchema),
    serverRead(`${CATALOG}/products/${pid}/documents`, ProductDocumentListResponseSchema),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title={proposal.productName}
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{proposal.productCode}</span>
            <ProposalStatusPill status={proposal.status} />
            <span className="text-sm text-ink-3">
              Version {proposal.version} · {STATUS_META[proposal.status].hint}
            </span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="space-y-6">
          <CurrentSiteData
            detail={detail.ok ? detail.data : null}
            categories={categories.ok ? categories.data.items : []}
            specs={specs.ok ? specs.data : null}
            images={images.ok ? images.data : null}
            documents={documents.ok ? documents.data : null}
          />
          <ResearchProposal proposal={proposal} />
          <ReviewItems proposal={proposal} />
          <HeldValues proposal={proposal} />
          <SourcesPanel sources={proposal.reviewData.sources} />
        </div>
        <div className="space-y-6 xl:sticky xl:top-6">
          <Panel title="Decision" id="decision">
            <ProposalDecision
              proposalId={proposal.id}
              version={proposal.version}
              canDecide={canDecide}
              decisionBlocked={decisionBlocked}
            />
          </Panel>
          <Panel title="History" id="history">
            <ProposalHistory events={events} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
