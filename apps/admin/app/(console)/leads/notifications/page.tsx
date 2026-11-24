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
import { ADMIN_TIME_ZONE } from "../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import type { Translate } from "../../../../lib/i18n/types";
import { notificationLabel, NOTIFICATION_TONE } from "../../../../lib/leads-view";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("leads.notifications.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

/** What a test environment does with the e-mail; nothing to say when it really sends. */
function transportNote(transport: MailTransport, t: Translate): string | null {
  return transport === "smtp" ? null : t(`leads.notifications.transport.${transport}`);
}

/**
 * DP-221 (ADR-026 D3): who is e-mailed when a contact-form message arrives, per site. Lead
 * managers (lead:manage) of a site change its settings; everyone else gets the API's 403.
 */
export default async function LeadNotificationsPage() {
  await requireStaffSession();
  const t = await getTranslator();
  const DATE = dateTimeFormat(await getAdminLocale(), DATE_OPTIONS);
  const res = await serverRead(
    "/api/v1/admin/lead-notifications",
    LeadNotificationSettingsResponseSchema,
  );
  const header = (
    <PageHeader
      icon="bell"
      title={t("leads.notifications.title")}
      back={{ href: "/leads", label: t("leads.common.allLeads") }}
      description={t("leads.notifications.description")}
    />
  );
  if (!res.ok) {
    return (
      <div className="space-y-8">
        {header}
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 403 ? (
            <EmptyState icon="shield" title={t("leads.notifications.forbiddenTitle")}>
              {t("leads.notifications.forbiddenText")}
            </EmptyState>
          ) : (
            <ErrorState title={t("leads.notifications.loadError")}>
              {t("leads.common.tryAgainLater")}
            </ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { transport, sites } = res.data;
  const note = transportNote(transport, t);
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
              ? s.updatedBy
                ? t("leads.notifications.lastChangedBy", {
                    date: DATE.format(new Date(s.updatedAt)),
                    name: s.updatedBy.displayName,
                  })
                : t("leads.notifications.lastChanged", { date: DATE.format(new Date(s.updatedAt)) })
              : t("leads.notifications.notSetUp")
          }
        >
          <div className="space-y-6">
            <NotificationSettingsForm settings={s} />
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink">
                {t("leads.notifications.last30")}
              </h3>
              <ul
                className="flex flex-wrap gap-2"
                aria-label={t("leads.notifications.last30Label")}
              >
                {LEAD_NOTIFICATION_STATUSES.map((st) => (
                  <li key={st}>
                    <StatusPill tone={NOTIFICATION_TONE[st]}>
                      {`${notificationLabel(st, t)}: ${s.recent[st] ?? 0}`}
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
