/**
 * DP-290 (ADR-030 D6, D7): the configuration the budget engine works with, and what it recorded.
 *
 *  - settings (concurrency, reservation lifetime, safety margin) and budgets: ai_budget:manage;
 *  - dated, immutable model prices and task limits: ai_model:manage;
 *  - budgets with their current UTC period, operations and the reconciliation report: ai:read /
 *    ai_usage:read;
 *  - a provider's own daily figure for reconciliation: ai_budget:manage.
 *
 * Every route sits behind AiGateGuard (404 while AI is off); reads and writes run in the caller's
 * database context (row-level security: AI on + permission). Money is micro-USD; nothing here
 * holds a prompt or response text. The engine itself (reservation, settlement) is ledger.service.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  AiBudgetCreateRequestSchema,
  AiBudgetUpdateRequestSchema,
  AiPriceCreateRequestSchema,
  AiReconciliationCreateRequestSchema,
  AiSettingsSchema,
  AiTaskSettingRequestSchema,
  AI_TASK_TYPES,
  type AiBudget,
  type AiBudgetsResponse,
  type AiOperation,
  type AiOperationsResponse,
  type AiPrice,
  type AiPricesResponse,
  type AiProviderKey,
  type AiReconciliationResponse,
  type AiReconciliationRow,
  type AiSettingsDto,
  type AiTaskSettingDto,
  type AiTasksResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { aiAuditMetadata } from "./audit.js";
import { AI_CONFIG } from "./config/ai-config.provider.js";
import { effectiveLimitMicros, type AiConfig } from "./config/ai-config.js";
import {
  ReportQueryError,
  operationWhere,
  parseFilters,
  parseRange,
} from "./reports/usage-report.js";

type Tx = Parameters<Parameters<StaffAccess["staffData"]>[0]>[0];
const PLATFORM = { scope: "platform" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const conflict = (rule: string, path = "(root)") =>
  new ApiError("CONFLICT_STATE", [{ path, rule }]);
const invalid = (path: string, rule: string) => new ApiError("VALIDATION_FAILED", [{ path, rule }]);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const str = (v: bigint | null) => (v === null ? null : v.toString());
const big = (v: string | null | undefined) => (v === null || v === undefined ? null : BigInt(v));
/** At most this many days per reconciliation report. */
export const MAX_RECONCILIATION_DAYS = 92;
/** DP-293: at most this many days in the operations list's date filter. */
export const MAX_OPERATION_RANGE_DAYS = 3660;

function periodStart(period: "DAILY" | "MONTHLY", at: Date): Date {
  return period === "DAILY"
    ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
    : new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

interface PriceRow {
  id: string;
  modelId: string;
  inputMicrosPerMTok: bigint;
  cachedReadMicrosPerMTok: bigint;
  cacheWriteMicrosPerMTok: bigint | null;
  outputMicrosPerMTok: bigint;
  longContextThreshold: number | null;
  longInputMicrosPerMTok: bigint | null;
  longOutputMicrosPerMTok: bigint | null;
  perRequestFeeMicros: bigint;
  effectiveFrom: Date;
  source: string;
  sourceNote: string;
  createdAt: Date;
}

export function priceDto(p: PriceRow): AiPrice {
  return {
    id: p.id,
    modelId: p.modelId,
    inputMicrosPerMTok: p.inputMicrosPerMTok.toString(),
    cachedReadMicrosPerMTok: p.cachedReadMicrosPerMTok.toString(),
    cacheWriteMicrosPerMTok: str(p.cacheWriteMicrosPerMTok),
    outputMicrosPerMTok: p.outputMicrosPerMTok.toString(),
    longContextThreshold: p.longContextThreshold,
    longInputMicrosPerMTok: str(p.longInputMicrosPerMTok),
    longOutputMicrosPerMTok: str(p.longOutputMicrosPerMTok),
    perRequestFeeMicros: p.perRequestFeeMicros.toString(),
    effectiveFrom: p.effectiveFrom.toISOString(),
    source: p.source,
    sourceNote: p.sourceNote,
    createdAt: p.createdAt.toISOString(),
  };
}

@Injectable()
export class AiBudgetsService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** The permission, with "AI is off" as 404 and a stale step-up as AUTH_STEP_UP_REQUIRED. */
  private async allow(
    ctx: RequestContext,
    permission: string,
    resource: string,
  ): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    const refusal = access.refusal(permission, PLATFORM);
    const target = { type: resource, id: null };
    if (refusal === "module_disabled") {
      await access.denied(permission, target, "ai_disabled");
      throw new ApiError("NOT_FOUND");
    }
    if (refusal === "mfa_required") {
      await access.denied(permission, target, "mfa_required");
      throw new ApiError("AUTH_STEP_UP_REQUIRED");
    }
    await access.require(permission, PLATFORM, target);
    return access;
  }

  private audit(
    access: StaffAccess,
    tx: Tx,
    action: string,
    permission: string,
    resource: string,
    id: string | null,
    metadata: Record<string, unknown>,
  ) {
    return access.audit(tx, {
      action,
      resourceType: resource,
      resourceId: id,
      siteId: null,
      permission,
      metadata: aiAuditMetadata(metadata),
    });
  }

  // --- settings --------------------------------------------------------------------------------

  async settings(ctx: RequestContext): Promise<AiSettingsDto> {
    const access = await this.allow(ctx, "ai:read", "ai_settings");
    const s = await access.staffData((tx) =>
      tx.aiSettings.findUnique({
        where: { id: 1 },
        select: {
          maxConcurrency: true,
          reservationTtlSec: true,
          safetyMarginPct: true,
          version: true,
        },
      }),
    );
    if (!s) throw new ApiError("NOT_FOUND");
    return s;
  }

  async updateSettings(ctx: RequestContext, body: unknown): Promise<AiSettingsDto> {
    const access = await this.allow(ctx, "ai_budget:manage", "ai_settings");
    const req = parseBody(AiSettingsSchema, body);
    await access.staffData(async (tx) => {
      const res = await tx.aiSettings.updateMany({
        where: { id: 1, version: req.version },
        data: {
          maxConcurrency: req.maxConcurrency,
          reservationTtlSec: req.reservationTtlSec,
          safetyMarginPct: req.safetyMarginPct,
          version: req.version + 1,
          updatedById: access.userId,
        },
      });
      if (res.count !== 1) throw conflict("stale_version", "version");
      await this.audit(access, tx, "ai.settings.update", "ai_budget:manage", "ai_settings", "1", {
        version: req.version + 1,
      });
    });
    return this.settings(ctx);
  }

  // --- prices ----------------------------------------------------------------------------------

  async prices(ctx: RequestContext, rawModelId: string): Promise<AiPricesResponse> {
    const access = await this.allow(ctx, "ai:read", "ai_price");
    const modelId = this.uuid(rawModelId);
    const rows = await access.staffData((tx) =>
      tx.aiModelPrice.findMany({ where: { modelId }, orderBy: { effectiveFrom: "desc" } }),
    );
    return { items: rows.map(priceDto) };
  }

  async addPrice(ctx: RequestContext, rawModelId: string, body: unknown): Promise<AiPrice> {
    const access = await this.allow(ctx, "ai_model:manage", "ai_price");
    const modelId = this.uuid(rawModelId);
    const req = parseBody(AiPriceCreateRequestSchema, body);
    const now = this.clock.now();
    const effectiveFrom = req.effectiveFrom ? new Date(req.effectiveFrom) : now;
    if (effectiveFrom.getTime() < now.getTime() - 60_000)
      throw invalid("effectiveFrom", "backdated");
    const long = [
      req.longContextThreshold,
      req.longInputMicrosPerMTok,
      req.longOutputMicrosPerMTok,
    ];
    if (
      long.some((v) => v === null || v === undefined) &&
      long.some((v) => v !== null && v !== undefined)
    ) {
      throw invalid("longContextThreshold", "all_or_none");
    }
    const row = await access.staffData(async (tx) => {
      const model = await tx.aiModel.findUnique({
        where: { id: modelId },
        select: { id: true, provider: true },
      });
      if (!model) throw new ApiError("NOT_FOUND");
      const clash = await tx.aiModelPrice.findFirst({
        where: { modelId, effectiveFrom },
        select: { id: true },
      });
      if (clash) throw conflict("price_exists", "effectiveFrom");
      const created = await tx.aiModelPrice.create({
        data: {
          modelId,
          inputMicrosPerMTok: BigInt(req.inputMicrosPerMTok),
          cachedReadMicrosPerMTok: BigInt(req.cachedReadMicrosPerMTok),
          cacheWriteMicrosPerMTok: big(req.cacheWriteMicrosPerMTok),
          outputMicrosPerMTok: BigInt(req.outputMicrosPerMTok),
          longContextThreshold: req.longContextThreshold ?? null,
          longInputMicrosPerMTok: big(req.longInputMicrosPerMTok),
          longOutputMicrosPerMTok: big(req.longOutputMicrosPerMTok),
          perRequestFeeMicros: BigInt(req.perRequestFeeMicros ?? "0"),
          effectiveFrom,
          sourceNote: req.sourceNote,
          createdById: access.userId,
        },
      });
      await this.audit(access, tx, "ai.price.add", "ai_model:manage", "ai_price", created.id, {
        provider: model.provider,
        modelId,
        priceId: created.id,
      });
      return created;
    });
    return priceDto(row);
  }

  // --- task settings ---------------------------------------------------------------------------

  async tasks(ctx: RequestContext): Promise<AiTasksResponse> {
    const access = await this.allow(ctx, "ai:read", "ai_task");
    const rows = await access.staffData((tx) =>
      tx.aiTaskSetting.findMany({ orderBy: { task: "asc" } }),
    );
    return {
      items: rows.map((t) => ({
        task: t.task,
        enabled: t.enabled,
        modelId: t.modelId,
        maxInputTokens: t.maxInputTokens,
        maxOutputTokens: t.maxOutputTokens,
        thinkingBudget: t.thinkingBudget,
        maxCostPerOpMicros: t.maxCostPerOpMicros.toString(),
        temperatureMilli: t.temperatureMilli,
        version: t.version,
      })),
    };
  }

  async updateTask(ctx: RequestContext, rawTask: string, body: unknown): Promise<AiTaskSettingDto> {
    const access = await this.allow(ctx, "ai_model:manage", "ai_task");
    const task = AI_TASK_TYPES.find((t) => t === rawTask.toUpperCase());
    if (!task) throw new ApiError("NOT_FOUND");
    const req = parseBody(AiTaskSettingRequestSchema, body);
    await access.staffData(async (tx) => {
      if (req.enabled) {
        if (!req.modelId) throw conflict("model_required", "modelId");
        const model = await tx.aiModel.findUnique({
          where: { id: req.modelId },
          select: { status: true, compatible: true },
        });
        if (!model || model.status !== "ENABLED" || !model.compatible)
          throw conflict("model_not_enabled", "modelId");
        const price = await tx.aiModelPrice.count({
          where: { modelId: req.modelId, effectiveFrom: { lte: this.clock.now() } },
        });
        if (price === 0) throw conflict("price_missing", "modelId");
      }
      const res = await tx.aiTaskSetting.updateMany({
        where: { task, version: req.version },
        data: {
          enabled: req.enabled,
          modelId: req.modelId,
          maxInputTokens: req.maxInputTokens,
          maxOutputTokens: req.maxOutputTokens,
          thinkingBudget: req.thinkingBudget,
          maxCostPerOpMicros: BigInt(req.maxCostPerOpMicros),
          temperatureMilli: req.temperatureMilli,
          version: req.version + 1,
          updatedById: access.userId,
        },
      });
      if (res.count !== 1) throw conflict("stale_version", "version");
      await this.audit(access, tx, "ai.task.update", "ai_model:manage", "ai_task", task, {
        task,
        modelId: req.modelId,
        enabled: req.enabled,
        version: req.version + 1,
      });
    });
    return (await this.tasks(ctx)).items.find((t) => t.task === task)!;
  }

  // --- budgets ---------------------------------------------------------------------------------

  async budgets(ctx: RequestContext): Promise<AiBudgetsResponse> {
    const access = await this.allow(ctx, "ai:read", "ai_budget");
    const now = this.clock.now();
    const { budgets, usage } = await access.staffData(async (tx) => {
      const budgets = await tx.aiBudget.findMany({
        orderBy: [{ scope: "asc" }, { period: "asc" }, { createdAt: "asc" }],
      });
      const usage = await tx.aiBudgetUsage.findMany({
        where: {
          OR: [
            { periodStart: periodStart("DAILY", now) },
            { periodStart: periodStart("MONTHLY", now) },
          ],
        },
      });
      return { budgets, usage };
    });
    const items: AiBudget[] = budgets.map((b) => {
      const start = periodStart(b.period, now);
      const u = usage.find(
        (x) => x.budgetId === b.id && x.periodStart.getTime() === start.getTime(),
      );
      const reserved = u?.reservedMicros ?? 0n;
      const committed = u?.committedMicros ?? 0n;
      const assumed = u?.assumedMicros ?? 0n;
      const limit = effectiveLimitMicros(this.config, b.period, b.limitMicros);
      return {
        id: b.id,
        scope: b.scope,
        siteId: b.siteId,
        period: b.period,
        limitMicros: b.limitMicros.toString(),
        effectiveLimitMicros: limit.toString(),
        warnPct: b.warnPct,
        active: b.active,
        version: b.version,
        current: {
          periodStart: start.toISOString(),
          reservedMicros: reserved.toString(),
          committedMicros: committed.toString(),
          assumedMicros: assumed.toString(),
          warning: (reserved + committed + assumed) * 100n >= limit * BigInt(b.warnPct),
        },
      };
    });
    const cap = this.config.localCap;
    return {
      items,
      localCap: cap
        ? { dailyMicros: cap.dailyMicros.toString(), monthlyMicros: cap.monthlyMicros.toString() }
        : null,
    };
  }

  async createBudget(ctx: RequestContext, body: unknown): Promise<AiBudget> {
    const access = await this.allow(ctx, "ai_budget:manage", "ai_budget");
    const req = parseBody(AiBudgetCreateRequestSchema, body);
    const siteId = req.scope === "SITE" ? (req.siteId ?? null) : null;
    if (req.scope === "SITE" && (!siteId || !access.sites.some((s) => s.id === siteId))) {
      throw invalid("siteId", "unknown_site");
    }
    if (req.scope === "PLATFORM" && req.siteId) throw invalid("siteId", "platform_has_no_site");
    const id = await access.staffData(async (tx) => {
      const clash = await tx.aiBudget.findFirst({
        where: { active: true, scope: req.scope, siteId, period: req.period },
        select: { id: true },
      });
      if (clash) throw conflict("budget_exists");
      const b = await tx.aiBudget.create({
        data: {
          scope: req.scope,
          siteId,
          period: req.period,
          limitMicros: BigInt(req.limitMicros),
          warnPct: req.warnPct ?? 80,
          createdById: access.userId,
        },
        select: { id: true },
      });
      await this.audit(access, tx, "ai.budget.create", "ai_budget:manage", "ai_budget", b.id, {
        budgetId: b.id,
        scope: req.scope,
        siteId,
        period: req.period,
        limitMicros: req.limitMicros,
      });
      return b.id;
    });
    return (await this.budgets(ctx)).items.find((b) => b.id === id)!;
  }

  async updateBudget(ctx: RequestContext, rawId: string, body: unknown): Promise<AiBudget> {
    const access = await this.allow(ctx, "ai_budget:manage", "ai_budget");
    const id = this.uuid(rawId);
    const req = parseBody(AiBudgetUpdateRequestSchema, body);
    await access.staffData(async (tx) => {
      const before = await tx.aiBudget.findUnique({ where: { id } });
      if (!before) throw new ApiError("NOT_FOUND");
      if (req.active && !before.active) {
        const clash = await tx.aiBudget.findFirst({
          where: {
            active: true,
            scope: before.scope,
            siteId: before.siteId,
            period: before.period,
          },
          select: { id: true },
        });
        if (clash) throw conflict("budget_exists");
      }
      const res = await tx.aiBudget.updateMany({
        where: { id, version: req.version },
        data: {
          limitMicros: BigInt(req.limitMicros),
          warnPct: req.warnPct,
          active: req.active,
          version: req.version + 1,
          updatedById: access.userId,
        },
      });
      if (res.count !== 1) throw conflict("stale_version", "version");
      await this.audit(
        access,
        tx,
        req.active ? "ai.budget.update" : "ai.budget.deactivate",
        "ai_budget:manage",
        "ai_budget",
        id,
        {
          budgetId: id,
          limitMicros: req.limitMicros,
          previousLimitMicros: before.limitMicros,
          version: req.version + 1,
        },
      );
    });
    return (await this.budgets(ctx)).items.find((b) => b.id === id)!;
  }

  // --- operations and reconciliation ------------------------------------------------------------

  /**
   * DP-293: optional filters (UTC day range by reservation, provider, model, task, site or
   * `platform`, outcome class); the cursor stays `before` (reservation time).
   */
  async operations(
    ctx: RequestContext,
    query: Record<string, string | undefined>,
  ): Promise<AiOperationsResponse> {
    let filter: { range: ReturnType<typeof parseRange>; filters: ReturnType<typeof parseFilters> };
    try {
      filter = { range: parseRange(query, MAX_OPERATION_RANGE_DAYS), filters: parseFilters(query) };
    } catch (e) {
      if (e instanceof ReportQueryError) throw invalid(e.path, e.rule);
      throw e;
    }
    const access = await this.allow(ctx, "ai_usage:read", "ai_operation");
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid("limit", "range");
    const before = query.before ? new Date(query.before) : null;
    if (before && Number.isNaN(before.getTime())) throw invalid("before", "date");
    const rows = await access.staffData((tx) =>
      tx.aiOperation.findMany({
        where: {
          AND: [
            operationWhere(filter.filters, filter.range),
            before ? { reservedAt: { lt: before } } : {},
          ],
        } as never,
        orderBy: [{ reservedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
    );
    const page = rows.slice(0, limit);
    const items: AiOperation[] = page.map((o) => ({
      id: o.id,
      task: o.task,
      siteId: o.siteId,
      provider: o.provider,
      modelId: o.modelId,
      status: o.status,
      estInputTokens: o.estInputTokens,
      estOutputTokens: o.estOutputTokens,
      reservedMicros: o.reservedMicros.toString(),
      actualMicros: str(o.actualMicros),
      costBasis: o.costBasis,
      inputTokens: o.actInputTokens,
      cachedReadTokens: o.actCachedReadTokens,
      cacheWriteTokens: o.actCacheWriteTokens,
      outputTokens: o.actOutputTokens,
      reasoningTokens: o.actReasoningTokens,
      errorCode: o.errorCode,
      reservedAt: o.reservedAt.toISOString(),
      finishedAt: iso(o.finishedAt),
    }));
    return {
      items,
      nextBefore:
        rows.length > limit && page.length ? page[page.length - 1]!.reservedAt.toISOString() : null,
    };
  }

  /** Local calculation vs the provider's own figure, per provider and UTC day. */
  async reconciliation(
    ctx: RequestContext,
    query: { from?: string; to?: string },
  ): Promise<AiReconciliationResponse> {
    const access = await this.allow(ctx, "ai_usage:read", "ai_reconciliation");
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!query.from || !query.to || !day.test(query.from) || !day.test(query.to))
      throw invalid("from", "date");
    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T00:00:00Z`);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (Number.isNaN(days) || days < 0 || days >= MAX_RECONCILIATION_DAYS)
      throw invalid("to", "range");
    const end = new Date(to.getTime() + 86_400_000);
    const { ops, figures } = await access.staffData(async (tx) => ({
      ops: await tx.aiOperation.findMany({
        where: { finishedAt: { gte: from, lt: end }, costBasis: { not: "NONE" } },
        select: { provider: true, finishedAt: true, actualMicros: true, costBasis: true },
      }),
      figures: await tx.aiReconciliation.findMany({
        where: { day: { gte: from, lt: end } },
        orderBy: { createdAt: "asc" },
      }),
    }));
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
    const row = (provider: AiProviderKey, d: string) => {
      const k = `${provider}|${d}`;
      let r = rows.get(k);
      if (!r) {
        r = { provider, day: d, local: 0n, assumed: 0n, provider_: null };
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
    const items: AiReconciliationRow[] = [...rows.values()]
      .sort((a, b) =>
        a.day === b.day ? a.provider.localeCompare(b.provider) : a.day.localeCompare(b.day),
      )
      .map((r) => ({
        provider: r.provider,
        day: r.day,
        localMicros: r.local.toString(),
        assumedMicros: r.assumed.toString(),
        providerMicros: str(r.provider_),
        differenceMicros:
          r.provider_ === null ? null : (r.provider_ - r.local - r.assumed).toString(),
      }));
    return { items };
  }

  async recordProviderFigure(ctx: RequestContext, body: unknown): Promise<{ recorded: true }> {
    const access = await this.allow(ctx, "ai_budget:manage", "ai_reconciliation");
    const req = parseBody(AiReconciliationCreateRequestSchema, body);
    const dayDate = new Date(`${req.day}T00:00:00Z`);
    if (dayDate.getTime() > this.clock.now().getTime()) throw invalid("day", "future");
    await access.staffData(async (tx) => {
      const clash = await tx.aiReconciliation.findFirst({
        where: {
          provider: req.provider,
          projectRef: req.projectRef ?? "",
          day: dayDate,
          source: "MANUAL",
        },
        select: { id: true },
      });
      if (clash) throw conflict("already_recorded", "day");
      const r = await tx.aiReconciliation.create({
        data: {
          provider: req.provider,
          projectRef: req.projectRef ?? "",
          day: dayDate,
          providerAmountMicros: BigInt(req.providerAmountMicros),
          note: req.note ?? null,
          createdById: access.userId,
        },
        select: { id: true },
      });
      await this.audit(
        access,
        tx,
        "ai.reconciliation.record",
        "ai_budget:manage",
        "ai_reconciliation",
        r.id,
        {
          provider: req.provider,
          day: req.day,
          amountMicros: req.providerAmountMicros,
        },
      );
    });
    return { recorded: true };
  }

  private uuid(raw: string): string {
    if (!UUID.test(raw)) throw new ApiError("NOT_FOUND");
    return raw.toLowerCase();
  }
}
