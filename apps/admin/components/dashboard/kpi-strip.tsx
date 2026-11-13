import type { DemoDataset, Kpi } from "../../lib/demo-data";
import { formatDelta, formatNumber } from "../../lib/format";
import { cx, DemoBadge, Sparkline } from "../ui";

function deltaTone(kpi: Kpi): string {
  if (kpi.deltaPercent === 0) return "bg-surface-2 text-ink-2 ring-line-strong";
  const good = kpi.deltaPercent > 0 === kpi.higherIsBetter;
  return good
    ? "bg-success-soft text-success ring-success/25"
    : "bg-danger-soft text-danger ring-danger/25";
}

function deltaArrow(kpi: Kpi): string {
  if (kpi.deltaPercent > 0) return "M5 1.5v7M2 4.5l3-3 3 3";
  if (kpi.deltaPercent < 0) return "M5 8.5v-7M2 5.5l3 3 3-3";
  return "M1.5 5h7";
}

/**
 * The instrument strip: one surface, four readings separated by hairlines, read left to right
 * like a gauge panel rather than four separate cards. Each reading ends in its 12-week trace over a
 * tick scale, one tick per week.
 */
export function KpiStrip({ data }: { data: DemoDataset<Kpi> }) {
  return (
    <section
      aria-labelledby="kpi-title"
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
        <h2 id="kpi-title" className="flex items-baseline gap-2 text-sm font-semibold text-ink">
          Last 30 days
          <span className="hidden text-xs font-normal text-ink-3 min-[420px]:inline">
            Trend over 12 weeks
          </span>
        </h2>
        {data.demo ? <DemoBadge /> : null}
      </div>
      <dl className="grid grid-cols-2 xl:grid-cols-4">
        {data.items.map((kpi, i) => {
          const attention = kpi.tone === "attention";
          return (
            <div
              key={kpi.id}
              className={cx(
                "relative flex min-w-0 flex-col px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5",
                i % 2 === 1 && "border-l border-line",
                i >= 2 && "border-t border-line xl:border-t-0",
                i === 2 && "xl:border-l",
              )}
            >
              {attention ? (
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-amber" />
              ) : null}
              <dt className="flex items-start justify-between gap-2">
                <span
                  className={cx(
                    "type-eyebrow min-w-0 leading-snug",
                    attention ? "text-amber-ink" : "text-ink-3",
                  )}
                >
                  {kpi.label}
                </span>
              </dt>
              <dd className="mt-2 flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="type-display tabular text-[2rem] font-semibold text-ink sm:text-[2.5rem]">
                    {formatNumber(kpi.value)}
                  </span>
                  <span
                    className={cx(
                      "tabular inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                      deltaTone(kpi),
                    )}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d={deltaArrow(kpi)} />
                    </svg>
                    {formatDelta(kpi.deltaPercent)}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 text-xs text-ink-3">{kpi.hint}</span>
                <span className="mt-auto block pt-4">
                  <Sparkline
                    values={kpi.trend}
                    tone={attention ? "amber" : "petrol"}
                    width={240}
                    height={36}
                    fluid
                    label={`${kpi.label}, 12-week trend`}
                    className="block"
                  />
                  <span
                    aria-hidden="true"
                    className="mt-1 flex h-1.5 items-start justify-between border-t border-line-strong"
                  >
                    {kpi.trend.map((_, t) => (
                      <span
                        key={t}
                        className={cx(
                          "w-px bg-line-strong",
                          t === 0 || t === kpi.trend.length - 1 ? "h-1.5" : "h-1",
                        )}
                      />
                    ))}
                  </span>
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
