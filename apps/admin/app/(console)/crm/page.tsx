import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_CRM_OVERVIEW_API, CrmOverviewResponseSchema } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import { Icon, type IconKey } from "../../../components/icons";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../components/ui";
import { companyPlace, crmListHref, peopleListHref } from "../../../lib/crm-view";
import { ADMIN_TIME_ZONE } from "../../../lib/i18n/config";
import { dateTimeFormat } from "../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("crm.overview.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
};

function Count({
  href,
  icon,
  label,
  value,
}: {
  href: string;
  icon: IconKey;
  label: string;
  value: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-panel transition-colors hover:border-petrol/40 hover:bg-surface-2"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-petrol-soft text-petrol-strong ring-1 ring-inset ring-petrol/25">
        <Icon name={icon} size={19} />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tabular-nums text-ink">{value}</span>
        <span className="block text-sm text-ink-3 group-hover:text-ink-2">{label}</span>
      </span>
    </Link>
  );
}

/**
 * CRM-3 (ADR-032 D11): the CRM's start page — real counts of the sites the caller reads (each a
 * link to the filtered list) and the companies changed last. No sample data and no derived
 * metrics; the dashboard is CRM-5.
 */
export default async function CrmOverviewPage() {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const res = await serverRead(ADMIN_CRM_OVERVIEW_API, CrmOverviewResponseSchema);
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="building" title={t("crm.overview.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 403 ? (
            <EmptyState icon="shield" title={t("crm.common.noAccess")}>
              {t("crm.list.noAccessText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("crm.overview.loadError")}>
              {t("crm.common.tryAgainLater")}
            </ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { counts, recentCompanies } = res.data;
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="building"
        title={t("crm.overview.title")}
        description={t("crm.overview.description")}
      />
      <section aria-label={t("crm.overview.countsLabel")}>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <li key="companies">
            <Count
              href={crmListHref({})}
              icon="building"
              label={t("crm.overview.companies")}
              value={counts.companies}
            />
          </li>
          <li key="mine">
            <Count
              href={crmListHref({ owner: "me" })}
              icon="star"
              label={t("crm.overview.myCompanies")}
              value={counts.myCompanies}
            />
          </li>
          <li key="no-owner">
            <Count
              href={crmListHref({ owner: "none" })}
              icon="alert"
              label={t("crm.overview.companiesWithoutOwner")}
              value={counts.companiesWithoutOwner}
            />
          </li>
          {counts.people !== null ? (
            <li key="people">
              <Count
                href={peopleListHref({})}
                icon="staff"
                label={t("crm.overview.people")}
                value={counts.people}
              />
            </li>
          ) : null}
          {counts.peopleWithoutCompany !== null ? (
            <li key="people-no-company">
              <Count
                href={peopleListHref({ company: "none" })}
                icon="inbox"
                label={t("crm.overview.peopleWithoutCompany")}
                value={counts.peopleWithoutCompany}
              />
            </li>
          ) : null}
          <li key="leads">
            <Link
              href="/leads"
              className="flex h-full items-center gap-4 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-2 transition-colors hover:border-petrol/40 hover:text-ink"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2 ring-1 ring-inset ring-line">
                <Icon name="inbox" size={19} />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-ink">{t("crm.overview.leads")}</span>
                <span className="block text-ink-3">{t("crm.overview.leadsHint")}</span>
              </span>
            </Link>
          </li>
        </ul>
      </section>
      <Panel
        id="recent"
        title={t("crm.overview.recent")}
        description={t("crm.overview.recentDescription")}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {recentCompanies.length === 0 ? (
          <EmptyState key="empty" icon="building" title={t("crm.list.empty")}>
            {t("crm.list.emptyText")}
          </EmptyState>
        ) : (
          <ul key="list" className="divide-y divide-line">
            {recentCompanies.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/crm/companies/${c.id}`}
                  className="grid grid-cols-1 gap-1 px-5 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-6"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-sm text-ink-3">
                      {companyPlace(c, locale) || t("crm.common.notSet")}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-sm text-ink-2">
                    {c.owner ? (
                      <span key="owner" className={c.owner.active ? undefined : "line-through"}>
                        {c.owner.displayName}
                      </span>
                    ) : (
                      <span key="none" className="text-ink-3">
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
      </Panel>
    </div>
  );
}
