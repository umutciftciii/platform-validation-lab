import type { Metadata } from "next";
import Link from "next/link";
import {
  CatalogContextResponseSchema,
  CmsContextResponseSchema,
  SeoRedirectListResponseSchema,
  SEO_REDIRECT_SORTS,
} from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { Icon } from "../../../../components/icons";
import { RedirectManager } from "../../../../components/seo/redirect-manager";
import { SeoTabs } from "../../../../components/seo/seo-tabs";
import { buttonStyles, cx, EmptyState, ErrorState } from "../../../../components/ui";
import {
  ORIGIN_LABEL,
  SORT_LABEL,
  parseRedirectParams,
  redirectQuery,
  redirectsApi,
} from "../../../../lib/redirects-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Redirects · SEO" };

/**
 * DP-211 (ADR-024 D9): Admin > SEO > Redirects of the BV site. Lists every redirect (manual,
 * imported and the automatic 301s of moved content) with search, filters, sorting and pages;
 * the client part creates, edits, deletes and imports. The API decides every permission:
 * `content:read`/`product:read` reads, `content:publish` changes, `audit:read` shows history.
 */
export default async function RedirectsPage({ searchParams }: PageProps<"/seo/redirects">) {
  await requireStaffSession();
  const params = parseRedirectParams(await searchParams);
  const [cms, catalog] = await Promise.all([
    serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema),
    serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema),
  ]);
  const bv =
    (cms.ok ? cms.data.sites.find((s) => s.key === "BV") : undefined) ??
    (catalog.ok ? catalog.data.sites.find((s) => s.key === "BV") : undefined);
  const header = (
    <PageHeader
      icon="search"
      title="Redirects"
      description="Old addresses of dreampetroleumbv.com and where they lead. Changes take effect on the site at once."
    />
  );
  if (!bv) {
    return (
      <div className="space-y-6 sm:space-y-8">
        {header}
        <SeoTabs current="redirects" />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title="No access to the BV site">
            Your roles do not include reading content or products of Dream Petroleum BV.
          </EmptyState>
        </div>
      </div>
    );
  }
  const res = await serverRead(
    `${redirectsApi(bv.id)}${redirectQuery(params)}`,
    SeoRedirectListResponseSchema,
  );
  if (!res.ok) {
    return (
      <div className="space-y-6 sm:space-y-8">
        {header}
        <SeoTabs current="redirects" />
        <ErrorState title="The redirects could not be loaded">
          {res.status === 403
            ? "You are not allowed to read the content or products of this site."
            : "Try again in a moment."}
        </ErrorState>
      </div>
    );
  }
  const data = res.data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const chip = (label: string, patch: Parameters<typeof redirectQuery>[1], current: boolean) => (
    <Link
      key={label}
      href={`/seo/redirects${redirectQuery(params, { ...patch, page: 1 })}`}
      aria-current={current ? "page" : undefined}
      className={cx(
        "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
        current
          ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
          : "bg-surface-2 text-ink-2 ring-line hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
  const field =
    "h-10 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink";

  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <SeoTabs current="redirects" />

      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span>
          Live content always wins: a redirect never starts at a published page or product, and it
          is switched off when content is published at its old address. Redirects never chain, never
          leave the site and never appear in the sitemap. Slug-change redirects keep moved content
          findable and cannot be deleted here.
        </span>
      </p>

      <section aria-label="Find redirects" className="space-y-3">
        <form
          method="get"
          action="/seo/redirects"
          className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end"
        >
          <label className="min-w-0 flex-1 space-y-1">
            <span className="block text-xs font-medium text-ink-3">Search</span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Address or note"
              className={cx(field, "w-full")}
              maxLength={200}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-3">Sort by</span>
            <select
              name="sort"
              defaultValue={params.sort}
              className={cx(field, "w-full md:w-auto")}
            >
              {SEO_REDIRECT_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-3">Order</span>
            <select name="dir" defaultValue={params.dir} className={cx(field, "w-full md:w-auto")}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          {params.origin ? <input type="hidden" name="origin" value={params.origin} /> : null}
          {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
          {params.active ? <input type="hidden" name="active" value={params.active} /> : null}
          <button type="submit" className={buttonStyles.secondary}>
            <Icon name="search" size={16} />
            <span>Apply</span>
          </button>
        </form>
        <nav aria-label="Filter by origin" className="flex flex-wrap gap-2">
          {chip(`All (${data.counts.all})`, { origin: "" }, params.origin === "")}
          {(["MANUAL", "SLUG_CHANGE", "IMPORT"] as const).map((o) =>
            chip(`${ORIGIN_LABEL[o]} (${data.counts[o]})`, { origin: o }, params.origin === o),
          )}
        </nav>
        <nav aria-label="Filter by status and state" className="flex flex-wrap gap-2">
          {chip("Any status", { status: "" }, params.status === "")}
          {chip("301", { status: "301" }, params.status === "301")}
          {chip("302", { status: "302" }, params.status === "302")}
          {chip("Active and inactive", { active: "" }, params.active === "")}
          {chip("Active", { active: "true" }, params.active === "true")}
          {chip(
            `Inactive (${data.counts.inactive})`,
            { active: "false" },
            params.active === "false",
          )}
        </nav>
      </section>

      <section aria-label="Redirects" className="space-y-3">
        <p className="text-sm text-ink-3">
          {`${data.total} redirect${data.total === 1 ? "" : "s"}${data.total > data.pageSize ? ` · page ${data.page} of ${pages}` : ""}`}
        </p>
        <RedirectManager data={data} />
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
            {data.page > 1 ? (
              <Link
                key="prev"
                href={`/seo/redirects${redirectQuery(params, { page: data.page - 1 })}`}
                className={buttonStyles.secondary}
              >
                Previous
              </Link>
            ) : null}
            {data.page < pages ? (
              <Link
                key="next"
                href={`/seo/redirects${redirectQuery(params, { page: data.page + 1 })}`}
                className={buttonStyles.secondary}
              >
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
