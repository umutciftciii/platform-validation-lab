import type { DemoDataset, SiteState, SiteStatus } from "../../lib/demo-data";
import { relativeTime } from "../../lib/format";
import { Panel, StatusPill, type PillTone } from "../ui";

const STATE: Record<SiteState, { tone: PillTone; label: string }> = {
  live: { tone: "success", label: "Live" },
  maintenance: { tone: "amber", label: "Maintenance" },
  preparing: { tone: "neutral", label: "In preparation" },
};

export function SiteStatusPanel({ data, now }: { data: DemoDataset<SiteStatus>; now: Date }) {
  return (
    <Panel id="sites" title="Sites" demo={data.demo} bodyClassName="pt-1">
      <ul className="divide-y divide-line">
        {data.items.map((site) => {
          const state = STATE[site.state];
          return (
            <li key={site.key} className="py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-ink">{site.name}</p>
                <StatusPill tone={state.tone}>{state.label}</StatusPill>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                <span className="tabular">{site.pages}</span> pages,{" "}
                <span className="tabular">{site.drafts}</span> drafts,{" "}
                {site.lastPublishedMinutesAgo === null
                  ? "not published yet"
                  : `published ${relativeTime(
                      new Date(now.getTime() - site.lastPublishedMinutesAgo * 60_000),
                      now,
                    )}`}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
