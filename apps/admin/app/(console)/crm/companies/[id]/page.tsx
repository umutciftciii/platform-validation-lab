import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ADMIN_CRM_COMPANIES_API,
  CrmActivityListResponseSchema,
  CrmCompanyDetailResponseSchema,
  CrmCompanyLeadsResponseSchema,
  CrmCompanyPeopleResponseSchema,
  CrmContactHistoryResponseSchema,
  LEAD_STATUSES,
  type CrmCompany,
} from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../../components/catalog/parts";
import { CompanyForm } from "../../../../../components/crm/company-form";
import { CompanyHistory } from "../../../../../components/crm/company-history";
import { CompanyNoteForm } from "../../../../../components/crm/company-note-form";
import { CompanyPeople } from "../../../../../components/crm/company-people";
import { ContactHistory } from "../../../../../components/crm/contact-history";
import { LeadRecords } from "../../../../../components/crm/lead-records";
import { readTab, ViewTabs } from "../../../../../components/crm/view-tabs";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../../../components/ui";
import { companyPlace, countryOptions, peopleListHref } from "../../../../../lib/crm-view";
import { ADMIN_TIME_ZONE } from "../../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../../lib/i18n/server";
import type { Translate } from "../../../../../lib/i18n/types";
import { countryName, statusLabel } from "../../../../../lib/leads-view";
import { serverRead } from "../../../../../lib/server-api";
import { requireStaffSession } from "../../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("crm.detail.profile") };
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
 * One labelled value of the profile; "Not set" when empty. `stacked` keeps the label above the
 * value (narrow side panels).
 */
function Row({
  label,
  children,
  t,
  stacked = false,
}: {
  label: string;
  children: ReactNode;
  t: Translate;
  stacked?: boolean;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div
      className={
        stacked
          ? "grid grid-cols-1 gap-1 py-2.5"
          : "grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"
      }
    >
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-ink">
        {empty ? (
          <span key="unset" className="text-ink-3">
            {t("crm.common.notSet")}
          </span>
        ) : (
          <span key="value" className="whitespace-pre-line">
            {children}
          </span>
        )}
      </dd>
    </div>
  );
}

const TABS = ["overview", "people", "leads", "notes", "contacts", "activity"] as const;
type Tab = (typeof TABS)[number];

/** A section that could not be loaded (403/404 show nothing: the page itself says why). */
function LoadFailed({ status, text }: { status: number; text: string }) {
  return status !== 403 && status !== 404 ? (
    <p role="alert" className="text-sm text-danger">
      {text}
    </p>
  ) : null;
}

function OwnerName({ company, t }: { company: CrmCompany; t: Translate }) {
  if (!company.owner) return <span className="text-ink-3">{t("crm.common.noOwner")}</span>;
  return company.owner.active ? (
    <span key="active">{company.owner.displayName}</span>
  ) : (
    <span key="inactive">
      <span className="line-through">{company.owner.displayName}</span>{" "}
      <span className="text-ink-3">{t("crm.common.noLongerAccess")}</span>
    </span>
  );
}

/**
 * CRM-1 (ADR-032): a company's profile, contact details, notes and account owner; the editor for
 * staff with crm:manage on its site. CRM-2 adds its people (from their leads) and its history with
 * staff notes. CRM-3 (ADR-032 D11) turns it into the 360° view: tabs with their own address
 * (overview, people, leads and requests, notes, contact history, recent activity); each tab reads
 * only its own data (audited by the API).
 */
export default async function CompanyPage({
  params,
  searchParams,
}: PageProps<"/crm/companies/[id]">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const { id } = await params;
  const query = await searchParams;
  const tab: Tab = readTab(query["tab"], TABS);
  const historyParam = query["history"];
  const historyCursor = typeof historyParam === "string" ? historyParam.slice(0, 40) : "";
  const base = `${ADMIN_CRM_COMPANIES_API}/${encodeURIComponent(id)}`;
  const empty = Promise.resolve(null);
  const [res, peopleRes, leadsRes, contactsRes, historyRes] = await Promise.all([
    serverRead(base, CrmCompanyDetailResponseSchema),
    tab === "people" ? serverRead(`${base}/people`, CrmCompanyPeopleResponseSchema) : empty,
    tab === "leads" ? serverRead(`${base}/leads`, CrmCompanyLeadsResponseSchema) : empty,
    tab === "contacts" ? serverRead(`${base}/contacts`, CrmContactHistoryResponseSchema) : empty,
    tab === "notes"
      ? serverRead(`${base}/activities?kind=NOTE`, CrmActivityListResponseSchema)
      : tab === "activity"
        ? serverRead(
            `${base}/activities${historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}` : ""}`,
            CrmActivityListResponseSchema,
          )
        : empty,
  ]);
  const back = { href: "/crm/companies", label: t("crm.detail.back") };
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="building" title={t("crm.detail.profile")} back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 404 ? (
            <EmptyState icon="building" title={t("crm.detail.notFound")}>
              {t("crm.detail.notFoundText")}
            </EmptyState>
          ) : res.status === 403 ? (
            <EmptyState icon="shield" title={t("crm.common.noAccess")}>
              {t("crm.list.noAccessText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("crm.detail.loadError")}>
              {t("crm.common.tryAgainLater")}
            </ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { company, canManage, owners } = res.data;
  const self = `/crm/companies/${company.id}`;
  const href = (key: Tab) => (key === "overview" ? self : `${self}?tab=${key}`);
  return (
    <div className="space-y-6">
      <PageHeader
        icon="building"
        title={company.name}
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone="neutral">{SITE_SHORT[company.siteKey]}</StatusPill>
            <span>{companyPlace(company, locale)}</span>
            <span className="text-ink-3">
              {company.owner ? (
                <span key="owner">
                  {t("crm.detail.ownerShort", { name: company.owner.displayName })}
                </span>
              ) : (
                <span key="none">{t("crm.common.noOwner")}</span>
              )}
            </span>
          </span>
        }
      />
      <ViewTabs
        label={t("crm.detail.tabsLabel")}
        active={tab}
        href={href}
        tabs={TABS.map((key) => ({ key, label: t(`crm.detail.tabs.${key}`) }))}
      />
      {tab === "overview" ? (
        <div key="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <Panel id="profile" title={t("crm.detail.profile")}>
                <dl className="divide-y divide-line">
                  <Row label={t("crm.form.name")} t={t}>
                    {company.name}
                  </Row>
                  <Row label={t("crm.form.registrationId")} t={t}>
                    {company.registrationId}
                  </Row>
                  <Row label={t("crm.form.country")} t={t}>
                    {company.country ? countryName(company.country, locale) : null}
                  </Row>
                  <Row label={t("crm.form.city")} t={t}>
                    {company.city}
                  </Row>
                  <Row label={t("crm.form.address")} t={t}>
                    {company.address}
                  </Row>
                  <Row label={t("crm.form.description")} t={t}>
                    {company.description}
                  </Row>
                </dl>
              </Panel>
              <Panel id="contact" title={t("crm.detail.contact")}>
                <dl className="divide-y divide-line">
                  <Row label={t("crm.form.website")} t={t}>
                    {company.website ? (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-petrol-strong underline-offset-2 hover:underline"
                      >
                        {company.website}
                      </a>
                    ) : null}
                  </Row>
                  <Row label={t("crm.form.phone")} t={t}>
                    {company.phone}
                  </Row>
                  <Row label={t("crm.form.email")} t={t}>
                    {company.email}
                  </Row>
                </dl>
              </Panel>
            </div>
            <div className="space-y-6">
              <Panel id="account" title={t("crm.detail.account")}>
                <dl className="divide-y divide-line">
                  <Row label={t("crm.form.owner")} t={t} stacked>
                    <OwnerName company={company} t={t} />
                  </Row>
                </dl>
                <p className="mt-3 text-xs text-ink-3">
                  {t("crm.detail.created", {
                    date: DATE.format(new Date(company.createdAt)),
                    name: company.createdBy.displayName,
                  })}
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  {t("crm.detail.changed", {
                    date: DATE.format(new Date(company.updatedAt)),
                    name: company.updatedBy.displayName,
                  })}
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  {t("crm.detail.version", { n: company.version })}
                </p>
              </Panel>
              <Panel
                id="internal-notes"
                title={t("crm.form.internalNotes")}
                description={t("crm.form.internalNotesHint")}
              >
                <p className="whitespace-pre-line break-words text-sm text-ink">
                  {company.internalNotes ?? t("crm.common.notSet")}
                </p>
              </Panel>
            </div>
          </div>
          {canManage ? (
            <Panel
              key="edit"
              id="edit"
              title={t("crm.detail.edit")}
              description={t("crm.detail.editDescription")}
            >
              <CompanyForm
                mode="edit"
                company={company}
                owners={owners}
                countries={countryOptions(locale)}
              />
            </Panel>
          ) : (
            <p key="read-only" className="text-sm text-ink-3">
              {t("crm.detail.readOnly")}
            </p>
          )}
        </div>
      ) : null}
      {tab === "people" ? (
        <Panel
          key="people"
          id="people"
          title={t("crm.people.title")}
          description={t("crm.people.description")}
          action={
            <Link
              href={peopleListHref({ company: company.id })}
              className="text-sm text-petrol-strong underline-offset-2 hover:underline"
            >
              {t("crm.detail.peopleInList")}
            </Link>
          }
        >
          {peopleRes?.ok ? (
            <CompanyPeople
              key="people"
              companyId={company.id}
              people={peopleRes.data.people}
              canManage={peopleRes.data.canManage}
              dates={Object.fromEntries(
                peopleRes.data.people.flatMap((p) =>
                  p.leads.map((l) => [
                    l.id,
                    t("crm.people.lastRequest", { date: DATE.format(new Date(l.lastRequestAt)) }),
                  ]),
                ),
              )}
              statusLabels={Object.fromEntries(LEAD_STATUSES.map((s) => [s, statusLabel(s, t)]))}
            />
          ) : peopleRes ? (
            <LoadFailed key="failed" status={peopleRes.status} text={t("crm.people.loadError")} />
          ) : null}
        </Panel>
      ) : null}
      {tab === "leads" ? (
        <Panel
          key="leads"
          id="leads"
          title={t("crm.detail.tabs.leads")}
          description={t("crm.leads.description")}
        >
          {leadsRes?.ok ? (
            <div key="leads" className="space-y-3">
              <LeadRecords leads={leadsRes.data.leads} t={t} date={DATE} showPerson />
              {leadsRes.data.truncated ? (
                <p key="more" className="text-xs text-ink-3">
                  {t("crm.leads.truncated")}
                </p>
              ) : null}
            </div>
          ) : leadsRes ? (
            <LoadFailed key="failed" status={leadsRes.status} text={t("crm.leads.loadError")} />
          ) : null}
        </Panel>
      ) : null}
      {tab === "notes" ? (
        <Panel
          key="notes"
          id="notes"
          title={t("crm.detail.tabs.notes")}
          description={t("crm.detail.notesDescription")}
        >
          <div className="space-y-6">
            <div key="internal" className="rounded-xl border border-line p-4">
              <p className="text-sm font-medium text-ink">{t("crm.form.internalNotes")}</p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-2">
                {company.internalNotes ?? t("crm.common.notSet")}
              </p>
            </div>
            {canManage ? (
              <div key="note" className="rounded-xl border border-line bg-surface-2/50 p-4">
                <CompanyNoteForm companyId={company.id} />
              </div>
            ) : null}
            {historyRes?.ok ? (
              <div key="list" className="space-y-3">
                <CompanyHistory
                  items={historyRes.data.items}
                  companyId={company.id}
                  t={t}
                  date={DATE}
                />
                {historyRes.data.nextCursor ? (
                  <p key="more" className="text-xs text-ink-3">
                    {t("crm.detail.olderNotes")}{" "}
                    <Link
                      href={`${self}?tab=activity`}
                      className="text-petrol-strong underline-offset-2 hover:underline"
                    >
                      {t("crm.detail.tabs.activity")}
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : historyRes ? (
              <LoadFailed
                key="failed"
                status={historyRes.status}
                text={t("crm.history.loadError")}
              />
            ) : null}
          </div>
        </Panel>
      ) : null}
      {tab === "contacts" ? (
        <Panel
          key="contacts"
          id="contacts"
          title={t("crm.detail.tabs.contacts")}
          description={t("crm.contacts.description")}
        >
          {contactsRes?.ok ? (
            <div key="contacts" className="space-y-3">
              <ContactHistory items={contactsRes.data.items} t={t} date={DATE} showPerson />
              {contactsRes.data.truncated ? (
                <p key="more" className="text-xs text-ink-3">
                  {t("crm.contacts.truncated")}
                </p>
              ) : null}
            </div>
          ) : contactsRes ? (
            <LoadFailed
              key="failed"
              status={contactsRes.status}
              text={t("crm.contacts.loadError")}
            />
          ) : null}
        </Panel>
      ) : null}
      {tab === "activity" ? (
        <Panel
          key="history"
          id="history"
          title={t("crm.history.title")}
          description={t("crm.history.description")}
        >
          {historyRes?.ok ? (
            <div key="history" className="space-y-6">
              <CompanyHistory
                items={historyRes.data.items}
                companyId={company.id}
                t={t}
                date={DATE}
              />
              {historyCursor || historyRes.data.nextCursor ? (
                <div key="pages" className="flex flex-wrap gap-2">
                  {historyCursor ? (
                    <Link
                      key="newest"
                      href={`${self}?tab=activity`}
                      className="text-sm text-petrol-strong underline-offset-2 hover:underline"
                    >
                      {t("crm.history.newest")}
                    </Link>
                  ) : null}
                  {historyRes.data.nextCursor ? (
                    <Link
                      key="older"
                      href={`${self}?tab=activity&history=${encodeURIComponent(
                        historyRes.data.nextCursor,
                      )}`}
                      className="text-sm text-petrol-strong underline-offset-2 hover:underline"
                    >
                      {t("crm.history.older")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : historyRes ? (
            <LoadFailed key="failed" status={historyRes.status} text={t("crm.history.loadError")} />
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
