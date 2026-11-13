/**
 * Overview panel: product masters waiting for review (PM-3), live from GET /review-queue.
 * Streams in on its own (Suspense in the overview) so a slow API never delays the page; errors
 * and an empty queue have their own states. Users without catalogue access see why.
 */
import Link from "next/link";
import { ReviewQueueResponseSchema } from "@dream/contracts";
import { serverRead } from "../../lib/server-api";
import { ReviewQueueList } from "../catalog/review-queue";
import { Icon } from "../icons";
import { EmptyState, ErrorState, Panel, Skeleton } from "../ui";

const SHOWN = 5;

export async function ProductReviewPanel({ now }: { now: Date }) {
  const queue = await serverRead("/api/v1/admin/catalog/review-queue", ReviewQueueResponseSchema);
  const action = (
    <Link
      href="/products/review"
      className="inline-flex items-center gap-1 text-sm font-medium text-petrol-strong hover:underline"
    >
      Open queue
      <Icon name="chevron" size={15} />
    </Link>
  );
  return (
    <Panel
      id="review"
      title="Waiting for review"
      description={
        queue.ok
          ? `Product masters, oldest first · ${queue.data.total} in review`
          : "Product masters, oldest first"
      }
      action={queue.ok && queue.data.total > 0 ? action : undefined}
      bodyClassName="px-0! pb-2! pt-3!"
    >
      {!queue.ok ? (
        queue.status === 403 ? (
          <EmptyState icon="shield" title="No access to the product catalogue">
            Your roles do not include reading products, so there is no review queue for you.
          </EmptyState>
        ) : (
          <ErrorState title="The review queue could not be loaded">
            Try again in a moment.
          </ErrorState>
        )
      ) : queue.data.items.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing waiting for review">
          When a product master is submitted, it appears here for approval.
        </EmptyState>
      ) : (
        <ReviewQueueList items={queue.data.items.slice(0, SHOWN)} now={now} />
      )}
    </Panel>
  );
}

export function ProductReviewSkeleton() {
  return (
    <div
      className="space-y-3 rounded-2xl border border-line bg-surface p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading the review queue</span>
      <Skeleton className="h-5 w-44" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}
