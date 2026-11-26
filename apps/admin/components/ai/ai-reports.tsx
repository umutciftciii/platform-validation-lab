/**
 * DP-293 (ADR-030 D6, D7): the server-rendered parts of the AI Center's budget and reporting
 * screens — alerts, budget cards, the usage report (figures, chart, breakdowns), the operation list
 * and detail, the price list, reconciliation and the audit trail. No state and no request of their
 * own: the page reads the API and hands the data here; changes are the client buttons of
 * ai-budget-actions.tsx.
 *
 * Amounts stay apart on every screen: actual (local calculation), assumed (unknown outcome,
 * counted as spent), reserved (held, not spent), estimated (upper bound before the call) and the
 * provider's own figure. Rounding happens only here, for display (lib/ai-view.ts); every amount
 * carries its exact micro-USD value in its title. Periods are UTC; times are shown in UTC and in
 * the company's time zone.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AI_OUTCOMES,
  AI_PROVIDERS,
  AI_TASK_TYPES,
  type AiAlert,
  type AiAuditEvent,
  type AiBudget,
  type AiModelSummary,
  type AiOperation,
  type AiOperationDetail,
  type AiOperationHistory,
  type AiOverviewResponse,
  type AiPermissions,
  type AiPriceListResponse,
  type AiReconciliationRow,
  type AiSettingsDto,
  type AiUsageReport,
  type AiUsageTotals,
  AI_OUTCOME_OF_STATUS,
} from "@dream/contracts";
import {
  OUTCOME_TONE,
  PROVIDER_NAMES,
  budgetBar,
  formatPermille,
  formatUsd,
  periodBounds,
  permilleOf,
  scaleSeries,
  type UsageParams,
} from "../../lib/ai-view";
import { ADMIN_TIME_ZONE, INTL_LOCALE, type AdminLocale } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { FIELD } from "../catalog/parts";
import { buttonStyles, cx, EmptyState, StatusPill, type PillTone } from "../ui";
import {
  AddPriceButton,
  EditBudgetButton,
  NewBudgetButton,
  RecordFigureButton,
  SettingsButton,
} from "./ai-budget-actions";

type Site = AiOverviewResponse["sites"][number];
interface Ctx {
  t: Translate;
  locale: AdminLocale;
}

// --- formatting ----------------------------------------------------------------------------------

function Usd({
  micros,
  locale,
  strong,
}: {
  micros: string;
  locale: AdminLocale;
  strong?: boolean;
}) {
  return (
    <span title={`${micros} µ$`} className={cx("tabular-nums", strong && "font-semibold text-ink")}>
      {formatUsd(micros, locale)}
    </span>
  );
}

const num = (n: number, locale: AdminLocale) =>
  new Intl.NumberFormat(INTL_LOCALE[locale]).format(n);

function when(iso: string, locale: AdminLocale, zone: string) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(iso));
}

/** "26 Nov 2026, 14:05 UTC · 15:05 Amsterdam" */
function Time({ iso, c }: { iso: string; c: Ctx }) {
  return (
    <time dateTime={iso} className="tabular-nums">
      {c.t("ai.time.utc", { time: when(iso, c.locale, "UTC") })}
      <span className="text-ink-3">
        {" · "}
        {c.t("ai.time.local", { time: when(iso, c.locale, ADMIN_TIME_ZONE) })}
      </span>
    </time>
  );
}

const siteName = (sites: readonly Site[], id: string | null, t: Translate) =>
  id === null ? t("ai.usage.platform") : (sites.find((s) => s.id === id)?.name ?? id.slice(0, 8));

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-1 text-lg text-ink">{children}</dd>
      {hint ? <dd className="mt-0.5 text-xs text-ink-3">{hint}</dd> : null}
    </div>
  );
}

function Table({
  caption,
  head,
  children,
}: {
  caption: string;
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="w-0 min-w-full overflow-x-auto rounded-2xl border border-line">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-3">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

const td = "whitespace-nowrap px-3 py-2 align-top";

// --- alerts --------------------------------------------------------------------------------------

const SEVERITY_TONE: Record<AiAlert["severity"], PillTone> = {
  critical: "danger",
  warning: "amber",
  info: "neutral",
};

export function AlertsList({
  alerts,
  sites,
  models,
  c,
}: {
  alerts: readonly AiAlert[];
  sites: readonly Site[];
  models: readonly Pick<AiModelSummary, "id" | "displayName">[];
  c: Ctx;
}) {
  const { t, locale } = c;
  if (alerts.length === 0) return <p className="text-sm text-ink-2">{t("ai.alerts.none")}</p>;
  const model = (id: string | null) => models.find((m) => m.id === id)?.displayName ?? id ?? "";
  return (
    <ul className="space-y-2" aria-label={t("ai.alerts.title")}>
      {alerts.map((a, i) => (
        <li
          key={`${a.code}-${a.budgetId ?? a.modelId ?? a.provider ?? a.period ?? ""}-${a.day ?? ""}-${i}`}
          className="flex flex-wrap items-start gap-2 rounded-xl border border-line px-3 py-2 text-sm"
        >
          <StatusPill tone={SEVERITY_TONE[a.severity]}>
            {t(`ai.alerts.severity.${a.severity}`)}
          </StatusPill>
          <span className="min-w-0 flex-1 text-ink">
            {t(`ai.alerts.codes.${a.code}`, {
              scope:
                a.budgetId || a.period
                  ? `${a.siteId ? siteName(sites, a.siteId, t) : t("ai.usage.platform")} · ${a.period ? t(`ai.budgets.period.${a.period}`) : ""}`
                  : "",
              provider: a.provider ? PROVIDER_NAMES[a.provider] : "",
              model: model(a.modelId),
              count: a.count ?? 0,
              day: a.day ?? "",
              amount: a.amountMicros ? formatUsd(a.amountMicros, locale) : "",
              limit: a.limitMicros ? formatUsd(a.limitMicros, locale) : "",
              share: a.permille !== null ? formatPermille(a.permille, locale) : "",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

// --- budgets -------------------------------------------------------------------------------------

export function budgetLabel(
  b: Pick<AiBudget, "scope" | "siteId" | "period">,
  sites: readonly Site[],
  t: Translate,
) {
  const scope =
    b.scope === "PLATFORM" ? t("ai.budgets.scope.PLATFORM") : siteName(sites, b.siteId, t);
  return `${scope} · ${t(`ai.budgets.period.${b.period}`)}`;
}

export function BudgetCard({
  budget: b,
  sites,
  can,
  c,
}: {
  budget: AiBudget;
  sites: readonly Site[];
  can: AiPermissions;
  c: Ctx;
}) {
  const { t, locale } = c;
  const cur = b.current;
  const bar = budgetBar({ ...cur, limitMicros: b.effectiveLimitMicros });
  const { start, end } = periodBounds(cur.periodStart, b.period);
  const label = budgetLabel(b, sites, t);
  const capped = b.effectiveLimitMicros !== b.limitMicros;
  const used = (BigInt(cur.committedMicros) + BigInt(cur.assumedMicros)).toString();
  const state = !b.active
    ? { tone: "neutral" as const, text: t("ai.budgets.inactive") }
    : BigInt(used) >= BigInt(b.effectiveLimitMicros)
      ? { tone: "danger" as const, text: t("ai.budgets.exceeded") }
      : cur.warning
        ? { tone: "amber" as const, text: t("ai.budgets.warning") }
        : { tone: "success" as const, text: t("ai.budgets.ok") };
  return (
    <article
      aria-label={label}
      className={cx("rounded-2xl border border-line bg-surface p-4", !b.active && "opacity-75")}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{label}</h3>
          <p className="text-xs text-ink-3">
            {t("ai.budgets.periodRange", {
              from: when(start.toISOString(), locale, "UTC"),
              to: when(end.toISOString(), locale, "UTC"),
            })}
          </p>
          <p className="text-xs text-ink-3">
            {t("ai.budgets.periodLocal", {
              from: when(start.toISOString(), locale, ADMIN_TIME_ZONE),
              to: when(end.toISOString(), locale, ADMIN_TIME_ZONE),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={state.tone}>{state.text}</StatusPill>
          {can.budgetManage ? <EditBudgetButton budget={b} label={label} /> : null}
        </div>
      </header>
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={t("ai.budgets.barLabel", {
          share: formatPermille(bar.usedPermille, locale),
          limit: formatUsd(b.effectiveLimitMicros, locale),
        })}
      >
        <span className="h-full bg-petrol" style={{ width: `${bar.committed * 100}%` }} />
        <span className="h-full bg-amber" style={{ width: `${bar.assumed * 100}%` }} />
        <span
          className="h-full bg-petrol/30 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,.45)_4px_8px)]"
          style={{ width: `${bar.reserved * 100}%` }}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-3">{t("ai.amounts.actual")}</dt>
          <dd>
            <Usd micros={cur.committedMicros} locale={locale} strong />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("ai.amounts.assumed")}</dt>
          <dd>
            <Usd micros={cur.assumedMicros} locale={locale} strong />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("ai.amounts.reserved")}</dt>
          <dd>
            <Usd micros={cur.reservedMicros} locale={locale} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("ai.amounts.remaining")}</dt>
          <dd>
            <Usd micros={bar.remainingMicros} locale={locale} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("ai.budgets.limit")}</dt>
          <dd>
            <Usd micros={b.effectiveLimitMicros} locale={locale} />
            {capped ? (
              <span className="block text-xs text-ink-3">
                {t("ai.budgets.capped", { limit: formatUsd(b.limitMicros, locale) })}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("ai.budgets.usedShare")}</dt>
          <dd className="tabular-nums">
            {formatPermille(bar.usedPermille, locale)}
            <span className="block text-xs text-ink-3">
              {t("ai.budgets.warnAt", { pct: b.warnPct })}
            </span>
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function BudgetsView({
  budgets,
  localCap,
  settings,
  sites,
  can,
  c,
}: {
  budgets: readonly AiBudget[];
  localCap: { dailyMicros: string; monthlyMicros: string } | null;
  settings: AiSettingsDto | null;
  sites: readonly Site[];
  can: AiPermissions;
  c: Ctx;
}) {
  const { t, locale } = c;
  const active = budgets.filter((b) => b.active);
  const inactive = budgets.filter((b) => !b.active);
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
        <p>{t("ai.budgets.legend")}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-petrol" aria-hidden /> {t("ai.amounts.actual")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber" aria-hidden /> {t("ai.amounts.assumed")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-petrol/30" aria-hidden />{" "}
            {t("ai.amounts.reserved")}
          </li>
        </ul>
        <p className="mt-2 text-xs">{t("ai.budgets.enforcedText")}</p>
        {localCap ? (
          <p className="mt-2 text-xs">
            {t("ai.budgets.localCap", {
              daily: formatUsd(localCap.dailyMicros, locale),
              monthly: formatUsd(localCap.monthlyMicros, locale),
            })}
          </p>
        ) : null}
      </div>
      {can.budgetManage ? (
        <div className="flex flex-wrap gap-2">
          <NewBudgetButton sites={sites} />
        </div>
      ) : null}
      {active.length === 0 ? (
        <EmptyState icon="ai" title={t("ai.budgets.emptyTitle")}>
          {can.budgetManage ? t("ai.budgets.emptyManage") : t("ai.budgets.emptyRead")}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {active.map((b) => (
            <BudgetCard key={b.id} budget={b} sites={sites} can={can} c={c} />
          ))}
        </div>
      )}
      {inactive.length ? (
        <details className="rounded-2xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {t("ai.budgets.inactiveList", { count: inactive.length })}
          </summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {inactive.map((b) => (
              <BudgetCard key={b.id} budget={b} sites={sites} can={can} c={c} />
            ))}
          </div>
        </details>
      ) : null}
      {settings ? (
        <section aria-labelledby="ai-engine-title" className="rounded-2xl border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="ai-engine-title" className="font-semibold text-ink">
                {t("ai.engine.title")}
              </h3>
              <p className="text-sm text-ink-3">{t("ai.engine.description")}</p>
            </div>
            {can.budgetManage ? <SettingsButton settings={settings} /> : null}
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <Stat label={t("ai.engine.concurrency")}>{settings.maxConcurrency}</Stat>
            <Stat label={t("ai.engine.ttl")}>
              {t("ai.engine.seconds", { n: settings.reservationTtlSec })}
            </Stat>
            <Stat label={t("ai.engine.margin")}>{`${settings.safetyMarginPct} %`}</Stat>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

// --- usage ---------------------------------------------------------------------------------------

const spend = (x: AiUsageTotals) => BigInt(x.actualMicros) + BigInt(x.assumedMicros);

export function TotalsStats({ totals: x, c }: { totals: AiUsageTotals; c: Ctx }) {
  const { t, locale } = c;
  const deviation =
    BigInt(x.settledEstimateMicros) > 0n
      ? formatPermille(permilleOf(x.actualMicros, x.settledEstimateMicros), locale)
      : "—";
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label={t("ai.amounts.actual")} hint={t("ai.amounts.actualHint")}>
        <Usd micros={x.actualMicros} locale={locale} strong />
      </Stat>
      <Stat label={t("ai.amounts.assumed")} hint={t("ai.amounts.assumedHint")}>
        <Usd micros={x.assumedMicros} locale={locale} strong />
      </Stat>
      <Stat label={t("ai.amounts.reserved")} hint={t("ai.amounts.reservedHint")}>
        <Usd micros={x.reservedMicros} locale={locale} />
      </Stat>
      <Stat label={t("ai.amounts.estimated")} hint={t("ai.amounts.estimatedHint")}>
        <Usd micros={x.estimatedMicros} locale={locale} />
      </Stat>
      <Stat label={t("ai.usage.operations")}>{num(x.operations, locale)}</Stat>
      <Stat label={t("ai.usage.deviation")} hint={t("ai.usage.deviationHint")}>
        <span className="tabular-nums">{deviation}</span>
        {x.overruns ? (
          <span className="block text-xs text-danger">
            {t("ai.usage.overruns", { count: x.overruns })}
          </span>
        ) : null}
      </Stat>
      <Stat label={t("ai.usage.tokens")}>
        <span className="block text-sm tabular-nums">
          {t("ai.usage.tokensValue", {
            input: num(x.inputTokens, locale),
            output: num(x.outputTokens, locale),
          })}
        </span>
        <span className="block text-xs text-ink-3 tabular-nums">
          {t("ai.usage.tokensDetail", {
            cached: num(x.cachedReadTokens, locale),
            write: num(x.cacheWriteTokens, locale),
            reasoning: num(x.reasoningTokens, locale),
          })}
        </span>
      </Stat>
      <Stat label={t("ai.usage.outcomes")}>
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {AI_OUTCOMES.map((o) => (
            <li key={o}>
              <StatusPill tone={OUTCOME_TONE[o]}>
                {t(`ai.outcomes.${o}`)}: {num(x.outcomes[o], locale)}
              </StatusPill>
            </li>
          ))}
        </ul>
      </Stat>
    </dl>
  );
}

/** Stacked bars (actual + assumed) per UTC day or month, with the same numbers as a table. */
export function SpendChart({ report, c }: { report: AiUsageReport; c: Ctx }) {
  const { t, locale } = c;
  const series = report.series;
  const totals = series.map((s) => spend(s.totals));
  const heights = scaleSeries(totals);
  const empty = totals.every((v) => v === 0n);
  const W = 640;
  const H = 180;
  const gap = series.length > 40 ? 1 : 3;
  const bw = Math.max(2, (W - gap * (series.length - 1)) / Math.max(1, series.length));
  const label = t(`ai.usage.chartLabel.${report.granularity}`, {
    from: report.from,
    to: report.to,
  });
  return (
    <figure className="space-y-3">
      <figcaption className="text-sm font-medium text-ink">{label}</figcaption>
      {empty ? (
        <p className="text-sm text-ink-2">{t("ai.usage.chartEmpty")}</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-44 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
        >
          {series.map((s, i) => {
            const total = totals[i]!;
            const h = heights[i]! * (H - 4);
            const assumedShare =
              total > 0n ? Number((BigInt(s.totals.assumedMicros) * 10_000n) / total) / 10_000 : 0;
            const x = i * (bw + gap);
            return (
              <g key={s.bucket}>
                <title>
                  {`${s.bucket}: ${formatUsd(s.totals.actualMicros, locale)} + ${formatUsd(s.totals.assumedMicros, locale)}`}
                </title>
                <rect
                  x={x}
                  y={H - h}
                  width={bw}
                  height={h * (1 - assumedShare)}
                  fill="var(--petrol)"
                />
                <rect
                  x={x}
                  y={H - h * assumedShare}
                  width={bw}
                  height={h * assumedShare}
                  fill="var(--amber)"
                />
              </g>
            );
          })}
        </svg>
      )}
      {empty ? null : (
        <div className="flex justify-between text-xs tabular-nums text-ink-3" aria-hidden>
          <span>{series[0]?.bucket}</span>
          <span>{series.at(-1)?.bucket}</span>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-petrol-strong">
          {t("ai.usage.chartTable")}
        </summary>
        <div className="mt-2">
          <Table
            caption={label}
            head={[
              t(`ai.usage.bucket.${report.granularity}`),
              t("ai.amounts.actual"),
              t("ai.amounts.assumed"),
              t("ai.amounts.reserved"),
              t("ai.usage.operations"),
            ]}
          >
            {series.map((s) => (
              <tr key={s.bucket}>
                <td className={td}>{s.bucket}</td>
                <td className={td}>
                  <Usd micros={s.totals.actualMicros} locale={locale} />
                </td>
                <td className={td}>
                  <Usd micros={s.totals.assumedMicros} locale={locale} />
                </td>
                <td className={td}>
                  <Usd micros={s.totals.reservedMicros} locale={locale} />
                </td>
                <td className={td}>{num(s.totals.operations, locale)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </details>
    </figure>
  );
}

function BreakdownTable({
  caption,
  first,
  rows,
  c,
}: {
  caption: string;
  first: string;
  rows: { key: string; name: ReactNode; totals: AiUsageTotals }[];
  c: Ctx;
}) {
  const { t, locale } = c;
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">{caption}</h3>
      <Table
        caption={caption}
        head={[
          first,
          t("ai.amounts.actual"),
          t("ai.amounts.assumed"),
          t("ai.amounts.estimated"),
          t("ai.usage.operations"),
          t("ai.outcomes.succeeded"),
          t("ai.outcomes.failed"),
          t("ai.outcomes.cancelled"),
          t("ai.outcomes.unknown"),
          t("ai.usage.tokensShort"),
        ]}
      >
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className={cx(td, "font-medium text-ink")}>
              {r.name}
            </th>
            <td className={td}>
              <Usd micros={r.totals.actualMicros} locale={locale} />
            </td>
            <td className={td}>
              <Usd micros={r.totals.assumedMicros} locale={locale} />
            </td>
            <td className={td}>
              <Usd micros={r.totals.estimatedMicros} locale={locale} />
            </td>
            <td className={td}>{num(r.totals.operations, locale)}</td>
            <td className={td}>{num(r.totals.outcomes.succeeded, locale)}</td>
            <td className={td}>{num(r.totals.outcomes.failed, locale)}</td>
            <td className={td}>{num(r.totals.outcomes.cancelled, locale)}</td>
            <td className={td}>{num(r.totals.outcomes.unknown, locale)}</td>
            <td className={cx(td, "tabular-nums")}>
              {t("ai.usage.tokensValue", {
                input: num(r.totals.inputTokens, locale),
                output: num(r.totals.outputTokens, locale),
              })}
            </td>
          </tr>
        ))}
      </Table>
    </section>
  );
}

/** The usage tab's filter form (a plain GET form: works without JavaScript). */
export function UsageFilters({
  params,
  models,
  sites,
  tab,
  c,
  children,
}: {
  params: UsageParams;
  models: readonly AiModelSummary[];
  sites: readonly Site[];
  tab: "usage" | "operations";
  c: Ctx;
  children?: ReactNode;
}) {
  const { t } = c;
  const select = (
    name: string,
    label: string,
    value: string | null,
    options: [string, string][],
  ) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={FIELD}>
        <option value="">{t("ai.filters.all")}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      method="get"
      action="/ai"
      className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="tab" value={tab} />
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-ink">{t("ai.filters.from")}</span>
        <input type="date" name="from" defaultValue={params.from} className={FIELD} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-ink">{t("ai.filters.to")}</span>
        <input type="date" name="to" defaultValue={params.to} className={FIELD} />
      </label>
      {tab === "usage"
        ? select("granularity", t("ai.filters.granularity"), params.granularity, [
            ["day", t("ai.filters.byDay")],
            ["month", t("ai.filters.byMonth")],
          ])
        : null}
      {select(
        "provider",
        t("ai.filters.provider"),
        params.provider,
        AI_PROVIDERS.map((p) => [p, PROVIDER_NAMES[p]]),
      )}
      {select(
        "modelId",
        t("ai.filters.model"),
        params.modelId,
        models.map((m) => [m.id, `${m.displayName} · ${PROVIDER_NAMES[m.provider]}`]),
      )}
      {select(
        "task",
        t("ai.filters.task"),
        params.task,
        AI_TASK_TYPES.map((x) => [x, t(`ai.tasks.names.${x}`)]),
      )}
      {select("siteId", t("ai.filters.site"), params.siteId, [
        ["platform", t("ai.usage.platform")],
        ...sites.map((s) => [s.id, s.name] as [string, string]),
      ])}
      {select(
        "outcome",
        t("ai.filters.outcome"),
        params.outcome,
        AI_OUTCOMES.map((o) => [o, t(`ai.outcomes.${o}`)]),
      )}
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={buttonStyles.primary}>
          {t("ai.filters.apply")}
        </button>
        <Link href={`/ai?tab=${tab}`} className={buttonStyles.secondary}>
          {t("ai.filters.reset")}
        </Link>
        <p className="text-xs text-ink-3">{t("ai.filters.utc")}</p>
        {children}
      </div>
    </form>
  );
}

export function UsageView({
  report,
  sites,
  c,
}: {
  report: AiUsageReport;
  sites: readonly Site[];
  c: Ctx;
}) {
  const { t } = c;
  if (report.totals.operations === 0)
    return (
      <EmptyState icon="ai" title={t("ai.usage.emptyTitle")}>
        {t("ai.usage.emptyText")}
      </EmptyState>
    );
  return (
    <div className="space-y-6">
      <TotalsStats totals={report.totals} c={c} />
      <p className="text-xs text-ink-3">{t("ai.usage.notInvoice")}</p>
      <SpendChart report={report} c={c} />
      <BreakdownTable
        caption={t("ai.usage.byProvider")}
        first={t("ai.filters.provider")}
        rows={report.byProvider.map((r) => ({
          key: r.provider,
          name: PROVIDER_NAMES[r.provider],
          totals: r.totals,
        }))}
        c={c}
      />
      <BreakdownTable
        caption={t("ai.usage.byModel")}
        first={t("ai.filters.model")}
        rows={report.byModel.map((r) => ({
          key: r.modelId,
          name: (
            <span>
              {r.displayName || r.modelKey}
              <span className="block text-xs font-normal text-ink-3">
                {PROVIDER_NAMES[r.provider]} · <code>{r.modelKey}</code>
              </span>
            </span>
          ),
          totals: r.totals,
        }))}
        c={c}
      />
      <BreakdownTable
        caption={t("ai.usage.byTask")}
        first={t("ai.filters.task")}
        rows={report.byTask.map((r) => ({
          key: r.task,
          name: t(`ai.tasks.names.${r.task}`),
          totals: r.totals,
        }))}
        c={c}
      />
      <BreakdownTable
        caption={t("ai.usage.bySite")}
        first={t("ai.filters.site")}
        rows={report.bySite.map((r) => ({
          key: r.siteId ?? "platform",
          name: siteName(sites, r.siteId, t),
          totals: r.totals,
        }))}
        c={c}
      />
    </div>
  );
}

// --- operations ----------------------------------------------------------------------------------

export function OperationsTable({
  items,
  models,
  sites,
  detailHref,
  c,
}: {
  items: readonly AiOperation[];
  models: readonly AiModelSummary[];
  sites: readonly Site[];
  detailHref: (id: string) => string;
  c: Ctx;
}) {
  const { t, locale } = c;
  if (items.length === 0)
    return (
      <EmptyState icon="ai" title={t("ai.operations.emptyTitle")}>
        {t("ai.operations.emptyText")}
      </EmptyState>
    );
  const model = (id: string) => models.find((m) => m.id === id)?.displayName ?? id.slice(0, 8);
  return (
    <Table
      caption={t("ai.operations.title")}
      head={[
        t("ai.operations.reservedAt"),
        t("ai.filters.task"),
        t("ai.filters.model"),
        t("ai.filters.site"),
        t("ai.operations.status"),
        t("ai.amounts.estimated"),
        t("ai.operations.cost"),
        "",
      ]}
    >
      {items.map((o) => {
        const outcome = AI_OUTCOME_OF_STATUS[o.status];
        return (
          <tr key={o.id}>
            <td className={td}>
              <Time iso={o.reservedAt} c={c} />
            </td>
            <td className={td}>{t(`ai.tasks.names.${o.task}`)}</td>
            <td className={td}>
              {model(o.modelId)}
              <span className="block text-xs text-ink-3">{PROVIDER_NAMES[o.provider]}</span>
            </td>
            <td className={td}>{siteName(sites, o.siteId, t)}</td>
            <td className={td}>
              <StatusPill tone={OUTCOME_TONE[outcome]}>{t(`ai.status.${o.status}`)}</StatusPill>
              {o.errorCode ? <code className="ml-1 text-xs text-ink-3">{o.errorCode}</code> : null}
            </td>
            <td className={td}>
              <Usd micros={o.reservedMicros} locale={locale} />
            </td>
            <td className={td}>
              <CostCell op={o} c={c} />
            </td>
            <td className={td}>
              <Link
                href={detailHref(o.id)}
                className="font-medium text-petrol-strong hover:underline"
              >
                {t("ai.operations.details")}
                <span className="sr-only">: {o.id}</span>
              </Link>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function CostCell({ op: o, c }: { op: AiOperation; c: Ctx }) {
  const { t, locale } = c;
  if (o.costBasis === "LOCAL_USAGE" && o.actualMicros !== null)
    return (
      <span>
        <Usd micros={o.actualMicros} locale={locale} strong />
        <span className="block text-xs text-ink-3">{t("ai.amounts.actualShort")}</span>
      </span>
    );
  if (o.costBasis === "ASSUMED" && o.actualMicros !== null)
    return (
      <span>
        <Usd micros={o.actualMicros} locale={locale} strong />
        <span className="block text-xs text-amber-ink">{t("ai.amounts.assumedShort")}</span>
      </span>
    );
  if (o.status === "RESERVED" || o.status === "IN_FLIGHT")
    return <span className="text-xs text-ink-3">{t("ai.amounts.reservedShort")}</span>;
  return <span className="text-xs text-ink-3">{t("ai.amounts.none")}</span>;
}

export function OperationDetailView({
  detail,
  history,
  models,
  sites,
  c,
}: {
  detail: AiOperationDetail;
  history: AiOperationHistory | null;
  models: readonly AiModelSummary[];
  sites: readonly Site[];
  c: Ctx;
}) {
  const { t, locale } = c;
  const o = detail.operation;
  const model = models.find((m) => m.id === o.modelId);
  const tok = (v: number | null) => (v === null ? "—" : num(v, locale));
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("ai.operations.status")}>
          <StatusPill tone={OUTCOME_TONE[AI_OUTCOME_OF_STATUS[o.status]]}>
            {t(`ai.status.${o.status}`)}
          </StatusPill>
          {o.errorCode ? <code className="ml-1 text-xs text-ink-3">{o.errorCode}</code> : null}
        </Stat>
        <Stat label={t("ai.filters.task")}>{t(`ai.tasks.names.${o.task}`)}</Stat>
        <Stat label={t("ai.filters.model")}>
          {model?.displayName ?? o.modelId}
          <span className="block text-xs text-ink-3">{PROVIDER_NAMES[o.provider]}</span>
        </Stat>
        <Stat label={t("ai.filters.site")}>{siteName(sites, o.siteId, t)}</Stat>
        <Stat label={t("ai.amounts.estimated")} hint={t("ai.amounts.estimatedHint")}>
          <Usd micros={o.reservedMicros} locale={locale} />
        </Stat>
        <Stat label={t("ai.operations.cost")}>
          <CostCell op={o} c={c} />
        </Stat>
        <Stat label={t("ai.operations.reservedAt")}>
          <span className="text-sm">
            <Time iso={o.reservedAt} c={c} />
          </span>
        </Stat>
        <Stat label={t("ai.operations.finishedAt")}>
          <span className="text-sm">{o.finishedAt ? <Time iso={o.finishedAt} c={c} /> : "—"}</span>
        </Stat>
      </dl>
      <Table
        caption={t("ai.operations.tokens")}
        head={[
          t("ai.operations.tokenKind"),
          t("ai.operations.estimate"),
          t("ai.operations.reported"),
        ]}
      >
        <tr>
          <th scope="row" className={td}>
            {t("ai.operations.input")}
          </th>
          <td className={td}>{num(o.estInputTokens, locale)}</td>
          <td className={td}>{tok(o.inputTokens)}</td>
        </tr>
        <tr>
          <th scope="row" className={td}>
            {t("ai.operations.cachedRead")}
          </th>
          <td className={td}>—</td>
          <td className={td}>{tok(o.cachedReadTokens)}</td>
        </tr>
        <tr>
          <th scope="row" className={td}>
            {t("ai.operations.cacheWrite")}
          </th>
          <td className={td}>—</td>
          <td className={td}>{tok(o.cacheWriteTokens)}</td>
        </tr>
        <tr>
          <th scope="row" className={td}>
            {t("ai.operations.output")}
          </th>
          <td className={td}>{num(o.estOutputTokens, locale)}</td>
          <td className={td}>{tok(o.outputTokens)}</td>
        </tr>
        <tr>
          <th scope="row" className={td}>
            {t("ai.operations.reasoning")}
          </th>
          <td className={td}>—</td>
          <td className={td}>{tok(o.reasoningTokens)}</td>
        </tr>
      </Table>
      {o.costBasis === "ASSUMED" ? (
        <p className="rounded-xl border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-ink">
          {t("ai.operations.assumedNote")}
        </p>
      ) : null}
      <p className="text-xs text-ink-3">
        {detail.own && detail.result ? t("ai.operations.draftOwn") : t("ai.operations.noText")}
      </p>
      {history ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">{t("ai.operations.ledger")}</h3>
          <Table
            caption={t("ai.operations.ledger")}
            head={[
              t("ai.operations.at"),
              t("ai.operations.kind"),
              t("ai.operations.budget"),
              t("ai.amounts.reserved"),
              t("ai.amounts.actual"),
              t("ai.amounts.assumed"),
            ]}
          >
            {history.ledger.map((l) => (
              <tr key={l.id}>
                <td className={td}>
                  <Time iso={l.at} c={c} />
                </td>
                <td className={td}>
                  <code className="text-xs">{l.kind}</code>
                </td>
                <td className={td}>{budgetLabel(l, sites, t)}</td>
                <td className={td}>
                  <Usd micros={l.deltaReservedMicros} locale={locale} />
                </td>
                <td className={td}>
                  <Usd micros={l.deltaCommittedMicros} locale={locale} />
                </td>
                <td className={td}>
                  <Usd micros={l.deltaAssumedMicros} locale={locale} />
                </td>
              </tr>
            ))}
          </Table>
          <h3 className="pt-2 text-sm font-semibold text-ink">{t("ai.operations.auditTitle")}</h3>
          {history.audit === null ? (
            <p className="text-sm text-ink-2">{t("ai.operations.auditHidden")}</p>
          ) : (
            <AuditList items={history.audit} c={c} />
          )}
        </section>
      ) : null}
    </div>
  );
}

// --- prices --------------------------------------------------------------------------------------

const PRICE_TONE = { in_force: "success", scheduled: "petrol", superseded: "neutral" } as const;

export function PriceListView({
  list,
  can,
  c,
}: {
  list: AiPriceListResponse;
  can: AiPermissions;
  c: Ctx;
}) {
  const { t, locale } = c;
  const byModel = new Map<string, AiPriceListResponse["items"]>();
  for (const i of list.items)
    byModel.set(i.price.modelId, [...(byModel.get(i.price.modelId) ?? []), i]);
  return (
    <div className="space-y-6">
      {list.missing.length ? (
        <section className="rounded-2xl border border-danger/40 bg-danger-soft p-4">
          <h3 className="font-semibold text-ink">{t("ai.priceList.missingTitle")}</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {list.missing.map((m) => (
              <li key={m.modelId} className="flex flex-wrap items-center gap-2">
                <span className="text-ink">
                  {m.displayName} · {PROVIDER_NAMES[m.provider]}
                </span>
                {m.tasks.length ? (
                  <span className="text-ink-3">
                    {t("ai.priceList.usedBy", {
                      tasks: m.tasks.map((x) => t(`ai.tasks.names.${x}`)).join(", "),
                    })}
                  </span>
                ) : null}
                {can.modelManage ? (
                  <AddPriceButton modelId={m.modelId} displayName={m.displayName} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {byModel.size === 0 ? (
        <EmptyState icon="ai" title={t("ai.priceList.emptyTitle")}>
          {t("ai.priceList.emptyText")}
        </EmptyState>
      ) : (
        [...byModel.entries()].map(([modelId, items]) => {
          const head = items[0]!;
          return (
            <section key={modelId} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  {head.displayName}{" "}
                  <span className="font-normal text-ink-3">
                    · {PROVIDER_NAMES[head.provider]} · <code>{head.modelKey}</code> ·{" "}
                    {t(`ai.models.status.${head.modelStatus}`)}
                  </span>
                </h3>
                {can.modelManage ? (
                  <AddPriceButton modelId={modelId} displayName={head.displayName} />
                ) : null}
              </div>
              <Table
                caption={head.displayName}
                head={[
                  t("ai.priceList.state"),
                  t("ai.priceList.from"),
                  t("ai.prices.input"),
                  t("ai.prices.cached"),
                  t("ai.priceList.cacheWrite"),
                  t("ai.prices.output"),
                  t("ai.priceList.longTier"),
                  t("ai.priceList.perRequest"),
                  t("ai.prices.note"),
                ]}
              >
                {items.map((i) => {
                  const p = i.price;
                  return (
                    <tr key={p.id}>
                      <td className={td}>
                        <StatusPill tone={PRICE_TONE[i.state]}>
                          {t(`ai.priceList.states.${i.state}`)}
                        </StatusPill>
                      </td>
                      <td className={td}>
                        <Time iso={p.effectiveFrom} c={c} />
                      </td>
                      <td className={td}>
                        <Usd micros={p.inputMicrosPerMTok} locale={locale} />
                      </td>
                      <td className={td}>
                        <Usd micros={p.cachedReadMicrosPerMTok} locale={locale} />
                      </td>
                      <td className={td}>
                        {p.cacheWriteMicrosPerMTok ? (
                          <Usd micros={p.cacheWriteMicrosPerMTok} locale={locale} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={td}>
                        <Usd micros={p.outputMicrosPerMTok} locale={locale} />
                      </td>
                      <td className={td}>
                        {p.longContextThreshold !== null &&
                        p.longInputMicrosPerMTok &&
                        p.longOutputMicrosPerMTok
                          ? t("ai.priceList.longValue", {
                              tokens: num(p.longContextThreshold, locale),
                              input: formatUsd(p.longInputMicrosPerMTok, locale),
                              output: formatUsd(p.longOutputMicrosPerMTok, locale),
                            })
                          : "—"}
                      </td>
                      <td className={td}>
                        <Usd micros={p.perRequestFeeMicros} locale={locale} />
                      </td>
                      <td className={cx(td, "max-w-xs whitespace-normal text-ink-2")}>
                        {p.sourceNote}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </section>
          );
        })
      )}
      <p className="text-xs text-ink-3">{t("ai.priceList.note")}</p>
    </div>
  );
}

// --- reconciliation ------------------------------------------------------------------------------

export function ReconciliationView({
  rows,
  from,
  to,
  today,
  can,
  c,
}: {
  rows: readonly AiReconciliationRow[];
  from: string;
  to: string;
  today: string;
  can: AiPermissions;
  c: Ctx;
}) {
  const { t, locale } = c;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t("ai.reconciliation.explain")}</p>
      <form method="get" action="/ai" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="reconciliation" />
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-ink">{t("ai.filters.from")}</span>
          <input type="date" name="from" defaultValue={from} className={FIELD} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-ink">{t("ai.filters.to")}</span>
          <input type="date" name="to" defaultValue={to} className={FIELD} />
        </label>
        <button type="submit" className={buttonStyles.secondary}>
          {t("ai.filters.apply")}
        </button>
      </form>
      {can.budgetManage ? (
        <div>
          <RecordFigureButton today={today} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="ai" title={t("ai.reconciliation.emptyTitle")}>
          {t("ai.reconciliation.emptyText")}
        </EmptyState>
      ) : (
        <Table
          caption={t("ai.reconciliation.title")}
          head={[
            t("ai.reconciliation.day"),
            t("ai.reconciliation.provider"),
            t("ai.amounts.actual"),
            t("ai.amounts.assumed"),
            t("ai.reconciliation.providerFigure"),
            t("ai.reconciliation.difference"),
          ]}
        >
          {rows.map((r) => {
            const diff = r.differenceMicros === null ? null : BigInt(r.differenceMicros);
            return (
              <tr key={`${r.day}-${r.provider}`}>
                <td className={td}>{r.day}</td>
                <td className={td}>{PROVIDER_NAMES[r.provider]}</td>
                <td className={td}>
                  <Usd micros={r.localMicros} locale={locale} />
                </td>
                <td className={td}>
                  <Usd micros={r.assumedMicros} locale={locale} />
                </td>
                <td className={td}>
                  {r.providerMicros === null ? (
                    <span className="text-ink-3">{t("ai.reconciliation.notEntered")}</span>
                  ) : (
                    <Usd micros={r.providerMicros} locale={locale} strong />
                  )}
                </td>
                <td className={cx(td, diff !== null && diff !== 0n && "font-semibold")}>
                  {diff === null ? "—" : <Usd micros={r.differenceMicros!} locale={locale} />}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

// --- audit ---------------------------------------------------------------------------------------

const AUDIT_TONE: Record<AiAuditEvent["outcome"], PillTone> = {
  SUCCESS: "success",
  DENIED: "amber",
  FAILURE: "danger",
};

export function AuditList({ items, c }: { items: readonly AiAuditEvent[]; c: Ctx }) {
  const { t } = c;
  if (items.length === 0) return <p className="text-sm text-ink-2">{t("ai.audit.empty")}</p>;
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line">
      {items.map((e) => (
        <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={AUDIT_TONE[e.outcome]}>
              {t(`ai.audit.outcome.${e.outcome}`)}
            </StatusPill>
            <code className="text-xs text-ink">{e.action}</code>
            <span className="text-ink-3">
              <Time iso={e.occurredAt} c={c} />
            </span>
          </div>
          <p className="flex flex-wrap gap-x-2 text-ink-2">
            <span>{e.actor ? t("ai.audit.by", { actor: e.actor }) : t("ai.audit.system")}</span>
            {e.reason ? <code className="text-xs">{e.reason}</code> : null}
          </p>
          {Object.keys(e.details).length ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
              {Object.entries(e.details).map(([k, v]) => (
                <div key={k} className="flex gap-1">
                  <dt>{k}</dt>
                  <dd className="font-mono text-ink-2">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
