import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_CRM_PEOPLE_API, CrmPeopleListResponseSchema, LEAD_STATUSES } from "@dream/contracts";
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
  hasPeopleFilters,
  peopleListHref,
  peopleListQuery,
  readPeopleFilters,
} from "../../../../lib/crm-view";
import { ADMIN_TIME_ZONE } from "../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import { STATUS_TONE, statusLabel } from "../../../../lib/leads-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("crm.peopleList.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
};

/**
 * CRM-3 (ADR-032 D11): the people of the sites the caller reads (crm:read and lead:read), newest
 * first, with search (name, e-mail, typed company or company name), site, company, account-owner
 * and lead-status filters. Each row opens the person's profile. Customer data: the API audits
 * every read (filters by kind, never the search text).
 */
export default async function CrmPeoplePage({ searchParams }: PageProps<"/crm/people">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const filters = readPeopleFilters(await searchParams);
  const list = await serverRead(
    `${ADMIN_CRM_PEOPLE_API}${peopleListQuery(filters)}`,
    CrmPeopleListResponseSchema,
  );
  const filtered = hasPeopleFilters(filters);
  if (!list.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="staff" title={t("crm.peopleList.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {list.status === 403 ? (
            <EmptyState icon="shield" title={t("crm.common.noAccess")}>
              {t("crm.peopleList.noAccessText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("crm.peopleList.loadError")}>
              {t("crm.common.tryAgainLater")}
            </ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { items, nextCursor, sites } = list.data;
  // A company id in the filter comes from a company page ("all people of this company").
  const companyIsId = filters.company !== "" && !["any", "none"].includes(filters.company);
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="staff"
        title={t("crm.peopleList.title")}
        description={t("crm.peopleList.description")}
      />
      <Panel
        id="people"
        title={t("crm.peopleList.title")}
        description={
          nextCursor
            ? t("crm.list.shownMore", { n: items.length })
            : t("crm.list.shown", { n: items.length })
        }
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <form
          method="get"
          action="/crm/people"
          role="search"
          aria-label={t("crm.peopleList.filterLabel")}
          className="border-b border-line px-5 pb-4 sm:px-6"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
            <label className="relative block">
              <span className="sr-only">{t("crm.peopleList.searchLabel")}</span>
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
                placeholder={t("crm.peopleList.searchPlaceholder")}
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
              <span className="sr-only">{t("crm.peopleList.company")}</span>
              <select name="company" defaultValue={filters.company} className={FIELD}>
                <option value="">{t("crm.peopleList.anyCompany")}</option>
                <option value="any">{t("crm.peopleList.withCompany")}</option>
                <option value="none">{t("crm.peopleList.withoutCompany")}</option>
                {companyIsId ? (
                  <option value={filters.company}>{t("crm.peopleList.thisCompany")}</option>
                ) : null}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("crm.list.owner")}</span>
              <select name="owner" defaultValue={filters.owner} className={FIELD}>
                <option value="">{t("crm.list.anyOwner")}</option>
                <option value="me">{t("crm.peopleList.ownedByMe")}</option>
                <option value="none">{t("crm.peopleList.noOwner")}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">{t("crm.peopleList.status")}</span>
              <select name="status" defaultValue={filters.status} className={FIELD}>
                <option value="">{t("crm.peopleList.anyStatus")}</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s, t)}
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
              <Link href={peopleListHref({ site: filters.site })} className={buttonStyles.ghost}>
                {t("crm.list.clearFilters")}
              </Link>
            </div>
          ) : null}
        </form>
        {items.length === 0 ? (
          <EmptyState
            key="empty"
            icon="staff"
            title={filtered ? t("crm.peopleList.noMatches") : t("crm.peopleList.empty")}
          >
            {filtered ? t("crm.list.noMatchesText") : t("crm.peopleList.emptyText")}
          </EmptyState>
        ) : (
          <ul key="list" className="divide-y divide-line">
            {items.map((p) => {
              const latest = p.leads[0];
              const live = p.leads.find((l) => !l.anonymised);
              return (
                <li key={p.id}>
                  <Link
                    href={`/crm/people/${p.id}`}
                    className="grid grid-cols-1 gap-1 px-5 py-3.5 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-6"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {p.displayName ?? t("crm.people.anonymisedPerson")}
                      </span>
                      <span className="block truncate text-sm text-ink-3">
                        {[live?.email, t("crm.people.leadCount", { n: p.leads.length })]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="min-w-0 text-sm">
                      {p.company ? (
                        <span key="company" className="block truncate text-ink-2">
                          {p.company.name}
                        </span>
                      ) : (
                        <span key="no-company" className="block truncate text-ink-3">
                          {t("crm.leadPanel.noCompany")}
                        </span>
                      )}
                      {p.companyOwner ? (
                        <span
                          key="owner"
                          className={cx(
                            "block truncate text-xs text-ink-3",
                            p.companyOwner.active ? undefined : "line-through",
                          )}
                        >
                          {t("crm.peopleList.owner", { name: p.companyOwner.displayName })}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3 sm:justify-end">
                      {latest ? (
                        <StatusPill key="status" tone={STATUS_TONE[latest.status]}>
                          {statusLabel(latest.status, t)}
                        </StatusPill>
                      ) : null}
                      <StatusPill tone="neutral">{SITE_SHORT[p.siteKey]}</StatusPill>
                      {latest ? (
                        <span key="date" className="tabular-nums">
                          {t("crm.people.lastRequest", {
                            date: DATE.format(new Date(latest.lastRequestAt)),
                          })}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor || filters.cursor ? (
          <div className="flex justify-between gap-3 border-t border-line px-5 pt-3 sm:px-6">
            {filters.cursor ? (
              <Link
                key="first"
                href={peopleListHref({ ...filters, cursor: "" })}
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
                href={peopleListHref({ ...filters, cursor: nextCursor })}
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
