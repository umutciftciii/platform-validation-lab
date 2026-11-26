import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AI_API,
  AI_BLOCKERS,
  AI_PROVIDERS,
  AiAlertsResponseSchema,
  AiAuditResponseSchema,
  AiBudgetsResponseSchema,
  AiModelsResponseSchema,
  AiOperationDetailSchema,
  AiOperationHistorySchema,
  AiOperationsResponseSchema,
  AiOverviewResponseSchema,
  AiPriceListResponseSchema,
  AiPricesResponseSchema,
  AiProviderDataTermsResponseSchema,
  AiProvidersResponseSchema,
  AiReconciliationResponseSchema,
  AiSettingsSchema,
  AiTasksResponseSchema,
  AiUsageReportSchema,
  type AiModelSummary,
  type AiOverviewResponse,
  type AiPrice,
  type AiProviderDataTermsResponse,
  type AiProviderKey,
} from "@dream/contracts";
import { ModelsPanel, ProvidersPanel, TasksPanel } from "../../../components/ai/ai-actions";
import {
  AlertsList,
  AuditList,
  BudgetCard,
  BudgetsView,
  OperationDetailView,
  OperationsTable,
  PriceListView,
  ReconciliationView,
  TotalsStats,
  UsageFilters,
  UsageView,
} from "../../../components/ai/ai-reports";
import { PageHeader } from "../../../components/catalog/parts";
import { buttonStyles, cx, ErrorState, Panel, StatusPill } from "../../../components/ui";
import {
  parseAiTab,
  parseUsageParams,
  usageQuery,
  visibleTabs,
  type AiTab,
} from "../../../lib/ai-view";
import type { AdminLocale } from "../../../lib/i18n/config";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import type { Translate } from "../../../lib/i18n/types";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  // While AI is off (or the user may not read it) the page is the console's 404: no AI title.
  const session = await requireStaffSession();
  return { title: session.features?.aiCenter === true ? t("ai.metaTitle") : t("notFound.title") };
}

/**
 * DP-287/DP-292 (ADR-030): Admin > AI Center. It exists only while the system owner keeps AI on and
 * the user may read it (`features.aiCenter`); otherwise this route is a plain 404, and so is the
 * API. Tabs: overview (readiness, the user's access), providers and keys, models and prices, task
 * settings. What a user may change comes from the overview's `permissions` (AI administrators and
 * the system owner manage; super admins and AI viewers read); the API decides again on every call.
 * Switching AI on or off is only in the Owner Console.
 *
 * DP-293: budgets (global and per site, UTC periods with local times, engine settings, alerts),
 * usage reports (by provider, model, task, site, outcome; daily/monthly chart; filters), the
 * operation history with its ledger and audit events, every dated price, reconciliation with the
 * providers' own figures and the AI audit trail. Actual, assumed, reserved, estimated and the
 * provider's figure stay separate amounts; budgets are enforced by the database only.
 */
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AiCenterPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
} = {}) {
  const session = await requireStaffSession();
  if (session.features?.aiCenter !== true) notFound();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const sp: Search = (await searchParams) ?? {};
  const requested = parseAiTab(sp["tab"]);
  const res = await serverRead(`${AI_API}/overview`, AiOverviewResponseSchema);
  const header = <PageHeader icon="ai" title={t("ai.title")} description={t("ai.description")} />;
  const failed = (
    <div className="space-y-8">
      {header}
      <ErrorState title={t("ai.loadError")}>{t("ai.loadErrorText")}</ErrorState>
    </div>
  );
  if (!res.ok) {
    // 404 = AI went off meanwhile; 403 = the user may not read it.
    if (res.status === 404 || res.status === 403) notFound();
    return failed;
  }
  const overview = res.data;
  const tabs = visibleTabs(overview.permissions);
  const tab: AiTab = tabs.includes(requested) ? requested : "overview";
  const c = { t, locale };
  const body = await tabBody(tab, overview, c, session.isSystemOwner === true, sp);
  if (body === null) return failed;
  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <nav aria-label={t("ai.tabs.label")} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line px-1">
          {tabs.map((key) => (
            <li key={key}>
              <Link
                href={key === "overview" ? "/ai" : `/ai?tab=${key}`}
                aria-current={key === tab ? "page" : undefined}
                className={cx(
                  "inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                  key === tab
                    ? "border-petrol text-petrol-strong"
                    : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                {t(`ai.tabs.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {body}
    </div>
  );
}

/** The price in force (else the next one) of each model, for the models that can be used. */
async function pricesOf(models: readonly AiModelSummary[]) {
  const now = Date.now();
  const wanted = models.filter((m) => m.status === "ENABLED" || m.status === "VERIFIED");
  const out: Record<string, AiPrice | undefined> = {};
  const inForce: string[] = [];
  const reads = await Promise.all(
    wanted.map((m) => serverRead(`${AI_API}/models/${m.id}/prices`, AiPricesResponseSchema)),
  );
  wanted.forEach((m, i) => {
    const r = reads[i];
    if (!r?.ok) return;
    const sorted = [...r.data.items].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const current = sorted.filter((p) => Date.parse(p.effectiveFrom) <= now).at(-1);
    out[m.id] = current ?? sorted[0];
    if (current) inForce.push(m.id);
  });
  return { prices: out, inForce };
}

async function tabBody(
  tab: AiTab,
  overview: AiOverviewResponse,
  c: { t: Translate; locale: AdminLocale },
  isOwner: boolean,
  sp: Search,
) {
  const { t } = c;
  const can = overview.permissions;
  if (tab === "overview") return OverviewTab({ overview, c, isOwner });
  if (tab === "budgets") return BudgetsTab(overview, c);
  if (tab === "reconciliation") return ReconciliationTab(overview, c, sp);
  if (tab === "audit") return AuditTab(c, sp);
  if (tab === "prices") {
    const list = await serverRead(`${AI_API}/prices`, AiPriceListResponseSchema);
    if (!list.ok) return null;
    return (
      <Panel
        id="ai-prices"
        title={t("ai.priceList.title")}
        description={t("ai.priceList.description")}
      >
        <PriceListView list={list.data} can={can} c={c} />
      </Panel>
    );
  }
  const models = await serverRead(`${AI_API}/models`, AiModelsResponseSchema);
  if (!models.ok) return null;
  if (tab === "usage") return UsageTab(overview, models.data.items, c, sp);
  if (tab === "operations") return OperationsTab(overview, models.data.items, c, sp);
  if (tab === "providers") {
    const [providers, terms] = await Promise.all([
      serverRead(`${AI_API}/providers`, AiProvidersResponseSchema),
      Promise.all(
        AI_PROVIDERS.map((p) =>
          serverRead(`${AI_API}/providers/${p}/data-terms`, AiProviderDataTermsResponseSchema),
        ),
      ),
    ]);
    if (!providers.ok) return null;
    // DP-298 (ADR-031 D6): the data-processing terms per provider; a 404 (no terms route) shows
    // no section, any other failure says the terms could not be loaded.
    const dataTerms: Partial<Record<AiProviderKey, AiProviderDataTermsResponse | null>> = {};
    AI_PROVIDERS.forEach((p, i) => {
      const r = terms[i];
      if (!r) return;
      if (r.ok) dataTerms[p] = r.data;
      else if (r.status !== 404) dataTerms[p] = null;
    });
    return (
      <Panel
        id="ai-providers"
        title={t("ai.providers.title")}
        description={t("ai.providers.description")}
      >
        <ProvidersPanel
          providers={providers.data.providers}
          models={models.data.items}
          transport={providers.data.transport}
          can={can}
          dataTerms={dataTerms}
        />
      </Panel>
    );
  }
  const { prices, inForce } = await pricesOf(models.data.items);
  if (tab === "models") {
    return (
      <Panel id="ai-models" title={t("ai.models.title")} description={t("ai.models.description")}>
        <ModelsPanel
          models={models.data.items}
          prices={prices}
          providers={AI_PROVIDERS}
          can={can}
        />
      </Panel>
    );
  }
  const tasks = await serverRead(`${AI_API}/tasks`, AiTasksResponseSchema);
  if (!tasks.ok) return null;
  return (
    <Panel id="ai-tasks" title={t("ai.tasks.title")} description={t("ai.tasks.description")}>
      <TasksPanel tasks={tasks.data.items} models={models.data.items} priced={inForce} can={can} />
    </Panel>
  );
}

type C = { t: Translate; locale: AdminLocale };
const utcToday = () => new Date().toISOString().slice(0, 10);

async function BudgetsTab(overview: AiOverviewResponse, c: C) {
  const { t } = c;
  const can = overview.permissions;
  const [budgets, settings, alerts, models] = await Promise.all([
    serverRead(`${AI_API}/budgets`, AiBudgetsResponseSchema),
    serverRead(`${AI_API}/settings`, AiSettingsSchema),
    can.usageRead ? serverRead(`${AI_API}/alerts`, AiAlertsResponseSchema) : null,
    serverRead(`${AI_API}/models`, AiModelsResponseSchema),
  ]);
  if (!budgets.ok) return null;
  return (
    <div className="space-y-6">
      {alerts?.ok ? (
        <Panel id="ai-alerts" title={t("ai.alerts.title")} description={t("ai.alerts.description")}>
          <AlertsList
            alerts={alerts.data.items}
            sites={overview.sites}
            models={models.ok ? models.data.items : []}
            c={c}
          />
        </Panel>
      ) : null}
      <Panel
        id="ai-budgets"
        title={t("ai.budgets.title")}
        description={t("ai.budgets.description")}
      >
        <BudgetsView
          budgets={budgets.data.items}
          localCap={budgets.data.localCap}
          settings={settings.ok ? settings.data : null}
          sites={overview.sites}
          can={can}
          c={c}
        />
      </Panel>
    </div>
  );
}

async function UsageTab(
  overview: AiOverviewResponse,
  models: readonly AiModelSummary[],
  c: C,
  sp: Search,
) {
  const { t } = c;
  const params = parseUsageParams(sp, new Date());
  const report = await serverRead(`${AI_API}/usage?${usageQuery(params)}`, AiUsageReportSchema);
  return (
    <Panel id="ai-usage" title={t("ai.usage.title")} description={t("ai.usage.description")}>
      <div className="space-y-6">
        <UsageFilters params={params} models={models} sites={overview.sites} tab="usage" c={c} />
        {report.ok ? (
          <UsageView report={report.data} sites={overview.sites} c={c} />
        ) : (
          <ErrorState title={t("ai.usage.loadError")}>{t("ai.usage.loadErrorText")}</ErrorState>
        )}
      </div>
    </Panel>
  );
}

async function OperationsTab(
  overview: AiOverviewResponse,
  models: readonly AiModelSummary[],
  c: C,
  sp: Search,
) {
  const { t } = c;
  const opId = one(sp["op"]);
  if (/^[0-9a-f-]{36}$/i.test(opId)) {
    const [detail, history] = await Promise.all([
      serverRead(`${AI_API}/operations/${opId}`, AiOperationDetailSchema),
      serverRead(`${AI_API}/operations/${opId}/history`, AiOperationHistorySchema),
    ]);
    return (
      <Panel
        id="ai-operation"
        title={t("ai.operations.detailTitle")}
        description={opId}
        action={
          <Link href="/ai?tab=operations" className={buttonStyles.secondary}>
            {t("ai.operations.back")}
          </Link>
        }
      >
        {detail.ok ? (
          <OperationDetailView
            detail={detail.data}
            history={history.ok ? history.data : null}
            models={models}
            sites={overview.sites}
            c={c}
          />
        ) : (
          <ErrorState title={t("ai.operations.notFound")}>
            {t("ai.operations.notFoundText")}
          </ErrorState>
        )}
      </Panel>
    );
  }
  // The list: filters optional (no default range), newest first, cursor `before`.
  const hasRange = one(sp["from"]) !== "" || one(sp["to"]) !== "";
  const params = parseUsageParams(sp, new Date());
  const filters = {
    ...params,
    ...(hasRange ? {} : { from: "", to: "" }),
    granularity: "day" as const,
  };
  const q = new URLSearchParams(usageQuery(filters));
  q.delete("granularity");
  const before = one(sp["before"]);
  if (before && !Number.isNaN(Date.parse(before))) q.set("before", before);
  q.set("limit", "50");
  const list = await serverRead(`${AI_API}/operations?${q.toString()}`, AiOperationsResponseSchema);
  const keep = new URLSearchParams(q);
  keep.delete("limit");
  keep.delete("before");
  const href = (extra: Record<string, string>) => {
    const u = new URLSearchParams(keep);
    u.set("tab", "operations");
    for (const [k, v] of Object.entries(extra)) u.set(k, v);
    return `/ai?${u.toString()}`;
  };
  return (
    <Panel
      id="ai-operations"
      title={t("ai.operations.title")}
      description={t("ai.operations.description")}
    >
      <div className="space-y-5">
        <UsageFilters
          params={{ ...params, from: hasRange ? params.from : "", to: hasRange ? params.to : "" }}
          models={models}
          sites={overview.sites}
          tab="operations"
          c={c}
        />
        {list.ok ? (
          <>
            <OperationsTable
              items={list.data.items}
              models={models}
              sites={overview.sites}
              detailHref={(id) => `/ai?tab=operations&op=${id}`}
              c={c}
            />
            <div className="flex flex-wrap gap-2">
              {before ? (
                <Link href={href({})} className={buttonStyles.secondary}>
                  {t("ai.operations.newest")}
                </Link>
              ) : null}
              {list.data.nextBefore ? (
                <Link
                  href={href({ before: list.data.nextBefore })}
                  className={buttonStyles.secondary}
                >
                  {t("ai.operations.older")}
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <ErrorState title={t("ai.usage.loadError")}>{t("ai.usage.loadErrorText")}</ErrorState>
        )}
      </div>
    </Panel>
  );
}

async function ReconciliationTab(overview: AiOverviewResponse, c: C, sp: Search) {
  const { t } = c;
  const today = utcToday();
  const day = /^\d{4}-\d{2}-\d{2}$/;
  let from = one(sp["from"]);
  let to = one(sp["to"]);
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!day.test(from) || !day.test(to) || !(span >= 0 && span < 92)) {
    to = today;
    from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  }
  const res = await serverRead(
    `${AI_API}/reconciliation?from=${from}&to=${to}`,
    AiReconciliationResponseSchema,
  );
  return (
    <Panel
      id="ai-reconciliation"
      title={t("ai.reconciliation.title")}
      description={t("ai.reconciliation.description")}
    >
      {res.ok ? (
        <ReconciliationView
          rows={res.data.items}
          from={from}
          to={to}
          today={today}
          can={overview.permissions}
          c={c}
        />
      ) : (
        <ErrorState title={t("ai.usage.loadError")}>{t("ai.usage.loadErrorText")}</ErrorState>
      )}
    </Panel>
  );
}

async function AuditTab(c: C, sp: Search) {
  const { t } = c;
  const q = new URLSearchParams({ limit: "50" });
  const before = one(sp["before"]);
  if (before && !Number.isNaN(Date.parse(before))) q.set("before", before);
  const action = one(sp["action"]);
  if (/^ai\.[a-z_.]{1,60}$/.test(action)) q.set("action", action);
  const res = await serverRead(`${AI_API}/audit?${q.toString()}`, AiAuditResponseSchema);
  const next = res.ok && res.data.nextBefore ? res.data.nextBefore : null;
  return (
    <Panel id="ai-audit" title={t("ai.audit.title")} description={t("ai.audit.description")}>
      <div className="space-y-4">
        <form method="get" action="/ai" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="audit" />
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-ink">{t("ai.audit.action")}</span>
            <input
              name="action"
              defaultValue={q.get("action") ?? ""}
              placeholder="ai.operation.unknown"
              className="h-10 rounded-lg border border-line bg-surface px-3 text-sm"
            />
          </label>
          <button type="submit" className={buttonStyles.secondary}>
            {t("ai.filters.apply")}
          </button>
        </form>
        {res.ok ? (
          <>
            <AuditList items={res.data.items} c={c} />
            {next ? (
              <Link
                href={`/ai?tab=audit&before=${encodeURIComponent(next)}${q.get("action") ? `&action=${q.get("action")}` : ""}`}
                className={buttonStyles.secondary}
              >
                {t("ai.operations.older")}
              </Link>
            ) : null}
          </>
        ) : (
          <ErrorState title={t("ai.usage.loadError")}>{t("ai.usage.loadErrorText")}</ErrorState>
        )}
      </div>
    </Panel>
  );
}

async function OverviewTab({
  overview,
  c,
  isOwner,
}: {
  overview: AiOverviewResponse;
  c: C;
  isOwner: boolean;
}) {
  const { t } = c;
  const { callsPossible, blockers, permissions: can } = overview;
  const today = utcToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const [budgets, alerts, month] = await Promise.all([
    serverRead(`${AI_API}/budgets`, AiBudgetsResponseSchema),
    can.usageRead ? serverRead(`${AI_API}/alerts`, AiAlertsResponseSchema) : null,
    can.usageRead
      ? serverRead(
          `${AI_API}/usage?from=${monthStart}&to=${today}&granularity=month`,
          AiUsageReportSchema,
        )
      : null,
  ]);
  const platform = budgets.ok
    ? budgets.data.items.filter((b) => b.active && b.scope === "PLATFORM")
    : [];
  const manages = can.providerManage || can.modelManage || can.budgetManage;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel id="ai-state" title={t("ai.statePanel")}>
        <div className="space-y-2 text-sm">
          <StatusPill tone="success">{t("ai.stateOn")}</StatusPill>
          <p className="text-ink-2">{t("ai.stateOnText")}</p>
          <p className="text-ink-3">
            {isOwner ? (
              <Link href="/owner" className="font-medium text-petrol-strong hover:underline">
                {t("ai.switchInOwnerConsole")}
              </Link>
            ) : (
              t("ai.switchOwnerOnly")
            )}
          </p>
          <p className="text-ink-3">{t(`ai.transport.${overview.transport}`)}</p>
        </div>
      </Panel>
      <Panel id="ai-calls" title={t("ai.callsPanel")}>
        <div className="space-y-3 text-sm">
          {callsPossible ? (
            <>
              <StatusPill tone="success">{t("ai.callsPossible")}</StatusPill>
              <p className="text-ink-2">{t("ai.callsPossibleText")}</p>
            </>
          ) : (
            <>
              <StatusPill tone="neutral">{t("ai.callsImpossible")}</StatusPill>
              <p className="text-ink-2">{t("ai.callsImpossibleText")}</p>
            </>
          )}
          <ul className="space-y-2" aria-label={t("ai.readiness")}>
            {AI_BLOCKERS.map((b) => {
              const missing = blockers.includes(b);
              return (
                <li key={b} className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={missing ? "amber" : "success"}>
                    {missing ? t("ai.blockerMissing") : t("ai.blockerReady")}
                  </StatusPill>
                  <span className="text-ink">{t(`ai.blockers.${b}`)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>
      <Panel id="ai-access" title={t("ai.access.title")} className="lg:col-span-2">
        <div className="space-y-2 text-sm">
          <p className="text-ink-2">{manages ? t("ai.access.manage") : t("ai.access.read")}</p>
          <ul className="flex flex-wrap gap-2">
            {(
              [
                "providerManage",
                "modelManage",
                "budgetManage",
                "usageRead",
                "invoke",
                "auditRead",
              ] as const
            ).map((k) => (
              <li key={k}>
                <StatusPill tone={can[k] ? "petrol" : "neutral"}>
                  {t(`ai.access.${k}`)}: {can[k] ? t("ai.access.yes") : t("ai.access.no")}
                </StatusPill>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
      {alerts?.ok ? (
        <Panel
          id="ai-overview-alerts"
          title={t("ai.alerts.title")}
          description={t("ai.alerts.description")}
          className="lg:col-span-2"
        >
          <AlertsList alerts={alerts.data.items} sites={overview.sites} models={[]} c={c} />
        </Panel>
      ) : null}
      {platform.length ? (
        <Panel
          id="ai-overview-budgets"
          title={t("ai.overview.budgetsTitle")}
          description={t("ai.overview.budgetsText")}
          className="lg:col-span-2"
          action={
            <Link
              href="/ai?tab=budgets"
              className="text-sm font-medium text-petrol-strong hover:underline"
            >
              {t("ai.overview.allBudgets")}
            </Link>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {platform.map((b) => (
              <BudgetCard
                key={b.id}
                budget={b}
                sites={overview.sites}
                can={{ ...can, budgetManage: false }}
                c={c}
              />
            ))}
          </div>
        </Panel>
      ) : null}
      {month?.ok ? (
        <Panel
          id="ai-overview-month"
          title={t("ai.overview.monthTitle")}
          description={t("ai.overview.monthText")}
          className="lg:col-span-2"
          action={
            <Link
              href="/ai?tab=usage"
              className="text-sm font-medium text-petrol-strong hover:underline"
            >
              {t("ai.overview.allUsage")}
            </Link>
          }
        >
          <TotalsStats totals={month.data.totals} c={c} />
        </Panel>
      ) : null}
    </div>
  );
}
