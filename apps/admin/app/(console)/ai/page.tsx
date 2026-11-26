import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AI_API,
  AI_BLOCKERS,
  AI_PROVIDERS,
  AiModelsResponseSchema,
  AiOverviewResponseSchema,
  AiPricesResponseSchema,
  AiProvidersResponseSchema,
  AiTasksResponseSchema,
  type AiModelSummary,
  type AiOverviewResponse,
  type AiPrice,
} from "@dream/contracts";
import { ModelsPanel, ProvidersPanel, TasksPanel } from "../../../components/ai/ai-actions";
import { PageHeader } from "../../../components/catalog/parts";
import { cx, ErrorState, Panel, StatusPill } from "../../../components/ui";
import { AI_TABS, parseAiTab, type AiTab } from "../../../lib/ai-view";
import { getTranslator } from "../../../lib/i18n/server";
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
 * Switching AI on or off is only in the Owner Console. Budgets and usage reports: DP-293.
 */
export default async function AiCenterPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
} = {}) {
  const session = await requireStaffSession();
  if (session.features?.aiCenter !== true) notFound();
  const t = await getTranslator();
  const tab = parseAiTab((await searchParams)?.tab);
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
  const body = await tabBody(tab, overview, t, session.isSystemOwner === true);
  if (body === null) return failed;
  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <nav aria-label={t("ai.tabs.label")} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line px-1">
          {AI_TABS.map((key) => (
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

async function tabBody(tab: AiTab, overview: AiOverviewResponse, t: Translate, isOwner: boolean) {
  const can = overview.permissions;
  if (tab === "overview") return <OverviewTab overview={overview} t={t} isOwner={isOwner} />;
  const models = await serverRead(`${AI_API}/models`, AiModelsResponseSchema);
  if (!models.ok) return null;
  if (tab === "providers") {
    const providers = await serverRead(`${AI_API}/providers`, AiProvidersResponseSchema);
    if (!providers.ok) return null;
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

function OverviewTab({
  overview,
  t,
  isOwner,
}: {
  overview: AiOverviewResponse;
  t: Translate;
  isOwner: boolean;
}) {
  const { callsPossible, blockers, permissions: can } = overview;
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
              ["providerManage", "modelManage", "budgetManage", "usageRead", "invoke"] as const
            ).map((k) => (
              <li key={k}>
                <StatusPill tone={can[k] ? "petrol" : "neutral"}>
                  {t(`ai.access.${k}`)}: {can[k] ? t("ai.access.yes") : t("ai.access.no")}
                </StatusPill>
              </li>
            ))}
          </ul>
          <p className="text-ink-3">{t("ai.access.later")}</p>
        </div>
      </Panel>
    </div>
  );
}
