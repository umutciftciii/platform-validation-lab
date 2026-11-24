/**
 * Overview panel: product masters waiting for review (PM-3), live from GET /review-queue.
 * Streams in on its own (Suspense in the overview) so a slow API never delays the page; errors
 * and an empty queue have their own states. Users without catalogue access see why.
 */
import Link from "next/link";
import { ReviewQueueResponseSchema } from "@dream/contracts";
import type { Translate } from "../../lib/i18n/types";
import { getAdminLocale, getTranslator } from "../../lib/i18n/server";
import { serverRead } from "../../lib/server-api";
import { ReviewQueueList } from "../catalog/review-queue";
import { Icon } from "../icons";
import { EmptyState, ErrorState, Panel, Skeleton } from "../ui";

const SHOWN = 5;

export async function ProductReviewPanel({ now }: { now: Date }) {
  const queue = await serverRead("/api/v1/admin/catalog/review-queue", ReviewQueueResponseSchema);
  const [t, locale] = [await getTranslator(), await getAdminLocale()];
  const action = (
    <Link
      href="/products/review"
      className="inline-flex items-center gap-1 text-sm font-medium text-petrol-strong hover:underline"
    >
      {t("dashboard.review.open")}
      <Icon name="chevron" size={15} />
    </Link>
  );
  return (
    <Panel
      id="review"
      title={t("dashboard.review.title")}
      description={
        queue.ok
          ? t("dashboard.review.descriptionTotal", { total: queue.data.total })
          : t("dashboard.review.description")
      }
      action={queue.ok && queue.data.total > 0 ? action : undefined}
      bodyClassName="px-0! pb-2! pt-3!"
    >
      {!queue.ok ? (
        queue.status === 403 ? (
          <EmptyState icon="shield" title={t("dashboard.review.forbiddenTitle")}>
            {t("dashboard.review.forbiddenText")}
          </EmptyState>
        ) : (
          <ErrorState title={t("dashboard.review.errorTitle")}>
            {t("dashboard.review.errorText")}
          </ErrorState>
        )
      ) : queue.data.items.length === 0 ? (
        <EmptyState icon="inbox" title={t("dashboard.review.emptyTitle")}>
          {t("dashboard.review.emptyText")}
        </EmptyState>
      ) : (
        <ReviewQueueList items={queue.data.items.slice(0, SHOWN)} now={now} locale={locale} />
      )}
    </Panel>
  );
}

export function ProductReviewSkeleton({ t }: { t: Translate }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-line bg-surface p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("dashboard.review.loading")}</span>
      <Skeleton className="h-5 w-44" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}
