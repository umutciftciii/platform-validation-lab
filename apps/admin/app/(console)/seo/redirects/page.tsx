import type { Metadata } from "next";
import Link from "next/link";
import {
  CatalogContextResponseSchema,
  CmsContextResponseSchema,
  SeoRedirectListResponseSchema,
  SEO_REDIRECT_SORTS,
} from "@dream/contracts";
import { PageHeader, SiteSwitcher } from "../../../../components/catalog/parts";
import { Icon } from "../../../../components/icons";
import { RedirectManager } from "../../../../components/seo/redirect-manager";
import { SeoTabs } from "../../../../components/seo/seo-tabs";
import { buttonStyles, cx, EmptyState, ErrorState } from "../../../../components/ui";
import { getTranslator } from "../../../../lib/i18n/server";
import {
  originLabel,
  sortLabel,
  parseRedirectParams,
  redirectQuery,
  redirectsApi,
} from "../../../../lib/redirects-view";
import { pickSeoSite, seoSites, withSeoSite } from "../../../../lib/seo-site";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("seo.redirects.metaTitle") };
}

/**
 * DP-211 (ADR-024 D9): Admin > SEO > Redirects of a site (COM-1: BV or the corporate site,
 * `?site=`). Lists every redirect (manual,
 * imported and the automatic 301s of moved content) with search, filters, sorting and pages;
 * the client part creates, edits, deletes and imports. The API decides every permission:
 * `content:read`/`product:read` reads, `content:publish` changes, `audit:read` shows history.
 * ML-12d (DP-243): every UI text in the console's language (`seo.redirects.*`); query parameters,
 * API paths, origins, status codes and redirect data are unchanged.
 */
export default async function RedirectsPage({ searchParams }: PageProps<"/seo/redirects">) {
  await requireStaffSession();
  const t = await getTranslator();
  const raw = await searchParams;
  const params = parseRedirectParams(raw);
  const [cms, catalog] = await Promise.all([
    serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema),
    serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema),
  ]);
  // COM-1: one site at a time (`?site=bv|corporate`, BV by default).
  const sites = seoSites(cms.ok ? cms.data.sites : null, catalog.ok ? catalog.data.sites : null);
  const bv = pickSeoSite(sites, raw["site"]);
  const header = (
    <PageHeader
      icon="search"
      title={t("seo.redirects.title")}
      description={t("seo.redirects.description")}
    />
  );
  if (!bv) {
    return (
      <div className="space-y-6 sm:space-y-8">
        {header}
        <SeoTabs current="redirects" t={t} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("seo.common.noAccessTitle")}>
            {t("seo.common.noAccessText")}
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
        <SeoTabs current="redirects" t={t} siteKey={bv.key} />
        <ErrorState title={t("seo.redirects.loadError")}>
          {res.status === 403 ? t("seo.common.forbidden") : t("seo.common.tryAgain")}
        </ErrorState>
      </div>
    );
  }
  const data = res.data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const chip = (
    id: string,
    label: string,
    patch: Parameters<typeof redirectQuery>[1],
    current: boolean,
  ) => (
    <Link
      key={id}
      href={withSeoSite(`/seo/redirects${redirectQuery(params, { ...patch, page: 1 })}`, bv.key)}
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
      <SeoTabs current="redirects" t={t} siteKey={bv.key} />

      {sites.length > 1 ? (
        <SiteSwitcher
          sites={sites}
          current={bv.id}
          hrefFor={(s) => withSeoSite("/seo/redirects", s.key)}
          label={t("seo.common.site")}
        />
      ) : null}

      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span>{t("seo.redirects.rulesNote")}</span>
      </p>

      <section aria-label={t("seo.redirects.find.label")} className="space-y-3">
        <form
          method="get"
          action="/seo/redirects"
          className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end"
        >
          <label className="min-w-0 flex-1 space-y-1">
            <span className="block text-xs font-medium text-ink-3">
              {t("seo.redirects.find.search")}
            </span>
            <input
              name="q"
              defaultValue={params.q}
              placeholder={t("seo.redirects.find.searchPlaceholder")}
              className={cx(field, "w-full")}
              maxLength={200}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-3">
              {t("seo.redirects.find.sortBy")}
            </span>
            <select
              name="sort"
              defaultValue={params.sort}
              className={cx(field, "w-full md:w-auto")}
            >
              {SEO_REDIRECT_SORTS.map((s) => (
                <option key={s} value={s}>
                  {sortLabel(s, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-3">
              {t("seo.redirects.find.order")}
            </span>
            <select name="dir" defaultValue={params.dir} className={cx(field, "w-full md:w-auto")}>
              <option value="desc">{t("seo.redirects.find.descending")}</option>
              <option value="asc">{t("seo.redirects.find.ascending")}</option>
            </select>
          </label>
          {bv.key !== "BV" ? (
            <input type="hidden" name="site" value={bv.key.toLowerCase()} />
          ) : null}
          {params.origin ? <input type="hidden" name="origin" value={params.origin} /> : null}
          {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
          {params.active ? <input type="hidden" name="active" value={params.active} /> : null}
          <button type="submit" className={buttonStyles.secondary}>
            <Icon name="search" size={16} />
            <span>{t("seo.redirects.find.apply")}</span>
          </button>
        </form>
        <nav aria-label={t("seo.redirects.find.byOrigin")} className="flex flex-wrap gap-2">
          {chip(
            "origin-all",
            t("seo.redirects.find.all", { n: data.counts.all }),
            { origin: "" },
            params.origin === "",
          )}
          {(["MANUAL", "SLUG_CHANGE", "IMPORT"] as const).map((o) =>
            chip(
              `origin-${o}`,
              t("seo.redirects.find.withCount", { label: originLabel(o, t), n: data.counts[o] }),
              { origin: o },
              params.origin === o,
            ),
          )}
        </nav>
        <nav aria-label={t("seo.redirects.find.byStatus")} className="flex flex-wrap gap-2">
          {chip(
            "status-any",
            t("seo.redirects.find.anyStatus"),
            { status: "" },
            params.status === "",
          )}
          {chip("status-301", "301", { status: "301" }, params.status === "301")}
          {chip("status-302", "302", { status: "302" }, params.status === "302")}
          {chip(
            "active-any",
            t("seo.redirects.find.activeAndInactive"),
            { active: "" },
            params.active === "",
          )}
          {chip(
            "active-true",
            t("seo.redirects.find.active"),
            { active: "true" },
            params.active === "true",
          )}
          {chip(
            "active-false",
            t("seo.redirects.find.inactive", { n: data.counts.inactive }),
            { active: "false" },
            params.active === "false",
          )}
        </nav>
      </section>

      <section aria-label={t("seo.redirects.list.label")} className="space-y-3">
        <p className="text-sm text-ink-3">
          {`${t("seo.redirects.list.count", { count: data.total })}${data.total > data.pageSize ? t("seo.redirects.list.page", { page: data.page, pages }) : ""}`}
        </p>
        <RedirectManager data={data} />
        {pages > 1 ? (
          <nav
            aria-label={t("seo.redirects.list.pages")}
            className="flex flex-wrap items-center gap-2"
          >
            {data.page > 1 ? (
              <Link
                key="prev"
                href={withSeoSite(
                  `/seo/redirects${redirectQuery(params, { page: data.page - 1 })}`,
                  bv.key,
                )}
                className={buttonStyles.secondary}
              >
                {t("seo.redirects.list.previous")}
              </Link>
            ) : null}
            {data.page < pages ? (
              <Link
                key="next"
                href={withSeoSite(
                  `/seo/redirects${redirectQuery(params, { page: data.page + 1 })}`,
                  bv.key,
                )}
                className={buttonStyles.secondary}
              >
                {t("seo.redirects.list.next")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
