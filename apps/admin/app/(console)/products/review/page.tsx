import type { Metadata } from "next";
import { CatalogContextResponseSchema, ReviewQueueResponseSchema } from "@dream/contracts";
import { PageHeader, pickSite, siteParam } from "../../../../components/catalog/parts";
import { ReviewQueueList } from "../../../../components/catalog/review-queue";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage({ searchParams }: PageProps<"/products/review">) {
  await requireStaffSession();
  const params = await searchParams;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title="Review queue" />
        <EmptyState icon="shield" title="No access to the product catalogue">
          Your roles do not include reading products on any site.
        </EmptyState>
      </div>
    );
  }
  const site = pickSite(
    context.data.sites,
    typeof params["site"] === "string" ? params["site"] : undefined,
  );
  const sp = siteParam(site);
  const queue = await serverRead("/api/v1/admin/catalog/review-queue", ReviewQueueResponseSchema);
  const now = new Date();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title="Review queue"
        back={{ href: `/products?site=${sp}`, label: "All products" }}
        description="Product masters submitted for approval, oldest first. A reviewer who changed or submitted a revision cannot decide on it."
      />
      <Panel
        id="queue"
        title="Waiting for a decision"
        description={
          queue.ok
            ? `${queue.data.total} in review${queue.data.canApprove ? "" : " · you can follow, not decide"}`
            : undefined
        }
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {!queue.ok ? (
          <ErrorState title="The review queue could not be loaded">
            {queue.status === 403
              ? "Your roles do not include reading products."
              : "Try again in a moment."}
          </ErrorState>
        ) : queue.data.items.length === 0 ? (
          <EmptyState icon="inbox" title="Nothing waiting for review">
            When a product master is submitted, it appears here for approval.
          </EmptyState>
        ) : (
          <ReviewQueueList items={queue.data.items} now={now} siteParam={sp} />
        )}
      </Panel>
    </div>
  );
}
