import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  LEAD_PIPELINE_HELD,
  LeadDetailResponseSchema,
  type LeadActivity,
  type LeadStatus,
} from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../components/catalog/parts";
import { Icon, type IconKey } from "../../../../components/icons";
import { LeadActivityForm, LeadWorkflowForm } from "../../../../components/leads/lead-workflow";
import { cx, EmptyState, Panel, StatusPill } from "../../../../components/ui";
import {
  CHANNEL_LABEL,
  countryName,
  DOC_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../../../lib/leads-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Lead" };

/** DP-096: why a lead is kept outside the 24-month retention rule. */
const HOLD_LABEL = {
  CUSTOMER: "customer",
  OPEN_OPPORTUNITY: "open opportunity",
  LEGAL_HOLD: "legal hold",
} as const;

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The main path of the pipeline; UNQUALIFIED is a side exit (ADR-019 D2). */
const PATH: readonly LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"];

function Pipeline({ status }: { status: LeadStatus }) {
  const at = PATH.indexOf(status);
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Sales pipeline">
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
              {STATUS_LABEL[s]}
            </li>
          );
        })}
      </ol>
      {status === "UNQUALIFIED" ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <StatusPill tone="neutral">Unqualified</StatusPill>
          Off the pipeline; can be reopened as Contacted or Qualified.
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

function activityTitle(a: LeadActivity): string {
  switch (a.kind) {
    case "NOTE":
      return "Note";
    case "CONTACT":
      return `Contact · ${a.contactChannel ? CHANNEL_LABEL[a.contactChannel] : "other"}`;
    case "STATUS_CHANGED":
      return `Status ${a.fromStatus ? STATUS_LABEL[a.fromStatus] : "?"} → ${
        a.toStatus ? STATUS_LABEL[a.toStatus] : "?"
      }`;
    case "ASSIGNMENT_CHANGED":
      return a.toAssignee
        ? `Assigned to ${a.toAssignee.displayName}`
        : `Unassigned${a.fromAssignee ? ` (was ${a.fromAssignee.displayName})` : ""}`;
  }
}

function Timeline({ activities }: { activities: readonly LeadActivity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-ink-3">No sales activity yet.</p>;
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
              <span className="font-medium text-ink">{activityTitle(a)}</span>
              <time dateTime={a.createdAt} className="text-xs tabular-nums text-ink-3">
                {DATE.format(new Date(a.createdAt))}
              </time>
            </p>
            <p className="text-xs text-ink-3">
              by {a.actor.displayName}
              {a.kind === "CONTACT" && a.contactedAt
                ? ` · took place ${DATE.format(new Date(a.contactedAt))}`
                : ""}
            </p>
            {a.body ? (
              <p className="mt-1.5 whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
                {a.body}
              </p>
            ) : a.redactedAt ? (
              <p className="mt-1.5 text-xs italic text-ink-3">
                Text cleared when the lead was anonymised.
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * DP-042 (ADR-016): one lead with its document requests, consent evidence and downloads.
 * DP-041 (ADR-019): sales pipeline, assignment, notes and contact history; the controls appear
 * only with lead:manage on the lead's site (`canManage`), the API decides every change.
 */
export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const session = await requireStaffSession();
  const { id } = await params;
  const res = await serverRead(
    `/api/v1/admin/leads/${encodeURIComponent(id)}`,
    LeadDetailResponseSchema,
  );
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="inbox" title="Lead" back={{ href: "/leads", label: "All leads" }} />
        <EmptyState icon="shield" title="No access to leads">
          Leads are customer data and need a customer-data role.
        </EmptyState>
      </div>
    );
  }
  const { lead, requests, activities, canManage, assignees } = res.data;
  const pipelineHeld = LEAD_PIPELINE_HELD.includes(lead.status);
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="inbox"
        title={lead.anonymisedAt ? "Anonymised lead" : lead.fullName}
        back={{ href: "/leads", label: "All leads" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_TONE[lead.status]}>{STATUS_LABEL[lead.status]}</StatusPill>
            <StatusPill tone="neutral">{SITE_SHORT[lead.siteKey]}</StatusPill>
            {lead.anonymisedAt ? (
              <StatusPill tone="neutral">
                Anonymised {DATE.format(new Date(lead.anonymisedAt))}
              </StatusPill>
            ) : null}
            {lead.retentionHold ? (
              <StatusPill tone="amber">Retention hold: {HOLD_LABEL[lead.retentionHold]}</StatusPill>
            ) : null}
            {lead.marketingConsentAt ? (
              <StatusPill tone="success">
                Marketing consent {DATE.format(new Date(lead.marketingConsentAt))}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">No marketing consent</StatusPill>
            )}
            {lead.freeMailDomain ? <StatusPill tone="amber">Free-mail address</StatusPill> : null}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6 sm:space-y-8">
          <Panel
            id="workflow"
            title="Sales workflow"
            description={
              lead.assignedTo
                ? `Assigned to ${lead.assignedTo.displayName}${
                    lead.assignedTo.active ? "" : " (no longer has access to this site's leads)"
                  }`
                : "Not assigned yet."
            }
          >
            <div className="space-y-5">
              <Pipeline status={lead.status} />
              {pipelineHeld && !lead.anonymisedAt ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30">
                  <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
                  {lead.status === "CONVERTED" ? "A customer" : "An open opportunity"}: kept out of
                  the automatic 24-month anonymisation while in this status.
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
                    ? "This lead is anonymised; its status and history are kept as a record and cannot change."
                    : "You can read this lead. Changing its status or assignment needs a sales role for this site."}
                </p>
              )}
            </div>
          </Panel>
          <Panel
            id="activity"
            title="Activity"
            description="Notes, contacts, status and assignment changes: who did what, and when."
          >
            <div className="space-y-6">
              {canManage ? (
                <div className="rounded-xl border border-line bg-surface-2/50 p-4">
                  <LeadActivityForm leadId={lead.id} />
                </div>
              ) : null}
              <Timeline activities={activities} />
            </div>
          </Panel>
        </div>
        <Panel id="lead" title="Contact" className="order-first lg:sticky lg:top-6 lg:order-none">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {[
              ["E-mail", lead.email],
              ["Company", lead.company],
              ["Country", countryName(lead.country)],
              [
                "Requests",
                `${lead.requestCount} · first ${DATE.format(new Date(lead.firstRequestAt))}`,
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
        id="requests"
        title="Downloaded documents and request history"
        description="Each request keeps the details and consent as submitted (evidence, never edited)."
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <ol className="divide-y divide-line">
          {requests.map((r) => (
            <li key={r.id} className="space-y-3 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="font-medium text-ink">
                  {r.document.title}
                  <span className="ml-2 text-sm font-normal text-ink-3">
                    {DOC_TYPE_LABEL[r.document.type]} · revision {r.revision.revisionNumber}
                  </span>
                </p>
                <p className="text-sm tabular-nums text-ink-3">
                  {DATE.format(new Date(r.createdAt))}
                </p>
              </div>
              <p className="text-sm text-ink-2">
                {r.product.name} <span className="font-mono text-ink-3">{r.product.code}</span> ·
                reference <span className="font-mono">{r.reference ?? "cleared"}</span>
              </p>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ink-3">Submitted as</dt>
                  <dd className="text-ink-2">
                    {r.fullName}, {r.company}, {countryName(r.country)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Privacy notice</dt>
                  <dd className="text-ink-2">
                    version {r.privacyNoticeVersion}{" "}
                    <span className="font-mono text-xs text-ink-3" title={r.privacyNoticeSha256}>
                      {r.privacyNoticeSha256.slice(0, 12)}…
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Marketing consent</dt>
                  <dd className="text-ink-2">
                    {r.marketingConsent
                      ? `given (version ${r.marketingConsentVersion})`
                      : "not given"}
                  </dd>
                </div>
              </dl>
              <div className="text-sm text-ink-2">
                {r.grant ? (
                  <p>
                    Downloads {r.grant.downloadCount} of {r.grant.maxDownloads} · link valid until{" "}
                    {DATE.format(new Date(r.grant.expiresAt))}
                  </p>
                ) : null}
                {r.downloads.length ? (
                  <ul className="mt-1 space-y-0.5 text-ink-3">
                    {r.downloads.map((d) => (
                      <li key={d.deliveredAt} className="tabular-nums">
                        {DATE.format(new Date(d.deliveredAt))} · {size(d.byteSize)} · stamped copy{" "}
                        {d.sha256 ? (
                          <span className="font-mono text-xs" title={d.sha256}>
                            {d.sha256.slice(0, 12)}…
                          </span>
                        ) : (
                          <span className="text-xs">(hash cleared)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-3">Not downloaded.</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
