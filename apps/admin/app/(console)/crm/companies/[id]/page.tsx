import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ADMIN_CRM_COMPANIES_API,
  CrmActivityListResponseSchema,
  CrmCompanyDetailResponseSchema,
  CrmCompanyPeopleResponseSchema,
  LEAD_STATUSES,
  type CrmCompany,
} from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../../components/catalog/parts";
import { CompanyForm } from "../../../../../components/crm/company-form";
import { CompanyHistory } from "../../../../../components/crm/company-history";
import { CompanyNoteForm } from "../../../../../components/crm/company-note-form";
import { CompanyPeople } from "../../../../../components/crm/company-people";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../../../components/ui";
import { companyPlace, countryOptions } from "../../../../../lib/crm-view";
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
 * staff notes. CRM-3 turns this into the 360° view (people, history, requests in tabs).
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
  const historyParam = (await searchParams)["history"];
  const historyCursor = typeof historyParam === "string" ? historyParam.slice(0, 40) : "";
  const base = `${ADMIN_CRM_COMPANIES_API}/${encodeURIComponent(id)}`;
  const [res, peopleRes, historyRes] = await Promise.all([
    serverRead(base, CrmCompanyDetailResponseSchema),
    serverRead(`${base}/people`, CrmCompanyPeopleResponseSchema),
    serverRead(
      `${base}/activities${historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}` : ""}`,
      CrmActivityListResponseSchema,
    ),
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
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="building"
        title={company.name}
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone="neutral">{SITE_SHORT[company.siteKey]}</StatusPill>
            <span>{companyPlace(company, locale)}</span>
          </span>
        }
      />
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
            id="notes"
            title={t("crm.form.internalNotes")}
            description={t("crm.form.internalNotesHint")}
          >
            <p className="whitespace-pre-line break-words text-sm text-ink">
              {company.internalNotes ?? t("crm.common.notSet")}
            </p>
          </Panel>
        </div>
      </div>
      {peopleRes.ok ? (
        <Panel
          key="people"
          id="people"
          title={t("crm.people.title")}
          description={t("crm.people.description")}
        >
          <CompanyPeople
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
        </Panel>
      ) : peopleRes.status !== 403 && peopleRes.status !== 404 ? (
        <Panel key="people-failed" id="people" title={t("crm.people.title")}>
          <p role="alert" className="text-sm text-danger">
            {t("crm.people.loadError")}
          </p>
        </Panel>
      ) : null}
      {historyRes.ok ? (
        <Panel
          key="history"
          id="history"
          title={t("crm.history.title")}
          description={t("crm.history.description")}
        >
          <div className="space-y-6">
            {canManage ? (
              <div key="note" className="rounded-xl border border-line bg-surface-2/50 p-4">
                <CompanyNoteForm companyId={company.id} />
              </div>
            ) : null}
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
                    href={`/crm/companies/${company.id}#history`}
                    className="text-sm text-petrol-strong underline-offset-2 hover:underline"
                  >
                    {t("crm.history.newest")}
                  </Link>
                ) : null}
                {historyRes.data.nextCursor ? (
                  <Link
                    key="older"
                    href={`/crm/companies/${company.id}?history=${encodeURIComponent(
                      historyRes.data.nextCursor,
                    )}#history`}
                    className="text-sm text-petrol-strong underline-offset-2 hover:underline"
                  >
                    {t("crm.history.older")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>
      ) : historyRes.status !== 403 && historyRes.status !== 404 ? (
        <Panel key="history-failed" id="history" title={t("crm.history.title")}>
          <p role="alert" className="text-sm text-danger">
            {t("crm.history.loadError")}
          </p>
        </Panel>
      ) : null}
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
  );
}
