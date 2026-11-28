import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_CRM_COMPANIES_API, CrmCompanyListResponseSchema } from "@dream/contracts";
import { FIELD, PageHeader, SITE_SHORT } from "../../../../components/catalog/parts";
import { Icon } from "../../../../components/icons";
import {
  buttonStyles,
  cx,
  EmptyState,
  ErrorState,
  Panel,
  StatusPill,
} from "../../../../components/ui";
import {
  companyPlace,
  countryOptions,
  crmListHref,
  crmListQuery,
  hasCrmFilters,
  readCrmFilters,
} from "../../../../lib/crm-view";
import { ADMIN_TIME_ZONE } from "../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("crm.list.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
};

/**
 * CRM-1 (ADR-032): the companies of the sites the caller reads (crm:read), sorted by name, with
 * search, site, account-owner and country filters. Customer data: the API audits every read.
 */
export default async function CrmCompaniesPage({ searchParams }: PageProps<"/crm/companies">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const filters = readCrmFilters(await searchParams);
  const list = await serverRead(
    `${ADMIN_CRM_COMPANIES_API}${crmListQuery(filters)}`,
    CrmCompanyListResponseSchema,
  );
  const filtered = hasCrmFilters(filters);
  if (!list.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="building" title={t("crm.list.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {list.status === 403 ? (
            <EmptyState icon="shield" title={t("crm.common.noAccess")}>
              {t("crm.list.noAccessText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("crm.list.loadError")}>{t("crm.common.tryAgainLater")}</ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { items, nextCursor, sites, manageableSiteIds } = list.data;
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="building"
        title={t("crm.list.title")}
        description={t("crm.list.description")}
        actions={
          manageableSiteIds.length > 0 ? (
            <Link href="/crm/companies/new" className={buttonStyles.primary}>
              <Icon name="plus" size={16} />
              <span>{t("crm.list.newCompany")}</span>
            </Link>
          ) : null
        }
      />
      <Panel
        id="companies"
        title={t("crm.list.title")}
        description={
          nextCursor
            ? t("crm.list.shownMore", { n: items.length })
            : t("crm.list.shown", { n: items.length })
        }
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <form
          method="get"
          action="/crm/companies"
          role="search"
          aria-label={t("crm.list.filterLabel")}
          className="border-b border-line px-5 pb-4 sm:px-6"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
            <label className="relative block">
              <span className="sr-only">{t("crm.list.searchLabel")}</span>
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
                placeholder={t("crm.list.searchPlaceholder")}
                className={cx(FIELD, "pl-9")}
              />
            </label>
            <label>
              <span className="sr-only">{t("crm.list.site")}</span>
              <select name="site" defaultValue={filters.site} className={FIELD}>
                <option value="">{t("crm.list.allSites")}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("crm.list.owner")}</span>
              <select name="owner" defaultValue={filters.owner} className={FIELD}>
                <option value="">{t("crm.list.anyOwner")}</option>
                <option value="me">{t("crm.list.ownedByMe")}</option>
                <option value="none">{t("crm.list.noOwner")}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">{t("crm.list.country")}</span>
              <select name="country" defaultValue={filters.country} className={FIELD}>
                <option value="">{t("crm.list.anyCountry")}</option>
                {countryOptions(locale).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonStyles.primary}>
              {t("crm.list.apply")}
            </button>
          </div>
          {filtered ? (
            <div key="clear" className="mt-3">
              <Link href={crmListHref({ site: filters.site })} className={buttonStyles.ghost}>
                {t("crm.list.clearFilters")}
              </Link>
            </div>
          ) : null}
        </form>
        {items.length === 0 ? (
          <EmptyState
            key="empty"
            icon="building"
            title={filtered ? t("crm.list.noMatches") : t("crm.list.empty")}
          >
            {filtered ? t("crm.list.noMatchesText") : t("crm.list.emptyText")}
          </EmptyState>
        ) : (
          <ul key="list" className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/crm/companies/${c.id}`}
                  className="grid grid-cols-1 gap-1 px-5 py-3.5 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-6"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-sm text-ink-3">
                      {[companyPlace(c, locale), c.registrationId].filter(Boolean).join(" · ") ||
                        c.website ||
                        t("crm.common.notSet")}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-sm text-ink-2">
                    {c.owner ? (
                      <span
                        key="owner"
                        className={c.owner.active ? undefined : "text-ink-3 line-through"}
                        title={c.owner.active ? undefined : t("crm.common.noLongerAccess")}
                      >
                        {c.owner.displayName}
                      </span>
                    ) : (
                      <span key="no-owner" className="text-ink-3">
                        {t("crm.common.noOwner")}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3 sm:justify-end">
                    <StatusPill tone="neutral">{SITE_SHORT[c.siteKey]}</StatusPill>
                    <span className="tabular-nums">
                      {t("crm.list.updated", { date: DATE.format(new Date(c.updatedAt)) })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {nextCursor || filters.cursor ? (
          <div className="flex justify-between gap-3 border-t border-line px-5 pt-3 sm:px-6">
            {filters.cursor ? (
              <Link
                key="first"
                href={crmListHref({ ...filters, cursor: "" })}
                className={buttonStyles.secondary}
              >
                {t("crm.list.firstPage")}
              </Link>
            ) : (
              <span key="no-first" />
            )}
            {nextCursor ? (
              <Link
                key="next"
                href={crmListHref({ ...filters, cursor: nextCursor })}
                className={buttonStyles.secondary}
              >
                {t("crm.list.nextPage")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
