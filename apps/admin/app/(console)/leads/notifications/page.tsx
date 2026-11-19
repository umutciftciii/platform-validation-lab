import type { Metadata } from "next";
import {
  LEAD_NOTIFICATION_STATUSES,
  LeadNotificationSettingsResponseSchema,
  type MailTransport,
} from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { Icon } from "../../../../components/icons";
import { NotificationSettingsForm } from "../../../../components/leads/notification-settings";
import { EmptyState, ErrorState, Panel, StatusPill } from "../../../../components/ui";
import { NOTIFICATION_LABEL, NOTIFICATION_TONE } from "../../../../lib/leads-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Lead notifications" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

const TRANSPORT_NOTE: Readonly<Record<MailTransport, string | null>> = {
  smtp: null,
  capture:
    "This environment does not send real e-mail: notifications are recorded and kept inside the platform for testing.",
  off: "E-mail delivery is off in this environment: notifications are recorded as not sent.",
};

/**
 * DP-221 (ADR-026 D3): who is e-mailed when a contact-form message arrives, per site. Lead
 * managers (lead:manage) of a site change its settings; everyone else gets the API's 403.
 */
export default async function LeadNotificationsPage() {
  await requireStaffSession();
  const res = await serverRead(
    "/api/v1/admin/lead-notifications",
    LeadNotificationSettingsResponseSchema,
  );
  const header = (
    <PageHeader
      icon="bell"
      title="Lead notifications"
      back={{ href: "/leads", label: "All leads" }}
      description="E-mail the sales team when someone writes through a site's contact form. Every message is stored as a lead first; the e-mail only points to it."
    />
  );
  if (!res.ok) {
    return (
      <div className="space-y-8">
        {header}
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 403 ? (
            <EmptyState icon="shield" title="Only lead managers change notifications">
              Staff who work a site&apos;s leads (Sales / CRM user there) and platform
              administrators choose who is e-mailed about new contact-form messages.
            </EmptyState>
          ) : (
            <ErrorState title="The settings could not be loaded">Try again in a moment.</ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { transport, sites } = res.data;
  const note = TRANSPORT_NOTE[transport];
  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      {note ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-soft px-4 py-3 text-sm text-amber-ink ring-1 ring-inset ring-amber/30">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {note}
        </p>
      ) : null}
      {sites.map((s) => (
        <Panel
          key={s.site.id}
          id={`site-${s.site.key.toLowerCase()}`}
          title={s.site.name}
          description={
            s.updatedAt
              ? `Last changed ${DATE.format(new Date(s.updatedAt))}${
                  s.updatedBy ? ` by ${s.updatedBy.displayName}` : ""
                }.`
              : "Not set up yet: no e-mail is sent."
          }
        >
          <div className="space-y-6">
            <NotificationSettingsForm settings={s} />
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink">Last 30 days</h3>
              <ul className="flex flex-wrap gap-2" aria-label="Notifications of the last 30 days">
                {LEAD_NOTIFICATION_STATUSES.map((st) => (
                  <li key={st}>
                    <StatusPill tone={NOTIFICATION_TONE[st]}>
                      {NOTIFICATION_LABEL[st]}: {s.recent[st] ?? 0}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
