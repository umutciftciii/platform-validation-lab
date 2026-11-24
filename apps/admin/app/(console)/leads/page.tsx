import type { Metadata } from "next";
import Link from "next/link";
import {
  LEAD_EXPORT_SUMMARY_PATH,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LeadExportSummaryResponseSchema,
  LeadListResponseSchema,
} from "@dream/contracts";
import { FIELD, PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import { LeadExport } from "../../../components/leads/lead-export";
import {
  buttonStyles,
  cx,
  EmptyState,
  ErrorState,
  Panel,
  StatusPill,
} from "../../../components/ui";
import { ADMIN_TIME_ZONE } from "../../../lib/i18n/config";
import { dateTimeFormat } from "../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import {
  countryName,
  hasLeadFilters,
  leadExportQuery,
  leadListHref,
  leadListQuery,
  readLeadFilters,
  sourceLabel,
  statusLabel,
  STATUS_TONE,
} from "../../../lib/leads-view";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("leads.list.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

/**
 * DP-042 (ADR-016 D8): document requests left on the public sites. Customer data: the API answers
 * only with lead:read on the lead's site (customer-data roles, DP-076/DP-077); every read is
 * audited. DP-041 (ADR-019): status and assignee filters; the workflow itself is on the detail
 * page. DP-227: creation date range and the CSV export of the filtered leads (lead:export).
 */
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const filters = readLeadFilters(await searchParams);
  const [list, summary] = await Promise.all([
    serverRead(`/api/v1/admin/leads${leadListQuery(filters)}`, LeadListResponseSchema),
    serverRead(
      `${LEAD_EXPORT_SUMMARY_PATH}${leadExportQuery(filters)}`,
      LeadExportSummaryResponseSchema,
    ),
  ]);
  const filtered = hasLeadFilters(filters);
  if (!list.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title={t("leads.list.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {list.status === 403 ? (
            <EmptyState icon="shield" title={t("leads.common.noAccess")}>
              {t("leads.list.noAccessText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("leads.list.loadError")}>
              {t("leads.common.tryAgainLater")}
            </ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { items, nextCursor, sites } = list.data;
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title={t("leads.list.title")}
        description={t("leads.list.description")}
        actions={
          <Link href="/leads/notifications" className={buttonStyles.secondary}>
            <Icon name="bell" size={16} />
            {t("leads.list.notifications")}
          </Link>
        }
      />
      <Panel
        id="leads"
        title={t("leads.list.title")}
        description={
          nextCursor
            ? t("leads.list.shownMore", { n: items.length })
            : t("leads.list.shown", { n: items.length })
        }
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <form
          method="get"
          action="/leads"
          role="search"
          aria-label={t("leads.list.filterLabel")}
          className="space-y-3 border-b border-line px-5 pb-4 sm:px-6"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
            <label className="relative block">
              <span className="sr-only">{t("leads.list.searchLabel")}</span>
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
                placeholder={t("leads.list.searchPlaceholder")}
                className={cx(FIELD, "pl-9")}
              />
            </label>
            <label>
              <span className="sr-only">{t("leads.list.site")}</span>
              <select name="site" defaultValue={filters.site} className={FIELD}>
                <option value="">{t("leads.list.allSites")}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("leads.list.status")}</span>
              <select name="status" defaultValue={filters.status} className={FIELD}>
                <option value="">{t("leads.list.anyStatus")}</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("leads.list.source")}</span>
              <select name="source" defaultValue={filters.source} className={FIELD}>
                <option value="">{t("leads.list.anySource")}</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("leads.common.assignedTo")}</span>
              <select name="assignee" defaultValue={filters.assignee} className={FIELD}>
                <option value="">{t("leads.list.anyone")}</option>
                <option value="me">{t("leads.list.assignedToMe")}</option>
                <option value="none">{t("leads.common.unassigned")}</option>
              </select>
            </label>
            <button type="submit" className={buttonStyles.primary}>
              {t("leads.list.apply")}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-end">
            <label className="block min-w-0 sm:w-44">
              <span className="mb-1 block text-xs font-medium text-ink-3">
                {t("leads.list.createdFrom")}
              </span>
              <input type="date" name="from" defaultValue={filters.from} className={FIELD} />
            </label>
            <label className="block min-w-0 sm:w-44">
              <span className="mb-1 block text-xs font-medium text-ink-3">
                {t("leads.list.createdTo")}
              </span>
              <input type="date" name="to" defaultValue={filters.to} className={FIELD} />
            </label>
            {filtered ? (
              <Link
                key="clear"
                href={leadListHref({ site: filters.site })}
                className={cx(
                  buttonStyles.ghost,
                  "justify-self-start min-[360px]:col-span-2 sm:col-span-1",
                )}
              >
                {t("leads.list.clearFilters")}
              </Link>
            ) : null}
          </div>
        </form>
        {summary.ok ? (
          <LeadExport
            key="export"
            count={summary.data.count}
            maxRows={summary.data.maxRows}
            canExport={summary.data.canExport}
            query={leadExportQuery(filters)}
            filtered={filtered}
          />
        ) : (
          <p
            key="export-unavailable"
            role="alert"
            className="border-b border-line px-5 py-3 text-sm text-danger sm:px-6"
          >
            {t("leads.list.exportUnavailable", { status: summary.status })}
          </p>
        )}
        {items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={filtered ? t("leads.list.noMatches") : t("leads.list.empty")}
          >
            {filtered ? t("leads.list.noMatchesText") : t("leads.list.emptyText")}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/leads/${l.id}`}
                  className="grid grid-cols-1 gap-1 px-5 py-3.5 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:gap-4 sm:px-6"
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-ink">
                        {l.anonymisedAt ? t("leads.common.anonymised") : l.fullName}
                      </span>
                      <StatusPill tone={STATUS_TONE[l.status]}>
                        {statusLabel(l.status, t)}
                      </StatusPill>
                    </span>
                    <span className="block truncate text-sm text-ink-3">{l.email}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {l.assignedTo ? (
                        <>
                          {t("leads.common.assignedTo")}{" "}
                          <span className={l.assignedTo.active ? "text-ink-2" : "line-through"}>
                            {l.assignedTo.displayName}
                          </span>
                          {l.assignedTo.active ? null : (
                            <span>{t("leads.list.noLongerAccess")}</span>
                          )}
                        </>
                      ) : (
                        t("leads.common.unassigned")
                      )}
                    </span>
                  </span>
                  <span className="min-w-0 text-sm text-ink-2">
                    <span className="block truncate">{l.company}</span>
                    <span className="block truncate text-ink-3">
                      {countryName(l.country, locale)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3 sm:justify-end">
                    <StatusPill tone="neutral">{SITE_SHORT[l.siteKey]}</StatusPill>
                    <StatusPill tone={l.source === "CONTACT_FORM" ? "petrol" : "neutral"}>
                      {sourceLabel(l.source, t)}
                    </StatusPill>
                    {l.retentionHold ? (
                      <StatusPill tone="amber">{t("leads.list.hold")}</StatusPill>
                    ) : null}
                    {l.marketingConsentAt ? (
                      <StatusPill tone="success">{t("leads.list.marketingOk")}</StatusPill>
                    ) : null}
                    {l.freeMailDomain ? (
                      <StatusPill tone="amber">{t("leads.list.freeMail")}</StatusPill>
                    ) : null}
                    <span className="tabular-nums">
                      {l.requestCount > 0
                        ? `${t("leads.list.documentRequests", { count: l.requestCount })} · `
                        : ""}
                      {DATE.format(new Date(l.lastRequestAt))}
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
                href={leadListHref({ ...filters, cursor: "" })}
                className={buttonStyles.secondary}
              >
                {t("leads.list.firstPage")}
              </Link>
            ) : (
              <span />
            )}
            {nextCursor ? (
              <Link
                href={leadListHref({ ...filters, cursor: nextCursor })}
                className={buttonStyles.secondary}
              >
                {t("leads.list.nextPage")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
