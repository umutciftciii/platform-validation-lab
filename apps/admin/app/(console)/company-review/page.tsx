import type { Metadata } from "next";
import Link from "next/link";
import {
  CategoryListResponseSchema,
  PAGE_SIZE_MAX,
  ProductListResponseSchema,
  ProposalContextResponseSchema,
  ProposalListResponseSchema,
  ProposalStatusSchema,
  type ProductListItem,
  type ProposalStatus,
} from "@dream/contracts";
import { FIELD, PageHeader } from "../../../components/catalog/parts";
import { PreviewLinkButton } from "../../../components/catalog/preview-link-button";
import { ProposalStatusPill } from "../../../components/catalog/proposal-review";
import { Icon } from "../../../components/icons";
import {
  buttonStyles,
  EmptyState,
  ErrorState,
  Panel,
  StatusPill,
  cx,
} from "../../../components/ui";
import { flattenTree } from "../../../lib/catalog-view";
import { getTranslator } from "../../../lib/i18n/server";
import { statusLabel } from "../../../lib/proposals-view";
import {
  filterProposals,
  readReviewFilters,
  reviewAttention,
  reviewHref,
  reviewListHref,
} from "../../../lib/review-tabs";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

const CATALOG = "/api/v1/admin/catalog";
/** Upper bound of product pages read for the category column and filter (100 per page). */
const MAX_PRODUCT_PAGES = 20;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("companyReview.title") };
}

/** Every product of the site's catalogue view (optionally of one category), or null on failure. */
async function readProducts(
  siteId: string,
  categoryId?: string,
): Promise<ProductListItem[] | null> {
  const out: ProductListItem[] = [];
  for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
    const q = new URLSearchParams({
      siteId,
      sort: "name",
      order: "asc",
      page: String(page),
      pageSize: String(PAGE_SIZE_MAX),
    });
    if (categoryId) q.set("categoryId", categoryId);
    const res = await serverRead(`${CATALOG}/products?${q.toString()}`, ProductListResponseSchema);
    if (!res.ok) return null;
    out.push(...res.data.items);
    if (out.length >= res.data.total || res.data.items.length === 0) break;
  }
  return out;
}

/**
 * DP-172 (ADR-022), DP-189: the company's list of proposed product content, per site. Search by
 * product name or SKU, filter by category and review status; one click opens a product's review.
 */
export default async function CompanyReviewPage({ searchParams }: PageProps<"/company-review">) {
  await requireStaffSession();
  const t = await getTranslator();
  const query = await searchParams;
  const context = await serverRead(`${CATALOG}/proposals/context`, ProposalContextResponseSchema);
  const sites = context.ok ? context.data.sites.filter((s) => s.canRead) : [];
  if (sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title={t("companyReview.title")} />
        <EmptyState icon="shield" title={t("companyReview.list.noAccessTitle")}>
          {t("companyReview.list.noAccessText")}
        </EmptyState>
      </div>
    );
  }
  const wanted = typeof query["site"] === "string" ? query["site"].toUpperCase() : undefined;
  const site = sites.find((s) => s.key === wanted) ?? sites[0]!;
  const siteKey = site.key.toLowerCase();
  const filters = readReviewFilters(query, ProposalStatusSchema.options);
  const status = filters.status ? (filters.status as ProposalStatus) : undefined;

  const [list, categories, products, inCategory] = await Promise.all([
    serverRead(
      `${CATALOG}/proposals?siteId=${site.id}${status ? `&status=${status}` : ""}`,
      ProposalListResponseSchema,
    ),
    serverRead(`${CATALOG}/sites/${site.id}/categories`, CategoryListResponseSchema),
    readProducts(site.id),
    filters.category ? readProducts(site.id, filters.category) : Promise.resolve(null),
  ]);
  const tree = categories.ok ? flattenTree(categories.data.items) : [];
  const categoryOf = new Map(
    (products ?? []).map((p) => [p.id, p.listing?.categoryName ?? null] as const),
  );
  // A chosen category that could not be read filters nothing out rather than everything.
  const categorySet = filters.category && inCategory ? new Set(inCategory.map((p) => p.id)) : null;
  const shown = list.ok ? filterProposals(list.data.proposals, filters.q, categorySet) : [];
  const narrowed = Boolean(filters.q || categorySet);
  const statusHref = (s?: ProposalStatus) =>
    reviewListHref(siteKey, { q: filters.q, category: filters.category, status: s ?? "" });

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title={t("companyReview.title")}
        actions={
          site.canReview && site.key === "BV" ? <PreviewLinkButton siteId={site.id} /> : undefined
        }
        description={<>{t("companyReview.list.description", { site: site.name })}</>}
      />
      {sites.length > 1 ? (
        <nav aria-label={t("companyReview.list.site")} className="flex flex-wrap gap-2">
          {sites.map((s) => (
            <Link
              key={s.id}
              href={reviewListHref(s.key.toLowerCase(), {})}
              aria-current={s.id === site.id ? "page" : undefined}
              className={cx(
                "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                s.id === site.id
                  ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
                  : "text-ink-2 ring-line-strong hover:bg-surface-2",
              )}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {!list.ok ? (
        <ErrorState title={t("companyReview.list.loadErrorTitle")}>
          {t("companyReview.list.loadErrorText")}
        </ErrorState>
      ) : (
        <Panel
          title={t("companyReview.list.products")}
          description={t("companyReview.list.counts", {
            pending: list.data.counts.REVIEW_PENDING,
            changes: list.data.counts.CHANGES_REQUESTED,
            approved: list.data.counts.APPROVED,
          })}
          bodyClassName="px-0! pb-2! pt-3!"
        >
          <form
            method="get"
            action="/company-review"
            role="search"
            aria-label={t("companyReview.list.filterLabel")}
            className="grid grid-cols-1 gap-3 border-b border-line px-5 pb-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:px-6"
          >
            <input type="hidden" name="site" value={siteKey} />
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <label className="relative block">
              <span className="sr-only">{t("companyReview.list.searchLabel")}</span>
              <Icon
                name="search"
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <input
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={100}
                placeholder={t("companyReview.list.searchPlaceholder")}
                className={cx(FIELD, "pl-9")}
              />
            </label>
            <label>
              <span className="sr-only">{t("companyReview.list.category")}</span>
              <select
                name="category"
                defaultValue={filters.category}
                className={FIELD}
                disabled={tree.length === 0}
              >
                <option value="">{t("companyReview.list.allCategories")}</option>
                {tree.map(({ category, depth }) => (
                  <option key={category.id} value={category.id}>
                    {`${"  ".repeat(depth)}${category.name}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className={cx(buttonStyles.secondary, "flex-1 sm:flex-none")}>
                <Icon name="search" size={16} />
                {t("companyReview.list.search")}
              </button>
              {narrowed ? (
                <Link
                  href={reviewListHref(siteKey, { status: status ?? "" })}
                  className={cx(buttonStyles.ghost, "flex-1 sm:flex-none")}
                >
                  {t("companyReview.list.clear")}
                </Link>
              ) : null}
            </div>
            <nav
              aria-label={t("companyReview.list.statusFilter")}
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:col-span-3 sm:flex-wrap [&::-webkit-scrollbar]:hidden"
            >
              {[undefined, ...ProposalStatusSchema.options].map((s) => {
                const n = s
                  ? list.data.counts[s]
                  : ProposalStatusSchema.options.reduce((a, k) => a + list.data.counts[k], 0);
                return (
                  <Link
                    key={s ?? "all"}
                    href={statusHref(s)}
                    aria-current={s === status ? "page" : undefined}
                    className={cx(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                      s === status
                        ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
                        : "text-ink-2 ring-line-strong hover:bg-surface-2",
                    )}
                  >
                    {s ? statusLabel(s, t) : t("companyReview.list.all")}
                    <span className="tabular text-xs opacity-75">{n}</span>
                  </Link>
                );
              })}
            </nav>
          </form>
          {categories.ok && products === null ? (
            <p className="border-b border-line px-5 py-2 text-xs text-ink-3 sm:px-6">
              {t("companyReview.list.categoriesIncomplete")}
            </p>
          ) : null}
          {narrowed ? (
            <p className="px-5 pt-3 text-sm text-ink-3 sm:px-6" role="status">
              {t("companyReview.list.showing", {
                count: shown.length,
                total: list.data.proposals.length,
              })}
            </p>
          ) : null}
          {shown.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3 sm:px-6">
              {narrowed ? t("companyReview.list.noMatch") : t("companyReview.list.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-line" data-proposal-list="">
              {shown.map((p) => {
                const a = reviewAttention(p.itemCounts);
                const category = categoryOf.get(p.productId);
                return (
                  <li key={p.id}>
                    <Link
                      href={reviewHref(p.id, siteKey, "content")}
                      className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none sm:px-6"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink group-hover:text-petrol-strong">
                            {p.productName}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                            <span className="font-mono">{p.productCode}</span>
                            {category ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{category}</span>
                              </>
                            ) : null}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2 md:justify-end">
                          <ProposalStatusPill status={p.status} t={t} />
                          {!p.hasText ? (
                            <StatusPill tone="neutral">{t("companyReview.list.noText")}</StatusPill>
                          ) : null}
                          {a.conflicts > 0 ? (
                            <StatusPill tone="danger">
                              {t("companyReview.count.conflicts", { count: a.conflicts })}
                            </StatusPill>
                          ) : null}
                          {a.held > 0 ? (
                            <StatusPill tone="amber">
                              {t("companyReview.count.heldValues", { count: a.held })}
                            </StatusPill>
                          ) : null}
                        </span>
                      </span>
                      <Icon
                        name="chevron"
                        size={18}
                        className="shrink-0 text-ink-3 group-hover:text-petrol-strong"
                      />
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
