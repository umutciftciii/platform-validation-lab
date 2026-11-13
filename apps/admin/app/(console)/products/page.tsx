import type { Metadata } from "next";
import Link from "next/link";
import {
  CatalogContextResponseSchema,
  CategoryListResponseSchema,
  ProductListResponseSchema,
  type CatalogSite,
} from "@dream/contracts";
import {
  FIELD,
  PageHeader,
  pickSite,
  ProductStatusPill,
  PublicationPill,
  SiteSwitcher,
  siteParam,
  VisibilityPill,
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
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export const metadata: Metadata = { title: "Products" };

const CATALOG = "/api/v1/admin/catalog";
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  await requireStaffSession();
  const params = await searchParams;
  const context = await serverRead(`${CATALOG}/context`, CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="products" title="Products" />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title="No access to the product catalogue">
            Your roles do not include reading products on any site. Ask a site or platform
            administrator for access.
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
        title="Products"
        description="Platform-wide product masters, and how each site lists them."
        actions={
          <>
            <Link href={`/products/categories?site=${sp}`} className={buttonStyles.secondary}>
              <Icon name="folder" size={17} />
              Categories
            </Link>
            <Link href="/products/specifications" className={buttonStyles.secondary}>
              <Icon name="list" size={17} />
              Specifications
            </Link>
            <Link href="/products/brands" className={buttonStyles.secondary}>
              <Icon name="star" size={17} />
              Global brands
            </Link>
            <Link href={`/products/review?site=${sp}`} className={buttonStyles.secondary}>
              <Icon name="inbox" size={17} />
              Review queue
            </Link>
            {canEditMaster ? (
              <Link href={`/products/new?site=${sp}`} className={buttonStyles.primary}>
                <Icon name="plus" size={17} />
                New product
              </Link>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SiteSwitcher sites={sites} current={site.id} hrefFor={hrefFor} />
        <p className="text-sm text-ink-3">
          {site.canEdit
            ? "You can edit listings and categories of this site."
            : "Read only on this site."}
        </p>
      </div>

      <Panel
        id="products"
        title="Catalogue"
        description={list.ok ? countLabel(list.data.total, filtered) : undefined}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <form
          method="get"
          action="/products"
          role="search"
          aria-label="Filter products"
          className="grid grid-cols-1 gap-3 border-b border-line px-5 pb-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]"
        >
          <input type="hidden" name="site" value={sp} />
          <label className="relative block sm:col-span-2 lg:col-span-1">
            <span className="sr-only">Search by name, code or slug</span>
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
              placeholder="Search name, code or slug"
              className={cx(FIELD, "pl-9")}
            />
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select name="category" defaultValue={filters.category} className={FIELD}>
              <option value="">All categories</option>
              {tree.map(({ category, depth }) => (
                <option key={category.id} value={category.id}>
                  {" ".repeat(depth)}
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Listing on this site</span>
            <select name="listing" defaultValue={filters.listing} className={FIELD}>
              <option value="all">Listed or not</option>
              <option value="listed">Listed here</option>
              <option value="unlisted">Not listed here</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Visibility</span>
            <select name="visibility" defaultValue={filters.visibility} className={FIELD}>
              <option value="">Any visibility</option>
              <option value="VISIBLE">Visible</option>
              <option value="HIDDEN">Hidden</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort</span>
            <select name="sort" defaultValue={filters.sort} className={FIELD}>
              <option value="name">Sort by name</option>
              <option value="code">Sort by code</option>
              <option value="updatedAt">Last changed</option>
              <option value="createdAt">Created</option>
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1 lg:w-28">
              <span className="sr-only">Order</span>
              <select name="order" defaultValue={filters.order} className={FIELD}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <button type="submit" className={cx(buttonStyles.primary, "shrink-0")}>
              Apply
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2 lg:col-span-6">
            <label className="inline-flex items-center gap-2 whitespace-nowrap text-ink-2">
              Master status
              <select
                name="status"
                defaultValue={filters.status}
                className={cx(FIELD, "h-9 w-auto py-0 text-sm")}
              >
                <option value="">Any</option>
                <option value="DRAFT">Draft</option>
                <option value="IN_REVIEW">In review</option>
                <option value="APPROVED">Approved</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </label>
            {filtered ? (
              <Link
                href={`/products?site=${sp}`}
                className="font-medium text-petrol-strong hover:underline"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        </form>

        {!list.ok ? (
          <ErrorState title="The product list could not be loaded">
            {list.status === 403
              ? "You are not allowed to read products on this site."
              : "Try again in a moment."}
          </ErrorState>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon="products"
            title={filtered ? "No product matches these filters" : "No products yet"}
            {...(filtered
              ? { action: { href: `/products?site=${sp}`, label: "Clear filters" } }
              : {})}
          >
            {filtered
              ? "Change or clear the filters to see more products."
              : canEditMaster
                ? "Create the first product master with “New product”."
                : "Product masters are created by the platform product team."}
          </EmptyState>
        ) : (
          <>
            {/* Wide screens: table */}
            <div className="hidden md:block">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">Products on {site.name}</caption>
                <thead>
                  <tr className="type-eyebrow border-y border-line bg-surface-2 text-ink-3">
                    <th scope="col" className="py-2.5 pl-6 pr-3 font-semibold">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      Category on this site
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      Site listing
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      Master
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      Live
                    </th>
                    <th scope="col" className="py-2.5 pl-3 pr-6 font-semibold">
                      Last changed
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
                        <VisibilityPill visibility={p.listing?.visibility ?? null} />
                      </td>
                      <td className="px-3 py-3.5">
                        <ProductStatusPill status={p.status} />
                      </td>
                      <td className="px-3 py-3.5">
                        <PublicationPill publication={p.publication} />
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
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        <VisibilityPill visibility={p.listing?.visibility ?? null} />
                        <ProductStatusPill status={p.status} />
                        <PublicationPill publication={p.publication} />
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
            <Pagination site={sp} filters={filters} total={list.data.total} page={list.data.page} />
          </>
        )}
      </Panel>
    </div>
  );
}

function countLabel(total: number, filtered: boolean): string {
  const one = total === 1;
  const noun = `${total} product${one ? "" : "s"}`;
  return filtered ? `${noun} ${one ? "matches" : "match"} the filters` : noun;
}

function Pagination({
  site,
  filters,
  total,
  page,
}: {
  site: string;
  filters: ReturnType<typeof readFilters>;
  total: number;
  page: number;
}) {
  const pages = pageCount(total, PAGE_SIZE);
  if (pages <= 1) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <nav
      aria-label="Pages"
      className="flex items-center justify-between gap-3 border-t border-line px-5 pt-3 text-sm sm:px-6"
    >
      <span className="tabular text-ink-3">
        {from}–{to} of {total}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link
            href={listHref(site, { ...filters, page: page - 1 })}
            className={buttonStyles.secondary}
          >
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link
            href={listHref(site, { ...filters, page: page + 1 })}
            className={buttonStyles.secondary}
          >
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
