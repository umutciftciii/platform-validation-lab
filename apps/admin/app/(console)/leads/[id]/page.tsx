import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  LEAD_PIPELINE_HELD,
  LeadDetailResponseSchema,
  type LeadActivity,
  type LeadContactMessage,
  type LeadStatus,
} from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../components/catalog/parts";
import { Icon, type IconKey } from "../../../../components/icons";
import { LeadActivityForm, LeadWorkflowForm } from "../../../../components/leads/lead-workflow";
import { cx, EmptyState, Panel, StatusPill } from "../../../../components/ui";
import { ADMIN_TIME_ZONE, type AdminLocale, INTL_LOCALE } from "../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import type { Translate } from "../../../../lib/i18n/types";
import {
  channelLabel,
  countryName,
  docTypeLabel,
  notificationLabel,
  notificationReason,
  NOTIFICATION_TONE,
  sourceLabel,
  statusLabel,
  STATUS_TONE,
  formLanguageLabel,
  textLanguageLabel,
} from "../../../../lib/leads-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("leads.detail.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

/** File size; one decimal for MB in the UI language's notation (English: "2.5 MB" as before). */
function size(bytes: number, locale: AdminLocale): string {
  const mb = new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });
  return bytes >= 1024 * 1024
    ? `${mb.format(bytes / 1024 / 1024)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The main path of the pipeline; UNQUALIFIED is a side exit (ADR-019 D2). */
const PATH: readonly LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"];

function Pipeline({ status, t }: { status: LeadStatus; t: Translate }) {
  const at = PATH.indexOf(status);
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("leads.detail.pipeline")}>
        {PATH.map((s, i) => {
          const done = at >= 0 && i < at;
          const current = s === status;
          return (
            <li
              key={s}
              aria-current={current ? "step" : undefined}
              className={cx(
                "flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset",
                current
                  ? "bg-petrol-soft font-semibold text-petrol-strong ring-petrol/30"
                  : done
                    ? "bg-surface-2 text-ink-2 ring-line"
                    : "text-ink-3 ring-line",
              )}
            >
              <span
                className={cx(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] tabular-nums",
                  current
                    ? "bg-petrol text-petrol-ink"
                    : done
                      ? "bg-success-soft text-success"
                      : "bg-surface-2 text-ink-3",
                )}
              >
                {done ? <Icon name="check" size={12} /> : i + 1}
              </span>
              {statusLabel(s, t)}
            </li>
          );
        })}
      </ol>
      {status === "UNQUALIFIED" ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <StatusPill tone="neutral">{statusLabel("UNQUALIFIED", t)}</StatusPill>
          {t("leads.detail.offPipeline")}
        </p>
      ) : null}
    </div>
  );
}

const ACTIVITY_ICON: Readonly<Record<LeadActivity["kind"], IconKey>> = {
  NOTE: "edit",
  CONTACT: "inbox",
  STATUS_CHANGED: "arrow",
  ASSIGNMENT_CHANGED: "staff",
};

function activityTitle(a: LeadActivity, t: Translate): string {
  switch (a.kind) {
    case "NOTE":
      return t("leads.detail.activity.note");
    case "CONTACT":
      return t("leads.detail.activity.contact", {
        channel: a.contactChannel
          ? channelLabel(a.contactChannel, t)
          : t("leads.detail.activity.otherChannel"),
      });
    case "STATUS_CHANGED":
      return t("leads.detail.activity.status", {
        from: a.fromStatus ? statusLabel(a.fromStatus, t) : "?",
        to: a.toStatus ? statusLabel(a.toStatus, t) : "?",
      });
    case "ASSIGNMENT_CHANGED":
      return a.toAssignee
        ? t("leads.detail.activity.assigned", { name: a.toAssignee.displayName })
        : a.fromAssignee
          ? t("leads.detail.activity.unassignedWas", { name: a.fromAssignee.displayName })
          : t("leads.common.unassigned");
  }
}

function Timeline({
  activities,
  t,
  date,
}: {
  activities: readonly LeadActivity[];
  t: Translate;
  date: Intl.DateTimeFormat;
}) {
  const DATE = date;
  if (activities.length === 0) {
    return <p className="text-sm text-ink-3">{t("leads.detail.activity.empty")}</p>;
  }
  return (
    <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[0.9375rem] before:top-2 before:w-px before:bg-line">
      {activities.map((a) => (
        <li key={a.id} className="relative flex gap-3">
          <span className="relative z-[1] inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-ink-2 ring-1 ring-inset ring-line-strong">
            <Icon name={ACTIVITY_ICON[a.kind]} size={15} />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium text-ink">{activityTitle(a, t)}</span>
              <time dateTime={a.createdAt} className="text-xs tabular-nums text-ink-3">
                {DATE.format(new Date(a.createdAt))}
              </time>
            </p>
            <p className="text-xs text-ink-3">
              {t("leads.detail.activity.by", { name: a.actor.displayName })}
              {a.kind === "CONTACT" && a.contactedAt
                ? t("leads.detail.activity.tookPlace", {
                    date: DATE.format(new Date(a.contactedAt)),
                  })
                : ""}
            </p>
            {a.body ? (
              <p className="mt-1.5 whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
                {a.body}
              </p>
            ) : a.redactedAt ? (
              <p className="mt-1.5 text-xs italic text-ink-3">
                {t("leads.detail.activity.redacted")}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Notification = NonNullable<LeadContactMessage["notification"]>;

/** DP-221: what happened to the staff e-mail of a contact-form message. */
function staffEmailText(n: Notification, t: Translate, DATE: Intl.DateTimeFormat): string {
  if (n.status === "SENT" && n.sentAt) {
    return t("leads.detail.messages.sent", {
      count: n.recipientCount,
      date: DATE.format(new Date(n.sentAt)),
    });
  }
  // A reason code without words of its own is shown as the code.
  const reason = notificationReason(n.reason, t) ?? n.reason;
  if (n.status === "PENDING") {
    return n.attempts > 0
      ? t("leads.detail.messages.retry", { attempt: n.attempts, reason: String(reason) })
      : t("leads.detail.messages.waiting");
  }
  const params = {
    status: notificationLabel(n.status, t),
    reason: reason ?? t("leads.detail.messages.unknownReason"),
  };
  return n.status === "FAILED"
    ? t("leads.detail.messages.failed", { ...params, count: n.attempts })
    : t("leads.detail.messages.notSent", params);
}

/**
 * DP-042 (ADR-016): one lead with its document requests, consent evidence and downloads.
 * DP-151: and the messages it sent with the site's contact form.
 * DP-041 (ADR-019): sales pipeline, assignment, notes and contact history; the controls appear
 * only with lead:manage on the lead's site (`canManage`), the API decides every change.
 */
export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const session = await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const { id } = await params;
  const res = await serverRead(
    `/api/v1/admin/leads/${encodeURIComponent(id)}`,
    LeadDetailResponseSchema,
  );
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader
          icon="inbox"
          title={t("leads.detail.title")}
          back={{ href: "/leads", label: t("leads.common.allLeads") }}
        />
        <EmptyState icon="shield" title={t("leads.common.noAccess")}>
          {t("leads.detail.noAccessText")}
        </EmptyState>
      </div>
    );
  }
  const { lead, requests, contactMessages, activities, canManage, assignees } = res.data;
  const pipelineHeld = LEAD_PIPELINE_HELD.includes(lead.status);
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title={lead.anonymisedAt ? t("leads.common.anonymised") : lead.fullName}
        back={{ href: "/leads", label: t("leads.common.allLeads") }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_TONE[lead.status]}>{statusLabel(lead.status, t)}</StatusPill>
            <StatusPill tone="neutral">{SITE_SHORT[lead.siteKey]}</StatusPill>
            <StatusPill tone={lead.source === "CONTACT_FORM" ? "petrol" : "neutral"}>
              {t("leads.detail.source", { source: sourceLabel(lead.source, t) })}
            </StatusPill>
            {lead.anonymisedAt ? (
              <StatusPill tone="neutral">
                {t("leads.detail.anonymisedAt", { date: DATE.format(new Date(lead.anonymisedAt)) })}
              </StatusPill>
            ) : null}
            {lead.retentionHold ? (
              <StatusPill tone="amber">
                {t("leads.detail.retentionHold", {
                  reason: t(`leads.detail.hold.${lead.retentionHold}`),
                })}
              </StatusPill>
            ) : null}
            {lead.marketingConsentAt ? (
              <StatusPill tone="success">
                {t("leads.detail.marketingConsentAt", {
                  date: DATE.format(new Date(lead.marketingConsentAt)),
                })}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">{t("leads.detail.noMarketingConsent")}</StatusPill>
            )}
            {lead.freeMailDomain ? (
              <StatusPill tone="amber">{t("leads.detail.freeMail")}</StatusPill>
            ) : null}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6 sm:space-y-8">
          <Panel
            id="workflow"
            title={t("leads.detail.workflow.title")}
            description={
              lead.assignedTo
                ? lead.assignedTo.active
                  ? t("leads.detail.workflow.assignedTo", { name: lead.assignedTo.displayName })
                  : t("leads.detail.workflow.assignedToInactive", {
                      name: lead.assignedTo.displayName,
                    })
                : t("leads.detail.workflow.notAssigned")
            }
          >
            <div className="space-y-5">
              <Pipeline status={lead.status} t={t} />
              {pipelineHeld && !lead.anonymisedAt ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30">
                  <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
                  {lead.status === "CONVERTED"
                    ? t("leads.detail.workflow.heldCustomer")
                    : t("leads.detail.workflow.heldOpportunity")}
                </p>
              ) : null}
              {canManage ? (
                <LeadWorkflowForm
                  key={lead.workflowVersion}
                  leadId={lead.id}
                  status={lead.status}
                  assignedToId={lead.assignedTo?.id ?? null}
                  version={lead.workflowVersion}
                  assignees={assignees}
                  viewerId={session.user.id}
                />
              ) : (
                <p className="text-sm text-ink-3">
                  {lead.anonymisedAt
                    ? t("leads.detail.workflow.anonymised")
                    : t("leads.detail.workflow.readOnly")}
                </p>
              )}
            </div>
          </Panel>
          <Panel
            id="activity"
            title={t("leads.detail.activity.title")}
            description={t("leads.detail.activity.description")}
          >
            <div className="space-y-6">
              {canManage ? (
                <div className="rounded-xl border border-line bg-surface-2/50 p-4">
                  <LeadActivityForm leadId={lead.id} />
                </div>
              ) : null}
              <Timeline activities={activities} t={t} date={DATE} />
            </div>
          </Panel>
        </div>
        <Panel
          id="lead"
          title={t("leads.detail.contact.title")}
          className="order-first lg:sticky lg:top-6 lg:order-none"
        >
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {[
              [t("leads.detail.contact.email"), lead.email],
              [t("leads.detail.contact.company"), lead.company],
              [t("leads.detail.contact.country"), countryName(lead.country, locale)],
              [
                t("leads.detail.contact.requests"),
                t("leads.detail.contact.requestsValue", {
                  count: lead.requestCount,
                  date: DATE.format(new Date(lead.firstRequestAt)),
                }),
              ],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-ink-3">{k}</dt>
                <dd className="mt-0.5 break-words text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel
        id="contact-messages"
        title={t("leads.detail.messages.title")}
        description={t("leads.detail.messages.description")}
        bodyClassName={contactMessages.length ? "px-0! pb-2! pt-3!" : undefined}
      >
        {contactMessages.length ? (
          <ol className="divide-y divide-line">
            {contactMessages.map((m) => (
              <li key={m.id} className="space-y-3 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <p className="font-medium text-ink">
                    {m.redactedAt
                      ? t("leads.detail.messages.cleared")
                      : (m.subject ?? t("leads.detail.messages.noSubject"))}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-sm tabular-nums text-ink-3">
                    {m.notification ? (
                      <StatusPill tone={NOTIFICATION_TONE[m.notification.status]}>
                        {notificationLabel(m.notification.status, t)}
                      </StatusPill>
                    ) : null}
                    {DATE.format(new Date(m.createdAt))}
                  </p>
                </div>
                {m.message !== null ? (
                  <p
                    key="message"
                    className="whitespace-pre-line text-sm leading-relaxed text-ink-2"
                  >
                    {m.message}
                  </p>
                ) : (
                  <p key="cleared" className="text-sm text-ink-3">
                    {m.redactedAt
                      ? t("leads.detail.messages.clearedTextAt", {
                          date: DATE.format(new Date(m.redactedAt)),
                        })
                      : t("leads.detail.messages.clearedText")}
                  </p>
                )}
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-3">{t("leads.detail.messages.submittedAs")}</dt>
                    <dd className="text-ink-2">
                      {m.redactedAt
                        ? t("leads.detail.messages.submittedCleared", {
                            country: countryName(m.country, locale),
                          })
                        : `${m.fullName}, ${m.company}, ${countryName(m.country, locale)}`}
                      {m.phone ? (
                        <span className="block font-mono text-xs text-ink-3">{m.phone}</span>
                      ) : null}
                    </dd>
                  </div>
                  {m.notification ? (
                    <div className="sm:col-span-2">
                      <dt className="text-ink-3">{t("leads.detail.messages.staffEmail")}</dt>
                      <dd className="text-ink-2">{staffEmailText(m.notification, t, DATE)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-ink-3">{t("leads.detail.messages.formLanguage")}</dt>
                    <dd className="text-ink-2">{formLanguageLabel(m.locale, t)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">{t("leads.detail.messages.noticeShown")}</dt>
                    <dd className="text-ink-2">
                      {t("leads.detail.messages.version", {
                        version: m.privacyNoticeVersion,
                        language: textLanguageLabel(m.privacyNoticeVersion, t),
                      })}{" "}
                      <span className="font-mono text-xs text-ink-3" title={m.privacyNoticeSha256}>
                        {m.privacyNoticeSha256.slice(0, 12)}…
                      </span>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-3">{t("leads.detail.messages.empty")}</p>
        )}
      </Panel>
      <Panel
        id="requests"
        title={t("leads.detail.requests.title")}
        description={t("leads.detail.requests.description")}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {requests.length === 0 ? (
          <p className="px-5 py-2 text-sm text-ink-3 sm:px-6">{t("leads.detail.requests.empty")}</p>
        ) : null}
        <ol className="divide-y divide-line">
          {requests.map((r) => (
            <li key={r.id} className="space-y-3 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="font-medium text-ink">
                  {r.document.title}
                  <span className="ml-2 text-sm font-normal text-ink-3">
                    {t("leads.detail.requests.revision", {
                      type: docTypeLabel(r.document.type, t),
                      revision: r.revision.revisionNumber,
                    })}
                  </span>
                </p>
                <p className="text-sm tabular-nums text-ink-3">
                  {DATE.format(new Date(r.createdAt))}
                </p>
              </div>
              <p className="text-sm text-ink-2">
                {r.product.name} <span className="font-mono text-ink-3">{r.product.code}</span>
                {` · ${t("leads.detail.requests.reference")} `}
                <span className="font-mono">
                  {r.reference ?? t("leads.detail.requests.cleared")}
                </span>
              </p>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-ink-3">{t("leads.detail.messages.submittedAs")}</dt>
                  <dd className="text-ink-2">
                    {r.fullName}, {r.company}, {countryName(r.country, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("leads.detail.messages.formLanguage")}</dt>
                  <dd className="text-ink-2">{formLanguageLabel(r.locale, t)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("leads.detail.requests.notice")}</dt>
                  <dd className="text-ink-2">
                    {t("leads.detail.messages.version", {
                      version: r.privacyNoticeVersion,
                      language: textLanguageLabel(r.privacyNoticeVersion, t),
                    })}{" "}
                    <span className="font-mono text-xs text-ink-3" title={r.privacyNoticeSha256}>
                      {r.privacyNoticeSha256.slice(0, 12)}…
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("leads.detail.requests.marketingConsent")}</dt>
                  <dd className="text-ink-2">
                    {r.marketingConsent
                      ? r.marketingConsentVersion
                        ? t("leads.detail.requests.consentGivenIn", {
                            version: r.marketingConsentVersion,
                            language: textLanguageLabel(r.marketingConsentVersion, t),
                          })
                        : t("leads.detail.requests.consentGiven", {
                            version: String(r.marketingConsentVersion),
                          })
                      : t("leads.detail.requests.consentNotGiven")}
                  </dd>
                </div>
              </dl>
              <div className="text-sm text-ink-2">
                {r.grant ? (
                  <p>
                    {t("leads.detail.requests.grant", {
                      count: r.grant.downloadCount,
                      max: r.grant.maxDownloads,
                      date: DATE.format(new Date(r.grant.expiresAt)),
                    })}
                  </p>
                ) : null}
                {r.downloads.length ? (
                  <ul className="mt-1 space-y-0.5 text-ink-3">
                    {r.downloads.map((d) => (
                      <li key={d.deliveredAt} className="tabular-nums">
                        {`${DATE.format(new Date(d.deliveredAt))} · ${size(d.byteSize, locale)} · ${t(
                          "leads.detail.requests.stampedCopy",
                        )}`}{" "}
                        {d.sha256 ? (
                          <span key="hash" className="font-mono text-xs" title={d.sha256}>
                            {d.sha256.slice(0, 12)}…
                          </span>
                        ) : (
                          <span key="cleared" className="text-xs">
                            {t("leads.detail.requests.hashCleared")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-3">{t("leads.detail.requests.notDownloaded")}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
