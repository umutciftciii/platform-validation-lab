import type { Metadata } from "next";
import Link from "next/link";
import {
  ProposalContextResponseSchema,
  ProposalListResponseSchema,
  ProposalStatusSchema,
  type ProposalStatus,
} from "@dream/contracts";
import { PageHeader } from "../../../components/catalog/parts";
import { ProposalStatusPill } from "../../../components/catalog/proposal-review";
import { EmptyState, ErrorState, Panel, StatusPill, cx } from "../../../components/ui";
import { attentionCount, COMPANY_REVIEW_PATH, STATUS_META } from "../../../lib/proposals-view";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

const CATALOG = "/api/v1/admin/catalog";

export const metadata: Metadata = { title: "Company review" };

/**
 * DP-172 (ADR-022): the company's list of proposed product content, per site and status. Opening
 * a product shows its current site data, the research proposal and the review items side by side.
 */
export default async function CompanyReviewPage({ searchParams }: PageProps<"/company-review">) {
  await requireStaffSession();
  const query = await searchParams;
  const context = await serverRead(`${CATALOG}/proposals/context`, ProposalContextResponseSchema);
  const sites = context.ok ? context.data.sites.filter((s) => s.canRead) : [];
  if (sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title="Company review" />
        <EmptyState icon="shield" title="No access to the company review">
          Your roles do not include reading products on any site.
        </EmptyState>
      </div>
    );
  }
  const wanted = typeof query["site"] === "string" ? query["site"].toUpperCase() : undefined;
  const site = sites.find((s) => s.key === wanted) ?? sites[0]!;
  const statusParam = typeof query["status"] === "string" ? query["status"] : undefined;
  const status = ProposalStatusSchema.safeParse(statusParam).success
    ? (statusParam as ProposalStatus)
    : undefined;
  const list = await serverRead(
    `${CATALOG}/proposals?siteId=${site.id}${status ? `&status=${status}` : ""}`,
    ProposalListResponseSchema,
  );
  const siteQuery = `site=${site.key.toLowerCase()}`;
  const filterHref = (s?: ProposalStatus) =>
    `${COMPANY_REVIEW_PATH}?${siteQuery}${s ? `&status=${s}` : ""}`;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title="Company review"
        description={
          <>
            Proposed English texts for the {site.name} catalogue, prepared from research. For each
            product, check the current site data, the proposal and the review items, then approve or
            request changes. An approval neither publishes the product nor approves its technical
            data.
          </>
        }
      />
      {!list.ok ? (
        <ErrorState title="The proposals could not be loaded">
          Reload the page. If it keeps failing, your role may not include this site.
        </ErrorState>
      ) : (
        <Panel
          title="Products"
          description={`${list.data.counts.REVIEW_PENDING} pending · ${list.data.counts.CHANGES_REQUESTED} with changes requested · ${list.data.counts.APPROVED} approved`}
        >
          <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
            {[undefined, ...ProposalStatusSchema.options].map((s) => (
              <Link
                key={s ?? "all"}
                href={filterHref(s)}
                aria-current={s === status ? "page" : undefined}
                className={cx(
                  "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                  s === status
                    ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
                    : "text-ink-2 ring-line-strong hover:bg-surface-2",
                )}
              >
                {s ? STATUS_META[s].label : "All"}
              </Link>
            ))}
          </nav>
          {list.data.proposals.length === 0 ? (
            <p className="text-sm text-ink-3">No proposals in this view.</p>
          ) : (
            <ul className="divide-y divide-line" data-proposal-list="">
              {list.data.proposals.map((p) => {
                const attention = attentionCount(p.itemCounts);
                const held =
                  (p.itemCounts.DP002_HELD ?? 0) + (p.itemCounts.SITE_VALUE_WITHHELD ?? 0);
                return (
                  <li key={p.id}>
                    <Link
                      href={`${COMPANY_REVIEW_PATH}/${p.id}?${siteQuery}`}
                      className="flex flex-col gap-2 py-3 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between sm:px-2"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{p.productName}</span>
                        <span className="font-mono text-xs text-ink-3">{p.productCode}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {!p.hasText ? (
                          <StatusPill tone="neutral">No text proposed</StatusPill>
                        ) : null}
                        {attention > 0 ? (
                          <StatusPill tone="danger">{`${attention} conflict${attention === 1 ? "" : "s"}`}</StatusPill>
                        ) : null}
                        {held > 0 ? (
                          <StatusPill tone="amber">{`${held} held value${held === 1 ? "" : "s"}`}</StatusPill>
                        ) : null}
                        <ProposalStatusPill status={p.status} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
