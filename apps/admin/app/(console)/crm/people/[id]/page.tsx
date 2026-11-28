import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ADMIN_CRM_PEOPLE_API,
  CrmPersonProfileResponseSchema,
  type CrmLeadEvent,
} from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../../components/catalog/parts";
import { CompanyHistory } from "../../../../../components/crm/company-history";
import { ContactHistory } from "../../../../../components/crm/contact-history";
import { LeadRecords } from "../../../../../components/crm/lead-records";
import { readTab, ViewTabs } from "../../../../../components/crm/view-tabs";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../../../components/ui";
import { companyPlace } from "../../../../../lib/crm-view";
import { ADMIN_TIME_ZONE } from "../../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../../lib/i18n/server";
import type { Translate } from "../../../../../lib/i18n/types";
import { STATUS_TONE, statusLabel } from "../../../../../lib/leads-view";
import { serverRead } from "../../../../../lib/server-api";
import { requireStaffSession } from "../../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("crm.person.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

const TABS = ["overview", "leads", "contacts", "notes", "activity"] as const;
type Tab = (typeof TABS)[number];

function Row({ label, children, t }: { label: string; children: ReactNode; t: Translate }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-ink">
        {empty ? (
          <span key="unset" className="text-ink-3">
            {t("crm.common.notSet")}
          </span>
        ) : (
          <span key="value">{children}</span>
        )}
      </dd>
    </div>
  );
}

function eventSentence(e: CrmLeadEvent, t: Translate): string {
  const name = e.actor.displayName;
  const lead = e.lead.label ?? t("crm.history.unnamedLead");
  if (e.kind === "STATUS_CHANGED") {
    return t("crm.person.statusChanged", {
      name,
      lead,
      status: e.toStatus ? statusLabel(e.toStatus, t) : "—",
    });
  }
  return e.toAssignee
    ? t("crm.person.assigned", { name, lead, assignee: e.toAssignee.displayName })
    : t("crm.person.unassigned", { name, lead });
}

/**
 * CRM-3 (ADR-032 D11): a person's 360° profile — name, e-mail and phone from their leads, their
 * company and its account owner, every lead with its requests, the contact history, the notes
 * staff wrote on the leads and the activities (sales steps, CRM changes). Tabs with their own
 * address; one audited read. Linking stays on the company page and the lead page (CRM-2).
 */
export default async function PersonPage({ params, searchParams }: PageProps<"/crm/people/[id]">) {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const { id } = await params;
  const tab: Tab = readTab((await searchParams)["tab"], TABS);
  const res = await serverRead(
    `${ADMIN_CRM_PEOPLE_API}/${encodeURIComponent(id)}`,
    CrmPersonProfileResponseSchema,
  );
  const back = { href: "/crm/people", label: t("crm.person.back") };
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="staff" title={t("crm.person.title")} back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 404 ? (
            <EmptyState icon="staff" title={t("crm.person.notFound")}>
              {t("crm.person.notFoundText")}
            </EmptyState>
          ) : res.status === 403 ? (
            <EmptyState icon="shield" title={t("crm.common.noAccess")}>
              {t("crm.peopleList.noAccessText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("crm.person.loadError")}>
              {t("crm.common.tryAgainLater")}
            </ErrorState>
          )}
        </div>
      </div>
    );
  }
  const p = res.data;
  const name = p.person.displayName ?? t("crm.people.anonymisedPerson");
  const emails = p.person.leads.filter((l) => !l.anonymised && l.email).map((l) => l.email);
  const href = (key: Tab) =>
    key === "overview" ? `/crm/people/${p.person.id}` : `/crm/people/${p.person.id}?tab=${key}`;
  return (
    <div className="space-y-6">
      <PageHeader
        icon="staff"
        title={name}
        back={back}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone="neutral">{SITE_SHORT[p.siteKey]}</StatusPill>
            {p.company ? (
              <Link
                key="company"
                href={`/crm/companies/${p.company.id}`}
                className="text-petrol-strong underline-offset-2 hover:underline"
              >
                {p.company.name}
              </Link>
            ) : (
              <span key="no-company" className="text-ink-3">
                {t("crm.leadPanel.noCompany")}
              </span>
            )}
          </span>
        }
      />
      <ViewTabs
        label={t("crm.person.tabsLabel")}
        active={tab}
        href={href}
        tabs={[
          { key: "overview", label: t("crm.person.tabs.overview") },
          { key: "leads", label: t("crm.person.tabs.leads"), count: p.leads.length },
          { key: "contacts", label: t("crm.person.tabs.contacts"), count: p.contacts.length },
          { key: "notes", label: t("crm.person.tabs.notes"), count: p.notes.length },
          {
            key: "activity",
            label: t("crm.person.tabs.activity"),
            count: p.leadEvents.length + p.activities.length,
          },
        ]}
      />
      {tab === "overview" ? (
        <div key="overview" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel id="contact" title={t("crm.person.contact")}>
            <dl className="divide-y divide-line">
              <Row label={t("crm.person.name")} t={t}>
                {p.person.displayName}
              </Row>
              <Row label={t("crm.person.email")} t={t}>
                {p.email ? (
                  <a
                    href={`mailto:${p.email}`}
                    className="break-all text-petrol-strong underline-offset-2 hover:underline"
                  >
                    {p.email}
                  </a>
                ) : null}
              </Row>
              {emails.length > 1 ? (
                <Row label={t("crm.person.otherEmails")} t={t}>
                  <span className="break-all">
                    {emails.filter((e) => e !== p.email).join(", ")}
                  </span>
                </Row>
              ) : null}
              <Row label={t("crm.person.phone")} t={t}>
                {p.phone ? (
                  <a
                    href={`tel:${p.phone.replace(/[^+0-9]/g, "")}`}
                    className="text-petrol-strong underline-offset-2 hover:underline"
                  >
                    {p.phone}
                  </a>
                ) : null}
              </Row>
            </dl>
            <p className="mt-3 text-xs text-ink-3">{t("crm.person.fromLeads")}</p>
          </Panel>
          <Panel id="company" title={t("crm.person.company")}>
            {p.company ? (
              <dl key="company" className="divide-y divide-line">
                <Row label={t("crm.form.name")} t={t}>
                  <Link
                    href={`/crm/companies/${p.company.id}`}
                    className="text-petrol-strong underline-offset-2 hover:underline"
                  >
                    {p.company.name}
                  </Link>
                </Row>
                <Row label={t("crm.person.place")} t={t}>
                  {companyPlace(p.company, locale)}
                </Row>
                <Row label={t("crm.form.owner")} t={t}>
                  {p.company.owner ? (
                    <span className={p.company.owner.active ? undefined : "line-through"}>
                      {p.company.owner.displayName}
                    </span>
                  ) : (
                    <span className="text-ink-3">{t("crm.common.noOwner")}</span>
                  )}
                </Row>
              </dl>
            ) : (
              <p key="none" className="text-sm text-ink-3">
                {t("crm.person.noCompanyText")}
              </p>
            )}
          </Panel>
          <Panel
            id="lead-summary"
            title={t("crm.person.leadSummary")}
            description={t("crm.person.leadSummaryDescription")}
            className="lg:col-span-2"
          >
            <ul className="divide-y divide-line">
              {p.person.leads.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3"
                >
                  {l.anonymised ? (
                    <span key="anon" className="flex-1 text-ink-3">
                      {t("crm.people.anonymisedLead")}
                    </span>
                  ) : (
                    <Link
                      key="lead"
                      href={`/leads/${l.id}`}
                      className="min-w-0 flex-1 break-all text-petrol-strong underline-offset-2 hover:underline"
                    >
                      {l.email}
                    </Link>
                  )}
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={STATUS_TONE[l.status]}>{statusLabel(l.status, t)}</StatusPill>
                    <span className="text-xs tabular-nums text-ink-3">
                      {t("crm.people.lastRequest", {
                        date: DATE.format(new Date(l.lastRequestAt)),
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
      {tab === "leads" ? (
        <Panel
          key="leads"
          id="leads"
          title={t("crm.person.tabs.leads")}
          description={t("crm.person.leadsDescription")}
        >
          <LeadRecords leads={p.leads} t={t} date={DATE} showPerson={false} />
        </Panel>
      ) : null}
      {tab === "contacts" ? (
        <Panel
          key="contacts"
          id="contacts"
          title={t("crm.person.tabs.contacts")}
          description={t("crm.contacts.description")}
        >
          <ContactHistory items={p.contacts} t={t} date={DATE} showPerson={false} />
        </Panel>
      ) : null}
      {tab === "notes" ? (
        <Panel
          key="notes"
          id="notes"
          title={t("crm.person.tabs.notes")}
          description={t("crm.person.notesDescription")}
        >
          {p.notes.length === 0 ? (
            <p key="empty" className="text-sm text-ink-3">
              {t("crm.person.noNotes")}
            </p>
          ) : (
            <ol key="list" className="space-y-4">
              {p.notes.map((n) => (
                <li key={n.id} className="border-l-2 border-line pl-4">
                  <p className="text-sm text-ink">
                    {t("crm.person.noteBy", {
                      name: n.actor.displayName,
                      lead: n.lead.label ?? t("crm.history.unnamedLead"),
                    })}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    <time dateTime={n.createdAt}>{DATE.format(new Date(n.createdAt))}</time>
                  </p>
                  {n.body ? (
                    <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
                      {n.body}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-3">{t("crm.contacts.noText")}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-ink-3">{t("crm.person.notesHint")}</p>
        </Panel>
      ) : null}
      {tab === "activity" ? (
        <div key="activity" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel
            id="sales"
            title={t("crm.person.salesSteps")}
            description={t("crm.person.salesStepsDescription")}
          >
            {p.leadEvents.length === 0 ? (
              <p key="empty" className="text-sm text-ink-3">
                {t("crm.history.empty")}
              </p>
            ) : (
              <ol key="list" className="space-y-4">
                {p.leadEvents.map((e) => (
                  <li key={e.id} className="border-l-2 border-line pl-4">
                    <p className="break-words text-sm text-ink">{eventSentence(e, t)}</p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      <time dateTime={e.createdAt}>{DATE.format(new Date(e.createdAt))}</time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <Panel
            id="crm-history"
            title={t("crm.person.crmHistory")}
            description={t("crm.person.crmHistoryDescription")}
          >
            <CompanyHistory items={p.activities} companyId={null} t={t} date={DATE} />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
