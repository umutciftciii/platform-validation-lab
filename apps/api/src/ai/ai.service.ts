/**
 * DP-287/DP-288 (ADR-030): the AI Center's overview. While AI is off the guard answers 404
 * (ai-gate.guard.ts); a refusal that `decide` gives because AI went off meanwhile is a 404 too.
 * The blockers are read in the caller's database context (row-level security: AI on and ai:read,
 * migration dp_288). DP-291: `callsPossible` once nothing is missing. DP-292: the caller's AI
 * permissions (what the admin offers; every route decides again).
 */
import { Inject, Injectable } from "@nestjs/common";
import type { AiBlocker, AiOverviewResponse } from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { AI_CONFIG } from "./config/ai-config.provider.js";
import type { AiConfig } from "./config/ai-config.js";

const PLATFORM = { scope: "platform" } as const;
const RESOURCE = { type: "ai_center", id: null };

@Injectable()
export class AiService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** ai:read, with "AI is off" answered as 404 like the guard does. */
  private async read(ctx: RequestContext): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    if (access.refusal("ai:read", PLATFORM) === "module_disabled") {
      await access.denied("ai:read", RESOURCE, "ai_disabled");
      throw new ApiError("NOT_FOUND");
    }
    await access.require("ai:read", PLATFORM, RESOURCE);
    return access;
  }

  async overview(ctx: RequestContext): Promise<AiOverviewResponse> {
    const access = await this.read(ctx);
    const now = this.clock.now();
    const { keys, models, budgets, tasks } = await access.staffData(async (tx) => ({
      keys: await tx.aiProviderCredential.count({
        where: { status: "ACTIVE" },
      }),
      models: await tx.aiModel.count({
        where: { status: "ENABLED", prices: { some: { effectiveFrom: { lte: now } } } },
      }),
      budgets: await tx.aiBudget.findMany({
        where: { active: true, scope: "PLATFORM" },
        select: { period: true },
      }),
      tasks: await tx.aiTaskSetting.count({ where: { enabled: true } }),
    }));
    const providersOn = await access.staffData((tx) =>
      tx.aiProviderSetting.count({ where: { enabled: true } }),
    );
    const blockers: AiBlocker[] = [];
    if (this.config.transport === "off") blockers.push("transport_off");
    if (keys === 0 || providersOn === 0) blockers.push("no_provider_key");
    if (models === 0) blockers.push("no_enabled_model");
    const periods = new Set(budgets.map((b) => b.period));
    if (!periods.has("DAILY") || !periods.has("MONTHLY")) blockers.push("no_budget");
    if (tasks === 0) blockers.push("no_enabled_task");
    // Held, step-up or not: a management action asks for the step-up when it runs.
    const held = access.heldAnywhere();
    const can = (permission: string) => held.has(permission);
    return {
      enabled: true,
      callsPossible: blockers.length === 0,
      blockers,
      transport: this.config.transport,
      permissions: {
        usageRead: can("ai_usage:read"),
        providerManage: can("ai_provider:manage"),
        modelManage: can("ai_model:manage"),
        budgetManage: can("ai_budget:manage"),
        invoke: can("ai:invoke"),
        auditRead: access.allows("audit:read", PLATFORM),
      },
      sites: access.sites.map((s) => ({ id: s.id, key: s.key, name: s.name })),
    };
  }
}
