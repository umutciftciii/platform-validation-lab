import type { ActivityEvent, ActivityKind, DemoDataset } from "../../lib/demo-data";
import { relativeTime } from "../../lib/format";
import { Icon, type IconKey } from "../icons";
import { cx, EmptyState, Panel } from "../ui";

const KIND: Record<ActivityKind, { icon: IconKey; className: string }> = {
  publish: { icon: "publish", className: "bg-petrol-soft text-petrol-strong ring-petrol/25" },
  edit: { icon: "edit", className: "bg-surface-2 text-ink-2 ring-line-strong" },
  access: { icon: "key", className: "bg-surface-2 text-ink-2 ring-line-strong" },
  security: { icon: "shield", className: "bg-amber-soft text-amber-ink ring-amber/30" },
};

export function ActivityFeed({ data, now }: { data: DemoDataset<ActivityEvent>; now: Date }) {
  return (
    <Panel
      id="activity"
      title="Recent activity"
      description="Changes and access events across both sites"
      demo={data.demo}
      bodyClassName="pt-2"
    >
      {data.items.length === 0 ? (
        <EmptyState title="No activity yet">
          Publications, edits and access changes will appear here as they happen.
        </EmptyState>
      ) : (
        <ol className="relative">
          {data.items.map((ev, i) => {
            const kind = KIND[ev.kind];
            const at = new Date(now.getTime() - ev.minutesAgo * 60_000);
            return (
              <li key={ev.id} className="relative flex gap-3.5 py-3">
                {i < data.items.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-[15px] top-[46px] bottom-[-6px] w-px bg-line"
                  />
                ) : null}
                <span
                  className={cx(
                    "relative inline-flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                    kind.className,
                  )}
                >
                  <Icon name={kind.icon} size={15} />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-sm text-ink-2">
                    <span className="font-medium text-ink">{ev.actor}</span> {ev.text}{" "}
                    <span className="font-medium text-ink">{ev.target}</span>
                  </p>
                  <time
                    dateTime={at.toISOString()}
                    className="tabular mt-0.5 block text-xs text-ink-3"
                  >
                    {relativeTime(at, now)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
