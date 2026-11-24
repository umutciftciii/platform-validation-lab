import type { StaffSessionResponse } from "@dream/contracts";
import { formatClock, relativeTime } from "../../lib/format";
import { ADMIN_TIME_ZONE, type AdminLocale } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { Icon } from "../icons";
import { Panel, StatusPill } from "../ui";

/** Real data: the current staff session as the API reports it. Not sample data. */
export function SessionCard({
  session,
  now,
  t,
  locale,
}: {
  session: StaffSessionResponse;
  now: Date;
  t: Translate;
  locale: AdminLocale;
}) {
  const idle = new Date(session.idleExpiresAt);
  const absolute = new Date(session.absoluteExpiresAt);
  const stepUp = session.stepUpValidUntil ? new Date(session.stepUpValidUntil) : null;
  const stepUpFresh = stepUp !== null && stepUp.getTime() > now.getTime();

  return (
    <Panel id="session" title={t("dashboard.session.title")} bodyClassName="pt-1">
      <dl className="divide-y divide-line text-sm">
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="flex items-center gap-2 text-ink-2">
            <Icon name="shield" size={16} className="text-ink-3" />
            {t("dashboard.session.secondFactor")}
          </dt>
          <dd>
            {session.mfaVerifiedAt ? (
              <StatusPill tone="success">{t("dashboard.session.authenticator")}</StatusPill>
            ) : (
              <StatusPill tone="amber">{t("dashboard.session.recoveryCode")}</StatusPill>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-2">{t("dashboard.session.idle")}</dt>
          <dd className="tabular text-ink">
            <time dateTime={idle.toISOString()}>{relativeTime(idle, now, locale)}</time>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-2">{t("dashboard.session.endsAt")}</dt>
          <dd className="tabular text-ink">
            <time dateTime={absolute.toISOString()}>
              {formatClock(absolute, ADMIN_TIME_ZONE, locale)}
            </time>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-2">{t("dashboard.session.sensitive")}</dt>
          <dd className="text-right text-ink">
            {stepUpFresh ? (
              <span className="tabular">
                {t("dashboard.session.confirmedUntil", {
                  time: formatClock(stepUp, ADMIN_TIME_ZONE, locale),
                })}
              </span>
            ) : (
              <span className="text-ink-3">{t("dashboard.session.askForCode")}</span>
            )}
          </dd>
        </div>
      </dl>
      {session.mfaVerifiedAt ? null : (
        <p className="mt-3 rounded-lg bg-amber-soft px-3 py-2.5 text-xs text-amber-ink">
          {t("dashboard.session.recoveryNote")}
        </p>
      )}
    </Panel>
  );
}
