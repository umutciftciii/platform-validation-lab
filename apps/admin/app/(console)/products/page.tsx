import type { Metadata } from "next";
import Link from "next/link";
import {
  CatalogContextResponseSchema,
  CategoryListResponseSchema,
  ProductListResponseSchema,
  type CatalogSite,
  type ProductListItem,
} from "@dream/contracts";
import {
  FIELD,
  PageHeader,
  pickSite,
  ProductListStatus,
  SiteSwitcher,
  siteParam,
} from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import { buttonStyles, cx, EmptyState, ErrorState, Panel } from "../../../components/ui";
import {
  apiListQuery,
  flattenTree,
  listHref,
  pageCount,
  PAGE_SIZE,
  readFilters,
} from "../../../lib/catalog-view";
import { ADMIN_TIME_ZONE } from "../../../lib/i18n/config";
import { dateTimeFormat } from "../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import type { Translate } from "../../../lib/i18n/types";
import { listRowStatus } from "../../../lib/publication-status";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.list.products.title") };
}

const CATALOG = "/api/v1/admin/catalog";
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
};

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const params = await searchParams;
  const context = await serverRead(`${CATALOG}/context`, CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="products" title={t("catalog.list.products.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("catalog.list.noAccess.title")}>
            {t("catalog.list.noAccess.textAsk")}
          </EmptyState>
        </div>
      </div>
    );
  }
  const { sites, canEditMaster } = context.data;
  const site = pickSite(sites, typeof params["site"] === "string" ? params["site"] : undefined);
  const filters = readFilters(params);
  const [list, categories] = await Promise.all([
    serverRead(`${CATALOG}/products?${apiListQuery(site.id, filters)}`, ProductListResponseSchema),
    serverRead(`${CATALOG}/sites/${site.id}/categories`, CategoryListResponseSchema),
  ]);
  const tree = categories.ok ? flattenTree(categories.data.items) : [];
  const sp = siteParam(site);
  const hrefFor = (s: CatalogSite) => `/products?site=${siteParam(s)}`;
  const filtered =
    Boolean(filters.q || filters.status || filters.visibility || filters.category) ||
    filters.listing !== "all";

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="products"
        title={t("catalog.list.products.title")}
        description={t("catalog.list.products.description")}
        actions={
          <>
            <Link href={`/products/categories?site=${sp}`} className={buttonStyles.secondary}>
              <Icon name="folder" size={17} />
              {t("catalog.list.products.actions.categories")}
            </Link>
            <Link href="/products/specifications" className={buttonStyles.secondary}>
              <Icon name="list" size={17} />
              {t("catalog.list.products.actions.specifications")}
            </Link>
            <Link href="/products/brands" className={buttonStyles.secondary}>
              <Icon name="star" size={17} />
              {t("catalog.list.products.actions.brands")}
            </Link>
            <Link href={`/products/review?site=${sp}`} className={buttonStyles.secondary}>
              <Icon name="inbox" size={17} />
              {t("catalog.list.products.actions.reviewQueue")}
            </Link>
            {canEditMaster ? (
              <Link href={`/products/new?site=${sp}`} className={buttonStyles.primary}>
                <Icon name="plus" size={17} />
                {t("catalog.list.products.actions.newProduct")}
              </Link>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SiteSwitcher
          sites={sites}
          current={site.id}
          hrefFor={hrefFor}
          label={t("catalog.common.site")}
        />
        <p className="text-sm text-ink-3">
          {site.canEdit
            ? t("catalog.list.products.siteCanEdit")
            : t("catalog.list.products.siteReadOnly")}
        </p>
      </div>

      <Panel
        id="products"
        title={t("catalog.list.products.panelTitle")}
        description={list.ok ? countLabel(list.data.total, filtered, t) : undefined}
        // i18n-ignore: CSS class list
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <form
          method="get"
          action="/products"
          role="search"
          aria-label={t("catalog.list.products.filters.label")}
          className="grid grid-cols-1 gap-3 border-b border-line px-5 pb-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]"
        >
          <input type="hidden" name="site" value={sp} />
          <label className="relative block sm:col-span-2 lg:col-span-1">
            <span className="sr-only">{t("catalog.list.products.filters.search")}</span>
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
              placeholder={t("catalog.list.products.filters.searchPlaceholder")}
              className={cx(FIELD, "pl-9")}
            />
          </label>
          <label>
            <span className="sr-only">{t("catalog.list.products.filters.category")}</span>
            <select name="category" defaultValue={filters.category} className={FIELD}>
              <option value="">{t("catalog.list.products.filters.allCategories")}</option>
              {tree.map(({ category, depth }) => (
                <option key={category.id} value={category.id}>
                  {" ".repeat(depth)}
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t("catalog.list.products.filters.listing")}</span>
            <select name="listing" defaultValue={filters.listing} className={FIELD}>
              <option value="all">{t("catalog.list.products.filters.listingAll")}</option>
              <option value="listed">{t("catalog.list.products.filters.listingListed")}</option>
              <option value="unlisted">{t("catalog.list.products.filters.listingUnlisted")}</option>
            </select>
          </label>
          <label>
            <span className="sr-only">{t("catalog.list.products.filters.sort")}</span>
            <select name="sort" defaultValue={filters.sort} className={FIELD}>
              <option value="name">{t("catalog.list.products.filters.sortName")}</option>
              <option value="code">{t("catalog.list.products.filters.sortCode")}</option>
              <option value="updatedAt">{t("catalog.list.products.filters.sortUpdated")}</option>
              <option value="createdAt">{t("catalog.list.products.filters.sortCreated")}</option>
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1 lg:w-28">
              <span className="sr-only">{t("catalog.list.products.filters.order")}</span>
              <select name="order" defaultValue={filters.order} className={FIELD}>
                <option value="asc">{t("catalog.list.products.filters.asc")}</option>
                <option value="desc">{t("catalog.list.products.filters.desc")}</option>
              </select>
            </label>
            <button type="submit" className={cx(buttonStyles.primary, "shrink-0")}>
              {t("catalog.list.products.filters.apply")}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2 lg:col-span-6">
            <label className="inline-flex items-center gap-2 whitespace-nowrap text-ink-2">
              {t("catalog.list.products.filters.masterStatus")}
              <select
                name="status"
                defaultValue={filters.status}
                className={cx(FIELD, "h-9 w-auto py-0 text-sm")}
              >
                <option value="">{t("catalog.list.products.filters.any")}</option>
                <option value="DRAFT">{t("catalog.common.productStatus.DRAFT")}</option>
                <option value="IN_REVIEW">{t("catalog.common.productStatus.IN_REVIEW")}</option>
                <option value="APPROVED">{t("catalog.common.productStatus.APPROVED")}</option>
                <option value="ARCHIVED">{t("catalog.common.productStatus.ARCHIVED")}</option>
              </select>
            </label>
            {filtered ? (
              <Link
                href={`/products?site=${sp}`}
                className="font-medium text-petrol-strong hover:underline"
              >
                {t("catalog.list.products.filters.clear")}
              </Link>
            ) : null}
          </div>
        </form>

        {!list.ok ? (
          <ErrorState title={t("catalog.list.products.error.title")}>
            {list.status === 403
              ? t("catalog.list.products.error.forbidden")
              : t("catalog.list.products.error.retry")}
          </ErrorState>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon="products"
            title={
              filtered
                ? t("catalog.list.products.empty.filteredTitle")
                : t("catalog.list.products.empty.title")
            }
            {...(filtered
              ? {
                  action: {
                    href: `/products?site=${sp}`,
                    label: t("catalog.list.products.filters.clear"),
                  },
                }
              : {})}
          >
            {filtered
              ? t("catalog.list.products.empty.filteredText")
              : canEditMaster
                ? t("catalog.list.products.empty.canCreate")
                : t("catalog.list.products.empty.cannotCreate")}
          </EmptyState>
        ) : (
          <>
            {/* Wide screens: table */}
            <div className="hidden md:block">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">
                  {t("catalog.list.products.table.caption", { site: site.name })}
                </caption>
                <thead>
                  <tr className="type-eyebrow border-y border-line bg-surface-2 text-ink-3">
                    <th scope="col" className="py-2.5 pl-6 pr-3 font-semibold">
                      {t("catalog.list.products.table.product")}
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      {t("catalog.list.products.table.category")}
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      {t("catalog.list.products.table.status")}
                    </th>
                    <th scope="col" className="py-2.5 pl-3 pr-6 font-semibold">
                      {t("catalog.list.products.table.changed")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr
                      key={p.id}
                      className="group relative border-b border-line transition-colors duration-100 last:border-b-0 focus-within:bg-surface-2/70 hover:bg-surface-2/70"
                    >
                      <td className="py-3.5 pl-6 pr-3">
                        <Link
                          href={`/products/${p.id}?site=${sp}`}
                          className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-petrol"
                        >
                          <span className="block font-medium text-ink group-hover:text-petrol-strong">
                            {p.name}
                          </span>
                          <span className="tabular block font-mono text-xs text-ink-3">
                            {p.code}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3.5 text-ink-2">
                        {p.listing ? p.listing.categoryName : <span className="text-ink-3">—</span>}
                      </td>
                      <td className="px-3 py-3.5">
                        <ProductListStatus siteKey={site.key} status={statusOf(p)} />
                      </td>
                      <td className="tabular whitespace-nowrap py-3.5 pl-3 pr-6 text-ink-2">
                        <span className="flex items-center justify-between gap-2">
                          {DATE.format(new Date(p.updatedAt))}
                          <Icon
                            name="chevron"
                            size={16}
                            className="text-ink-3 opacity-0 transition-[opacity,transform] duration-150 group-focus-within:opacity-100 group-hover:translate-x-0.5 group-hover:opacity-100"
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phones: stacked list */}
            <ul className="divide-y divide-line border-t border-line md:hidden">
              {list.data.items.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/products/${p.id}?site=${sp}`}
                    className="flex items-start justify-between gap-3 px-5 py-3.5 active:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{p.name}</span>
                      <span className="tabular block font-mono text-xs text-ink-3">{p.code}</span>
                      <span className="mt-2 block">
                        <ProductListStatus siteKey={site.key} status={statusOf(p)} />
                      </span>
                      {p.listing ? (
                        <span className="mt-1.5 block text-xs text-ink-3">
                          {p.listing.categoryName}
                        </span>
                      ) : null}
                    </span>
                    <Icon name="chevron" size={16} className="mt-1 shrink-0 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              site={sp}
              filters={filters}
              total={list.data.total}
              page={list.data.page}
              t={t}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * DP-197: Draft, Published or Unpublished on the selected site; DP-200: plus the master status
 * when it does not merely repeat it.
 */
function statusOf(p: ProductListItem) {
  return listRowStatus({
    publication: p.publication,
    listing: p.listing?.visibility ?? null,
    productStatus: p.status,
  });
}

function countLabel(total: number, filtered: boolean, t: Translate): string {
  return filtered
    ? t("catalog.list.products.countFiltered", { count: total })
    : t("catalog.list.products.count", { count: total });
}

function Pagination({
  site,
  filters,
  total,
  page,
  t,
}: {
  site: string;
  filters: ReturnType<typeof readFilters>;
  total: number;
  page: number;
  t: Translate;
}) {
  const pages = pageCount(total, PAGE_SIZE);
  if (pages <= 1) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <nav
      aria-label={t("catalog.list.products.pagination.label")}
      className="flex items-center justify-between gap-3 border-t border-line px-5 pt-3 text-sm sm:px-6"
    >
      <span className="tabular text-ink-3">
        {t("catalog.list.products.pagination.range", { from, to, total })}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link
            href={listHref(site, { ...filters, page: page - 1 })}
            className={buttonStyles.secondary}
          >
            {t("catalog.list.products.pagination.previous")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link
            href={listHref(site, { ...filters, page: page + 1 })}
            className={buttonStyles.secondary}
          >
            {t("catalog.list.products.pagination.next")}
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
