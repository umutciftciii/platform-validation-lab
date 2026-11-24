import type { DemoDataset, SiteState, SiteStatus } from "../../lib/demo-data";
import { relativeTime } from "../../lib/format";
import type { AdminLocale } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { Panel, StatusPill, type PillTone } from "../ui";

/** Pill tone per state; the label is dashboard.sites.state.<state>. */
const STATE_TONE: Record<SiteState, PillTone> = {
  live: "success",
  maintenance: "amber",
  preparing: "neutral",
};

export function SiteStatusPanel({
  data,
  now,
  t,
  locale,
}: {
  data: DemoDataset<SiteStatus>;
  now: Date;
  t: Translate;
  locale: AdminLocale;
}) {
  return (
    <Panel id="sites" title={t("dashboard.sites.title")} demo={data.demo} bodyClassName="pt-1">
      <ul className="divide-y divide-line">
        {data.items.map((site) => {
          return (
            <li key={site.key} className="py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-ink">{site.name}</p>
                <StatusPill tone={STATE_TONE[site.state]}>
                  {t(`dashboard.sites.state.${site.state}`)}
                </StatusPill>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                <span className="tabular">{site.pages}</span> {t("dashboard.sites.pages")}{" "}
                <span className="tabular">{site.drafts}</span> {t("dashboard.sites.drafts")}{" "}
                {site.lastPublishedMinutesAgo === null
                  ? t("dashboard.sites.notPublished")
                  : t("dashboard.sites.published", {
                      time: relativeTime(
                        new Date(now.getTime() - site.lastPublishedMinutesAgo * 60_000),
                        now,
                        locale,
                      ),
                    })}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
