/**
 * DP-293 (ADR-030 D6, D7): the AI Center's reports — usage by provider, model, task, site,
 * outcome and UTC day/month; every dated price with its state; alerts (budgets, missing prices,
 * unknown outcomes, overruns, reconciliation differences, ledger mismatches); the AI audit trail;
 * one operation's ledger. Read-only: nothing here moves money or changes a setting (DP-290 owns the
 * engine and the management routes). Rows are read in the caller's database context (row-level
 * security: AI on + permission); while AI is off every route is a 404.
 *
 * Nothing here reads or returns a prompt, a response or an API key: operations hold a digest,
 * counts and amounts only, and audit details pass the AI metadata allowlist again on the way out.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  type AiAlert,
  type AiAlertsResponse,
  type AiAuditEvent,
  type AiAuditResponse,
  type AiOperationHistory,
  type AiPriceListItem,
  type AiPriceListResponse,
  type AiProviderKey,
  type AiTaskTypeKey,
  type AiUsageReport,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { aiAuditMetadata } from "./audit.js";
import { AI_CONFIG } from "./config/ai-config.provider.js";
import { effectiveLimitMicros, type AiConfig } from "./config/ai-config.js";
import { AiLedgerService } from "./ledger.service.js";
import { priceDto } from "./budgets.service.js";
import {
  ReportQueryError,
  Sums,
  budgetState,
  bySpend,
  groupSums,
  parseUsageQuery,
  permille,
  reconciliationDiffers,
  seriesOf,
  startOfUtc,
  operationWhere,
  type UsageRow,
} from "./reports/usage-report.js";

type Tx = Parameters<Parameters<StaffAccess["staffData"]>[0]>[0];
const PLATFORM = { scope: "platform" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9_.:-]{1,60}$/;
const DAY_MS = 86_400_000;
/** A usage report reads at most this many operations; a wider range is refused (narrow it). */
export const MAX_REPORT_OPERATIONS = 50_000;
/** Look-back of the alerts on reconciliation differences, in UTC days. */
export const ALERT_RECONCILIATION_DAYS = 31;

const invalid = (path: string, rule: string) => new ApiError("VALIDATION_FAILED", [{ path, rule }]);

/** Audit details as they may leave the API: the AI allowlist again, the permission dropped. */
function auditDto(
  e: {
    id: string;
    occurredAt: Date;
    action: string;
    outcome: string;
    actorUserId: string | null;
    resourceType: string;
    resourceId: string | null;
    reason: string | null;
    metadata: unknown;
  },
  names: Map<string, string>,
): AiAuditEvent {
  const raw =
    e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>) : {};
  const details = aiAuditMetadata(raw) as AiAuditEvent["details"];
  delete details["permission"];
  return {
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    action: e.action,
    outcome: e.outcome as AiAuditEvent["outcome"],
    actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    reason: e.reason && CODE.test(e.reason) ? e.reason : null,
    details,
  };
}

@Injectable()
export class AiReportsService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(AiLedgerService) private readonly ledger: AiLedgerService,
  ) {}

  /** The permission, with "AI is off" as 404 (like the guard and DP-290's routes). */
  private async allow(
    ctx: RequestContext,
    permission: string,
    resource: string,
  ): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    const target = { type: resource, id: null };
    if (access.refusal(permission, PLATFORM) === "module_disabled") {
      await access.denied(permission, target, "ai_disabled");
      throw new ApiError("NOT_FOUND");
    }
    await access.require(permission, PLATFORM, target);
    return access;
  }

  private static query<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ReportQueryError) throw invalid(e.path, e.rule);
      throw e;
    }
  }

  // --- usage ---------------------------------------------------------------------------------

  async usage(
    ctx: RequestContext,
    raw: Record<string, string | undefined>,
  ): Promise<AiUsageReport> {
    const q = AiReportsService.query(() => parseUsageQuery(raw));
    const access = await this.allow(ctx, "ai_usage:read", "ai_usage");
    const { rows, models } = await access.staffData(async (tx) => {
      const rows = await tx.aiOperation.findMany({
        where: operationWhere(q.filters, q) as never,
        select: {
          status: true,
          provider: true,
          modelId: true,
          task: true,
          siteId: true,
          reservedAt: true,
          reservedMicros: true,
          actualMicros: true,
          costBasis: true,
          actInputTokens: true,
          actCachedReadTokens: true,
          actCacheWriteTokens: true,
          actOutputTokens: true,
          actReasoningTokens: true,
        },
        take: MAX_REPORT_OPERATIONS + 1,
      });
      if (rows.length > MAX_REPORT_OPERATIONS)
        throw new ApiError("CONFLICT_STATE", [{ path: "to", rule: "too_many_operations" }]);
      const ids = [...new Set(rows.map((r) => r.modelId))];
      const models = await tx.aiModel.findMany({
        where: { id: { in: ids } },
        select: { id: true, provider: true, modelId: true, displayName: true },
      });
      return { rows: rows as UsageRow[], models };
    });
    const total = new Sums();
    for (const r of rows) total.add(r);
    const model = new Map(models.map((m) => [m.id, m]));
    return {
      from: q.fromDay,
      to: q.toDay,
      granularity: q.granularity,
      totals: total.dto(),
      series: seriesOf(q, rows),
      byProvider: groupSums(rows, (r) => r.provider)
        .sort(bySpend)
        .map((g) => ({ provider: g.key, totals: g.sums.dto() })),
      byModel: groupSums(rows, (r) => r.modelId)
        .sort(bySpend)
        .map((g) => {
          const m = model.get(g.key);
          return {
            provider: (m?.provider ??
              rows.find((r) => r.modelId === g.key)!.provider) as AiProviderKey,
            modelId: g.key,
            modelKey: m?.modelId ?? "",
            displayName: m?.displayName ?? "",
            totals: g.sums.dto(),
          };
        }),
      byTask: groupSums(rows, (r) => r.task)
        .sort(bySpend)
        .map((g) => ({ task: g.key, totals: g.sums.dto() })),
      bySite: groupSums(rows, (r) => r.siteId)
        .sort(bySpend)
        .map((g) => ({ siteId: g.key, totals: g.sums.dto() })),
    };
  }

  // --- prices --------------------------------------------------------------------------------

  async prices(ctx: RequestContext): Promise<AiPriceListResponse> {
    const access = await this.allow(ctx, "ai:read", "ai_price");
    const now = this.clock.now();
    const { prices, models, tasks } = await access.staffData(async (tx) => ({
      prices: await tx.aiModelPrice.findMany({
        orderBy: [{ modelId: "asc" }, { effectiveFrom: "desc" }],
        take: 5000,
      }),
      models: await tx.aiModel.findMany({
        select: { id: true, provider: true, modelId: true, displayName: true, status: true },
      }),
      tasks: await tx.aiTaskSetting.findMany({
        where: { enabled: true, modelId: { not: null } },
        select: { task: true, modelId: true },
      }),
    }));
    const model = new Map(models.map((m) => [m.id, m]));
    const inForce = new Map<string, string>();
    for (const p of prices) {
      if (p.effectiveFrom.getTime() <= now.getTime() && !inForce.has(p.modelId))
        inForce.set(p.modelId, p.id);
    }
    const items: AiPriceListItem[] = prices.flatMap((p) => {
      const m = model.get(p.modelId);
      if (!m) return [];
      const state =
        p.effectiveFrom.getTime() > now.getTime()
          ? "scheduled"
          : inForce.get(p.modelId) === p.id
            ? "in_force"
            : "superseded";
      return [
        {
          price: priceDto(p),
          provider: m.provider,
          modelKey: m.modelId,
          displayName: m.displayName,
          modelStatus: m.status,
          state,
        },
      ];
    });
    const needed = new Map<string, AiTaskTypeKey[]>();
    for (const m of models) if (m.status === "ENABLED") needed.set(m.id, []);
    for (const t of tasks) needed.set(t.modelId!, [...(needed.get(t.modelId!) ?? []), t.task]);
    const missing = [...needed.entries()]
      .filter(([id]) => !inForce.has(id) && model.has(id))
      .map(([id, ts]) => {
        const m = model.get(id)!;
        return {
          modelId: id,
          provider: m.provider,
          modelKey: m.modelId,
          displayName: m.displayName,
          tasks: ts.sort(),
        };
      })
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.modelKey.localeCompare(b.modelKey));
    return { items, missing };
  }

  // --- alerts --------------------------------------------------------------------------------

  async alerts(ctx: RequestContext): Promise<AiAlertsResponse> {
    const access = await this.allow(ctx, "ai_usage:read", "ai_alerts");
    const now = this.clock.now();
    const dayStart = startOfUtc("day", now);
    const monthStart = startOfUtc("month", now);
    const reconFrom = new Date(dayStart.getTime() - (ALERT_RECONCILIATION_DAYS - 1) * DAY_MS);
    const data = await access.staffData(async (tx) => ({
      budgets: await tx.aiBudget.findMany({ where: { active: true } }),
      usage: await tx.aiBudgetUsage.findMany({
        where: { periodStart: { in: [dayStart, monthStart] } },
      }),
      unknown: await tx.aiOperation.groupBy({
        by: ["provider"],
        where: { status: "UNKNOWN", reservedAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { actualMicros: true },
      }),
      overruns: await tx.aiOperation.groupBy({
        by: ["provider", "modelId"],
        where: { errorCode: "overrun", reservedAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { actualMicros: true, reservedMicros: true },
      }),
      recon: await this.reconciliationRows(tx, reconFrom, new Date(dayStart.getTime() + DAY_MS)),
      missing: await this.missingPrices(tx, now),
    }));
    const items: AiAlert[] = [];
    const base = {
      budgetId: null,
      siteId: null,
      period: null,
      provider: null,
      modelId: null,
      day: null,
      count: null,
      amountMicros: null,
      limitMicros: null,
      permille: null,
    } satisfies Omit<AiAlert, "code" | "severity">;
    for (const b of data.budgets) {
      const start = b.period === "DAILY" ? dayStart : monthStart;
      const u = data.usage.find(
        (x) => x.budgetId === b.id && x.periodStart.getTime() === start.getTime(),
      );
      const used = (u?.committedMicros ?? 0n) + (u?.assumedMicros ?? 0n);
      const limit = effectiveLimitMicros(this.config, b.period, b.limitMicros);
      const state = budgetState(used, u?.reservedMicros ?? 0n, limit, b.warnPct);
      if (state === "ok") continue;
      items.push({
        ...base,
        code: state === "exceeded" ? "budget_exceeded" : "budget_warning",
        severity: state === "exceeded" ? "critical" : "warning",
        budgetId: b.id,
        siteId: b.siteId,
        period: b.period,
        amountMicros: used.toString(),
        limitMicros: limit.toString(),
        permille: permille(used, limit),
      });
    }
    const platform = new Set(
      data.budgets.filter((b) => b.scope === "PLATFORM").map((b) => b.period),
    );
    for (const period of ["DAILY", "MONTHLY"] as const) {
      if (!platform.has(period))
        items.push({ ...base, code: "budget_missing", severity: "critical", period });
    }
    for (const m of data.missing) {
      items.push({
        ...base,
        code: "price_missing",
        severity: m.tasks ? "critical" : "warning",
        provider: m.provider,
        modelId: m.id,
      });
    }
    for (const g of data.unknown) {
      items.push({
        ...base,
        code: "unknown_operations",
        severity: "warning",
        provider: g.provider,
        count: g._count._all,
        amountMicros: (g._sum.actualMicros ?? 0n).toString(),
      });
    }
    for (const g of data.overruns) {
      items.push({
        ...base,
        code: "cost_overrun",
        severity: "warning",
        provider: g.provider,
        modelId: g.modelId,
        count: g._count._all,
        amountMicros: ((g._sum.actualMicros ?? 0n) - (g._sum.reservedMicros ?? 0n)).toString(),
      });
    }
    for (const r of data.recon) {
      if (r.provider_ === null || !reconciliationDiffers(r.local, r.assumed, r.provider_)) continue;
      items.push({
        ...base,
        code: "reconciliation_difference",
        severity: "warning",
        provider: r.provider,
        day: r.day,
        amountMicros: (r.provider_ - r.local - r.assumed).toString(),
      });
    }
    const mismatches = await this.ledger.mismatches();
    if (mismatches > 0)
      items.push({ ...base, code: "ledger_mismatch", severity: "critical", count: mismatches });
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return {
      generatedAt: now.toISOString(),
      dayStart: dayStart.toISOString(),
      monthStart: monthStart.toISOString(),
      items,
    };
  }

  /** Enabled models (or models of an enabled task) without a price in force. */
  private async missingPrices(tx: Tx, now: Date) {
    const [models, tasks] = await Promise.all([
      tx.aiModel.findMany({
        where: { status: "ENABLED", prices: { none: { effectiveFrom: { lte: now } } } },
        select: { id: true, provider: true },
      }),
      tx.aiTaskSetting.findMany({
        where: {
          enabled: true,
          model: { prices: { none: { effectiveFrom: { lte: now } } } },
        },
        select: { modelId: true, model: { select: { provider: true } } },
      }),
    ]);
    const out = new Map<string, { id: string; provider: AiProviderKey; tasks: boolean }>();
    for (const m of models) out.set(m.id, { id: m.id, provider: m.provider, tasks: false });
    for (const t of tasks) {
      if (t.modelId && t.model)
        out.set(t.modelId, { id: t.modelId, provider: t.model.provider, tasks: true });
    }
    return [...out.values()];
  }

  /** Local + assumed vs the provider's figure per provider and UTC day (as DP-290's report). */
  private async reconciliationRows(tx: Tx, from: Date, end: Date) {
    const [ops, figures] = await Promise.all([
      tx.aiOperation.findMany({
        where: { finishedAt: { gte: from, lt: end }, costBasis: { not: "NONE" } },
        select: { provider: true, finishedAt: true, actualMicros: true, costBasis: true },
      }),
      tx.aiReconciliation.findMany({ where: { day: { gte: from, lt: end } } }),
    ]);
    const rows = new Map<
      string,
      {
        provider: AiProviderKey;
        day: string;
        local: bigint;
        assumed: bigint;
        provider_: bigint | null;
      }
    >();
    const row = (provider: AiProviderKey, day: string) => {
      const k = `${provider}|${day}`;
      let r = rows.get(k);
      if (!r) {
        r = { provider, day, local: 0n, assumed: 0n, provider_: null };
        rows.set(k, r);
      }
      return r;
    };
    for (const o of ops) {
      const r = row(o.provider, o.finishedAt!.toISOString().slice(0, 10));
      if (o.costBasis === "ASSUMED") r.assumed += o.actualMicros ?? 0n;
      else r.local += o.actualMicros ?? 0n;
    }
    for (const f of figures) {
      const r = row(f.provider, f.day.toISOString().slice(0, 10));
      r.provider_ = (r.provider_ ?? 0n) + f.providerAmountMicros;
    }
    return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  // --- audit and history ---------------------------------------------------------------------

  /** ai_usage:read, plus audit:read on the platform for the audit events themselves. */
  async audit(
    ctx: RequestContext,
    raw: Record<string, string | undefined>,
  ): Promise<AiAuditResponse> {
    const access = await this.allow(ctx, "ai_usage:read", "ai_audit");
    await access.require("audit:read", PLATFORM, { type: "ai_audit", id: null });
    const limit = raw["limit"] === undefined ? 50 : Number(raw["limit"]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid("limit", "range");
    const before = raw["before"] ? new Date(raw["before"]) : null;
    if (before && Number.isNaN(before.getTime())) throw invalid("before", "date");
    const action = raw["action"];
    if (action !== undefined && !/^ai\.[a-z_.]{1,60}$/.test(action))
      throw invalid("action", "unknown");
    const rows = await access.staffData((tx) =>
      tx.auditEvent.findMany({
        where: {
          action: action ?? { startsWith: "ai." },
          ...(before ? { occurredAt: { lt: before } } : {}),
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          occurredAt: true,
          action: true,
          outcome: true,
          actorUserId: true,
          resourceType: true,
          resourceId: true,
          reason: true,
          metadata: true,
        },
      }),
    );
    const page = rows.slice(0, limit);
    const names = await access.staffNames(
      page.flatMap((e) => (e.actorUserId ? [e.actorUserId] : [])),
    );
    return {
      items: page.map((e) => auditDto(e, names)),
      nextBefore:
        rows.length > limit && page.length ? page[page.length - 1]!.occurredAt.toISOString() : null,
    };
  }

  async history(ctx: RequestContext, rawId: string): Promise<AiOperationHistory> {
    const access = await this.allow(ctx, "ai_usage:read", "ai_operation");
    if (!UUID.test(rawId)) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const audited = access.allows("audit:read", PLATFORM);
    const { op, ledger, events } = await access.staffData(async (tx) => ({
      op: await tx.aiOperation.findUnique({ where: { id }, select: { id: true } }),
      ledger: await tx.aiLedgerEntry.findMany({
        where: { operationId: id },
        orderBy: [{ at: "asc" }, { id: "asc" }],
        include: { budget: { select: { scope: true, siteId: true, period: true } } },
      }),
      events: audited
        ? await tx.auditEvent.findMany({
            where: { resourceId: id, action: { startsWith: "ai." } },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            take: 100,
            select: {
              id: true,
              occurredAt: true,
              action: true,
              outcome: true,
              actorUserId: true,
              resourceType: true,
              resourceId: true,
              reason: true,
              metadata: true,
            },
          })
        : null,
    }));
    if (!op) throw new ApiError("NOT_FOUND");
    const names = events
      ? await access.staffNames(events.flatMap((e) => (e.actorUserId ? [e.actorUserId] : [])))
      : new Map<string, string>();
    return {
      operationId: id,
      ledger: ledger.map((l) => ({
        id: l.id,
        at: l.at.toISOString(),
        kind: l.kind,
        budgetId: l.budgetId,
        scope: l.budget.scope,
        siteId: l.budget.siteId,
        period: l.budget.period,
        periodStart: l.periodStart.toISOString(),
        deltaReservedMicros: l.deltaReservedMicros.toString(),
        deltaCommittedMicros: l.deltaCommittedMicros.toString(),
        deltaAssumedMicros: l.deltaAssumedMicros.toString(),
      })),
      audit: events ? events.map((e) => auditDto(e, names)) : null,
    };
  }
}
