import type { Metadata } from "next";
import Link from "next/link";
import { LEAD_STATUSES, LeadListResponseSchema } from "@dream/contracts";
import { FIELD, PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import {
  buttonStyles,
  cx,
  EmptyState,
  ErrorState,
  Panel,
  StatusPill,
} from "../../../components/ui";
import {
  countryName,
  leadListHref,
  leadListQuery,
  readLeadFilters,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../../lib/leads-view";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export const metadata: Metadata = { title: "Leads" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

/**
 * DP-042 (ADR-016 D8): document requests left on the public sites. Customer data: the API answers
 * only with lead:read on the lead's site (customer-data roles, DP-076/DP-077); every read is
 * audited. DP-041 (ADR-019): status and assignee filters; the workflow itself is on the detail
 * page. Export is DP-126.
 */
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await requireStaffSession();
  const filters = readLeadFilters(await searchParams);
  const list = await serverRead(
    `/api/v1/admin/leads${leadListQuery(filters)}`,
    LeadListResponseSchema,
  );
  if (!list.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title="Leads" />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {list.status === 403 ? (
            <EmptyState icon="shield" title="No access to leads">
              Leads are customer data. Platform administrators read them; other staff need a role
              with lead access (Sales / CRM user for one site, or the customer-data officer), which
              an administrator gives under Staff and access. Every view is recorded in the audit
              log.
            </EmptyState>
          ) : (
            <ErrorState title="The leads could not be loaded">Try again in a moment.</ErrorState>
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
        title="Leads"
        description="People who requested a lead-gated document on a public site, newest first. Work them through the sales pipeline. Customer data: every view is audited."
      />
      <Panel
        id="leads"
        title="Leads"
        description={`${items.length} shown${nextCursor ? ", more on the next page" : ""}`}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <form
          method="get"
          action="/leads"
          role="search"
          aria-label="Filter leads"
          className="grid grid-cols-1 gap-3 border-b border-line px-5 pb-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
        >
          <label className="relative block">
            <span className="sr-only">Search by name, company or e-mail</span>
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
              placeholder="Search name, company or e-mail"
              className={cx(FIELD, "pl-9")}
            />
          </label>
          <label>
            <span className="sr-only">Site</span>
            <select name="site" defaultValue={filters.site} className={FIELD}>
              <option value="">All my sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select name="status" defaultValue={filters.status} className={FIELD}>
              <option value="">Any status</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Assigned to</span>
            <select name="assignee" defaultValue={filters.assignee} className={FIELD}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
            </select>
          </label>
          <button type="submit" className={buttonStyles.primary}>
            Apply
          </button>
        </form>
        {items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={
              filters.q || filters.status || filters.assignee ? "No matching leads" : "No leads yet"
            }
          >
            {filters.q || filters.status || filters.assignee
              ? "Try another search or filter."
              : "Document requests from the public sites appear here."}
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
                        {l.anonymisedAt ? "Anonymised lead" : l.fullName}
                      </span>
                      <StatusPill tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</StatusPill>
                    </span>
                    <span className="block truncate text-sm text-ink-3">{l.email}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {l.assignedTo ? (
                        <>
                          Assigned to{" "}
                          <span className={l.assignedTo.active ? "text-ink-2" : "line-through"}>
                            {l.assignedTo.displayName}
                          </span>
                          {l.assignedTo.active ? null : " (no longer has access)"}
                        </>
                      ) : (
                        "Unassigned"
                      )}
                    </span>
                  </span>
                  <span className="min-w-0 text-sm text-ink-2">
                    <span className="block truncate">{l.company}</span>
                    <span className="block truncate text-ink-3">{countryName(l.country)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3 sm:justify-end">
                    <StatusPill tone="neutral">{SITE_SHORT[l.siteKey]}</StatusPill>
                    {l.retentionHold ? <StatusPill tone="amber">Hold</StatusPill> : null}
                    {l.marketingConsentAt ? (
                      <StatusPill tone="success">Marketing OK</StatusPill>
                    ) : null}
                    {l.freeMailDomain ? <StatusPill tone="amber">Free mail</StatusPill> : null}
                    <span className="tabular-nums">
                      {l.requestCount} request{l.requestCount === 1 ? "" : "s"} ·{" "}
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
                First page
              </Link>
            ) : (
              <span />
            )}
            {nextCursor ? (
              <Link
                href={leadListHref({ ...filters, cursor: nextCursor })}
                className={buttonStyles.secondary}
              >
                Next page
              </Link>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
