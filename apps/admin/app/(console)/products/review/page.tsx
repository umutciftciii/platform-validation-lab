import type { Metadata } from "next";
import { CatalogContextResponseSchema, ReviewQueueResponseSchema } from "@dream/contracts";
import { PageHeader, pickSite, siteParam } from "../../../../components/catalog/parts";
import { ReviewQueueList } from "../../../../components/catalog/review-queue";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.list.review.title") };
}

export default async function ReviewQueuePage({ searchParams }: PageProps<"/products/review">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const params = await searchParams;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title={t("catalog.list.review.title")} />
        <EmptyState icon="shield" title={t("catalog.list.noAccess.title")}>
          {t("catalog.list.noAccess.text")}
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
        title={t("catalog.list.review.title")}
        back={{ href: `/products?site=${sp}`, label: t("catalog.list.review.back") }}
        description={t("catalog.list.review.description")}
      />
      <Panel
        id="queue"
        title={t("catalog.list.review.panelTitle")}
        description={
          queue.ok
            ? queue.data.canApprove
              ? t("catalog.list.review.inReview", { n: queue.data.total })
              : t("catalog.list.review.inReviewFollowOnly", { n: queue.data.total })
            : undefined
        }
        // i18n-ignore: CSS class list
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {!queue.ok ? (
          <ErrorState title={t("catalog.list.review.error.title")}>
            {queue.status === 403
              ? t("catalog.list.review.error.forbidden")
              : t("catalog.list.review.error.retry")}
          </ErrorState>
        ) : queue.data.items.length === 0 ? (
          <EmptyState icon="inbox" title={t("catalog.list.review.empty.title")}>
            {t("catalog.list.review.empty.text")}
          </EmptyState>
        ) : (
          <ReviewQueueList items={queue.data.items} now={now} siteParam={sp} locale={locale} />
        )}
      </Panel>
    </div>
  );
}
